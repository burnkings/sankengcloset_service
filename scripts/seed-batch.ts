// scripts/seed-batch.ts — 批量插入商品

import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:sankeng@localhost:5432/sankeng';
const sql = postgres(DATABASE_URL, { max: 1 });

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

async function main() {
  console.log('=== 批量插入商品 ===\n');

  const products: ProductSeed[] = JSON.parse(
    await readFile(resolve(__dirname, '../seeds/batch-products.json'), 'utf8')
  );

  console.log(`加载: ${products.length} 条商品\n`);

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of products) {
    try {
      // 检查品牌是否存在
      const brand = await sql`SELECT id FROM brands WHERE id = ${p.brandId}`;
      if (brand.length === 0) {
        errors.push(`${p.canonicalName}: 品牌 ${p.brandId} 不存在`);
        continue;
      }

      // 检查去重
      const existing = await sql`
        SELECT id FROM products WHERE brand_id = ${p.brandId} AND canonical_name = ${p.canonicalName} AND deleted_at IS NULL
      `;
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // 插入
      await sql`
        INSERT INTO products (
          id, canonical_name, display_name, brand_id, pit_type, category,
          sale_status, current_price, original_price,
          source_url, source_platform, description, review_status, confidence
        ) VALUES (
          ${p.id}, ${p.canonicalName}, ${p.displayName}, ${p.brandId}, ${p.pitType}, ${p.category},
          ${p.saleStatus}, ${p.currentPrice}, ${p.originalPrice},
          ${p.sourceUrl}, 'ADMIN', ${p.description}, 'APPROVED', 100
        )
      `;
      inserted++;

      // 价格快照
      await sql`INSERT INTO price_snapshots (id, product_id, price_cents, source, source_url) VALUES (${`ps_${p.id}`}, ${p.id}, ${p.currentPrice}, 'seed', ${p.sourceUrl})`;
    } catch (e) {
      errors.push(`${p.canonicalName}: ${(e as Error).message}`);
    }
  }

  // 统计
  const total = await sql`SELECT count(*) as cnt FROM products WHERE deleted_at IS NULL`;
  const byPit = await sql`SELECT pit_type, count(*) as cnt FROM products WHERE deleted_at IS NULL GROUP BY pit_type ORDER BY pit_type`;

  console.log(`新增: ${inserted}, 跳过: ${skipped}`);
  if (errors.length > 0) console.log(`错误: ${errors.length}`);
  console.log(`\n--- 最终统计 ---`);
  console.log(`产品总数: ${(total[0] ?? {cnt: 0}).cnt}`);
  for (const row of byPit) {
    console.log(`  ${row.pit_type}: ${row.cnt}`);
  }

  await sql.end();
  console.log('\n=== 完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
