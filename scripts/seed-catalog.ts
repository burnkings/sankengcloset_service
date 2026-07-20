// Phase D2: 品牌与商品种子数据脚本
// 可重复执行，有唯一键保护，不覆盖人工修正数据

import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { max: 1 });

interface BrandSeed {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  officialUrl: string;
  description: string;
  followerCount: number;
}

interface ProductSeed {
  id: string;
  brandId: string;
  brandName: string;
  canonicalName: string;
  displayName: string;
  pitType: string;
  category: string;
  saleStatus: string;
  currentPrice: number;
  originalPrice: number;
  sourceUrl: string;
  description: string;
}

async function loadJson<T>(filename: string): Promise<T[]> {
  const raw = await readFile(resolve(__dirname, filename), 'utf8');
  return JSON.parse(raw) as T[];
}

async function seedBrands(brands: BrandSeed[]): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const b of brands) {
    try {
      const result = await sql`
        INSERT INTO brands (id, name, name_en, category, official_url, description, follower_count, source_platform, review_status, confidence)
        VALUES (${b.id}, ${b.name}, ${b.nameEn}, ${b.category}, ${b.officialUrl}, ${b.description}, ${b.followerCount}, 'ADMIN', 'APPROVED', 100)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      if (result.length > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(`品牌 ${b.name}: ${(e as Error).message}`);
    }
  }

  return { inserted, skipped, errors };
}

async function seedProducts(products: ProductSeed[]): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of products) {
    try {
      // 检查品牌是否存在
      const brand = await sql`SELECT id FROM brands WHERE id = ${p.brandId}`;
      if (brand.length === 0) {
        errors.push(`商品 ${p.displayName}: 品牌 ${p.brandId} 不存在`);
        continue;
      }

      // 检查去重：brand_id + canonical_name
      const existing = await sql`
        SELECT id FROM products WHERE brand_id = ${p.brandId} AND canonical_name = ${p.canonicalName} AND deleted_at IS NULL
      `;
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // 插入商品
      const result = await sql`
        INSERT INTO products (
          id, canonical_name, display_name, brand_id, pit_type, category,
          sale_status, current_price, original_price,
          source_url, source_platform, description,
          review_status, confidence
        ) VALUES (
          ${p.id}, ${p.canonicalName}, ${p.displayName}, ${p.brandId}, ${p.pitType}, ${p.category},
          ${p.saleStatus}, ${p.currentPrice}, ${p.originalPrice},
          ${p.sourceUrl}, 'ADMIN', ${p.description},
          'APPROVED', 100
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      if (result.length > 0) {
        inserted++;

        // 同时插入价格快照
        await sql`
          INSERT INTO price_snapshots (id, product_id, price_cents, original_price_cents, source, source_url)
          VALUES (${`ps_${p.id}`}, ${p.id}, ${p.currentPrice}, ${p.originalPrice}, 'seed', ${p.sourceUrl})
        `;

        // 同时插入来源记录
        await sql`
          INSERT INTO source_records (id, source_type, source_name, source_url, entity_type, entity_id, review_status, confidence)
          VALUES (${`src_${p.id}`}, 'ADMIN', '种子数据', ${p.sourceUrl}, 'product', ${p.id}, 'APPROVED', 100)
        `;
      } else {
        skipped++;
      }
    } catch (e) {
      errors.push(`商品 ${p.displayName}: ${(e as Error).message}`);
    }
  }

  return { inserted, skipped, errors };
}

async function generateReport(): Promise<void> {
  const brandCount = await sql`SELECT count(*) as count FROM brands WHERE deleted_at IS NULL`;
  const productCount = await sql`SELECT count(*) as count FROM products WHERE deleted_at IS NULL`;

  const byPitType = await sql`
    SELECT pit_type, count(*) as count FROM products WHERE deleted_at IS NULL GROUP BY pit_type ORDER BY pit_type
  `;

  const bySaleStatus = await sql`
    SELECT sale_status, count(*) as count FROM products WHERE deleted_at IS NULL GROUP BY sale_status ORDER BY sale_status
  `;

  const bySource = await sql`
    SELECT source_platform, count(*) as count FROM products WHERE deleted_at IS NULL GROUP BY source_platform ORDER BY count DESC
  `;

  const completeness = await sql`
    SELECT
      count(*) as total,
      count(*) FILTER (WHERE canonical_name != '') as has_name,
      count(*) FILTER (WHERE brand_id != '') as has_brand,
      count(*) FILTER (WHERE current_price > 0) as has_price,
      count(*) FILTER (WHERE source_url != '') as has_source,
      count(*) FILTER (WHERE description != '') as has_desc
    FROM products WHERE deleted_at IS NULL
  `;

  const priceSnapshots = await sql`SELECT count(*) as count FROM price_snapshots`;
  const sourceRecords = await sql`SELECT count(*) as count FROM source_records`;

  console.log('\n=== 数据质量报告 ===');
  console.log(`品牌总数: ${(brandCount[0] ?? {count: 0}).count}`);
  console.log(`商品总数: ${(productCount[0] ?? {count: 0}).count}`);
  console.log(`价格快照: ${(priceSnapshots[0] ?? {count: 0}).count}`);
  console.log(`来源记录: ${(sourceRecords[0] ?? {count: 0}).count}`);

  console.log('\n--- 坑向分布 ---');
  for (const row of byPitType) {
    console.log(`  ${row.pit_type}: ${row.count}`);
  }

  console.log('\n--- 销售状态分布 ---');
  for (const row of bySaleStatus) {
    console.log(`  ${row.sale_status}: ${row.count}`);
  }

  console.log('\n--- 数据来源分布 ---');
  for (const row of bySource) {
    console.log(`  ${row.source_platform}: ${row.count}`);
  }

  const c = completeness[0] ?? { total: 0, has_name: 0, has_brand: 0, has_price: 0, has_source: 0, has_desc: 0 };
  const total = Number(c.total);
  console.log('\n--- 必填字段完整率 ---');
  console.log(`  名称: ${c.has_name}/${total} (${(Number(c.has_name) / total * 100).toFixed(1)}%)`);
  console.log(`  品牌: ${c.has_brand}/${total} (${(Number(c.has_brand) / total * 100).toFixed(1)}%)`);
  console.log(`  价格: ${c.has_price}/${total} (${(Number(c.has_price) / total * 100).toFixed(1)}%)`);
  console.log(`  来源: ${c.has_source}/${total} (${(Number(c.has_source) / total * 100).toFixed(1)}%)`);
  console.log(`  描述: ${c.has_desc}/${total} (${(Number(c.has_desc) / total * 100).toFixed(1)}%)`);
}

async function main() {
  console.log('=== Phase D2: 品牌与商品种子数据 ===\n');

  // 加载数据
  const brands = await loadJson<BrandSeed>('../seeds/brands.json');
  const products = await loadJson<ProductSeed>('../seeds/products.json');

  console.log(`加载: ${brands.length} 个品牌, ${products.length} 个商品\n`);

  // 插入品牌
  console.log('--- 插入品牌 ---');
  const brandResult = await seedBrands(brands);
  console.log(`  新增: ${brandResult.inserted}, 跳过: ${brandResult.skipped}`);
  if (brandResult.errors.length > 0) {
    console.log(`  错误: ${brandResult.errors.length}`);
    brandResult.errors.forEach(e => console.log(`    ${e}`));
  }

  // 插入商品
  console.log('\n--- 插入商品 ---');
  const productResult = await seedProducts(products);
  console.log(`  新增: ${productResult.inserted}, 跳过: ${productResult.skipped}`);
  if (productResult.errors.length > 0) {
    console.log(`  错误: ${productResult.errors.length}`);
    productResult.errors.forEach(e => console.log(`    ${e}`));
  }

  // 生成报告
  await generateReport();

  await sql.end();
  console.log('\n=== 完成 ===');
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
