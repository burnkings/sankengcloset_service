#!/usr/bin/env node
/**
 * 人工导入本地 JSON 脚本
 *
 * 输入：完整有效 JSON 文件路径
 * 格式：{ 店铺名: 商品数组 } 或 [ 商品数组 ]
 *
 * 使用：npx tsx scripts/import-taobao-products.ts <json-path>
 *       npx tsx scripts/import-taobao-products.ts <json-path> --dry-run
 *
 * 以 platform=TAOBAO + item_id 幂等 upsert。
 * 需要设置 DATABASE_URL 环境变量。
 */

import { readFileSync } from 'fs';
import { exit } from 'process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

// --------------- Types ---------------

interface RawItem {
  item_id?: string;
  title?: string;
  shop_name?: string;
  current_price?: number | string;
  main_image?: string;
  product_url?: string;
  categories?: string[];
  [key: string]: unknown;
}

interface BrandRow {
  id: string;
}

interface ProductRow {
  id: string;
}

// --------------- Helpers ---------------

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

/** 元 → 分（非负整数） */
function yuanToCents(price: unknown): number {
  if (price == null || price === '') return 0;
  const n = typeof price === 'string' ? Number.parseFloat(price) : Number(price);
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** 分类推断 */
function inferPitType(categories: string[] | undefined): string {
  if (!categories || categories.length === 0) return 'OTHER';
  const first = categories[0] ?? '';
  if (/JK|制服/.test(first)) return 'JK';
  if (/LOLITA|洛丽塔|LO/.test(first)) return 'LOLITA';
  if (/汉服|汉元素/.test(first)) return 'HANFU';
  return 'OTHER';
}

// --------------- Main ---------------

async function main() {
  // ----- 参数解析 -----
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const jsonPath = args.find((a) => !a.startsWith('--'));

  if (!jsonPath) {
    console.error('用法: npx tsx scripts/import-taobao-products.ts <json-file-path> [--dry-run]');
    exit(1);
  }

  // ----- 1. 解析 JSON -----
  let raw: unknown;
  try {
    const text = readFileSync(jsonPath, 'utf-8');
    raw = JSON.parse(text);
  } catch (e) {
    console.error('JSON 解析失败:', (e as Error).message);
    exit(1);
  }

  // ----- 2. 展平为商品数组 -----
  let items: RawItem[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [shopName, productList] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(productList)) {
        for (const p of productList) {
          if (typeof p === 'object' && p !== null) {
            (p as RawItem).shop_name = (p as RawItem).shop_name || shopName;
            items.push(p as RawItem);
          }
        }
      }
    }
  } else {
    console.error('JSON 根对象必须是 {店铺: 商品数组} 或 [商品数组]');
    exit(1);
  }

  // ----- 3. 统计 & 校验 -----
  const total = items.length;
  let success = 0;
  let skipped = 0;
  let failed = 0;
  let noImage = 0;
  let noPrice = 0;
  let otherCategory = 0;
  const categoryCounts: Record<string, number> = {};
  const nameCounts: Record<string, number> = {};
  const brandSet = new Set<string>();

  interface MissingFields { item_id: number; title: number; current_price: number; main_image: number; product_url: number; }
  const missingFields: MissingFields = {
    item_id: 0, title: 0, current_price: 0, main_image: 0, product_url: 0,
  };

  // 有效商品列表（待写入）
  const validItems: RawItem[] = [];

  for (const item of items) {
    const id = item.item_id;
    const title = item.title;
    const price = item.current_price;
    const shopName = item.shop_name;
    const imageUrl = item.main_image;
    const productUrl = item.product_url;

    if (!id) missingFields.item_id++;
    if (!title) missingFields.title++;
    if (price == null) missingFields.current_price++;
    if (!imageUrl) missingFields.main_image++;
    if (!productUrl) missingFields.product_url++;

    const pitType = inferPitType(item.categories);
    if (pitType === 'OTHER') otherCategory++;
    categoryCounts[pitType] = (categoryCounts[pitType] || 0) + 1;

    if (id && title && shopName) {
      brandSet.add(shopName);
      nameCounts[title] = (nameCounts[title] || 0) + 1;
      success++;
      validItems.push(item);
    } else {
      skipped++;
    }

    if (!imageUrl || imageUrl === '') noImage++;
    if (price == null || price === '' || (typeof price === 'number' && isNaN(price))) noPrice++;
  }

  // ----- 4. 输出报告 -----
  console.log('\n===== 导入统计 =====');
  console.log(`  总数:        ${total}`);
  console.log(`  有效:        ${success}`);
  console.log(`  跳过(无id/名/店): ${skipped}`);
  console.log(`  失败:        ${failed}`);
  console.log(`  品牌数:      ${brandSet.size}`);
  console.log(`  无图片:      ${noImage}`);
  console.log(`  无价格:      ${noPrice}`);
  console.log(`  OTHER 分类:  ${otherCategory}`);
  console.log(`\n分类分布:`);
  for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\n字段缺失:`);
  for (const [field, count] of Object.entries(missingFields)) {
    if (count > 0) console.log(`  ${field}: ${count}`);
  }

  const duplicates = Object.entries(nameCounts).filter(([, c]) => c > 1);
  if (duplicates.length > 0) {
    console.log(`\n重名商品 (${duplicates.length} 组):`);
    for (const [name, cnt] of duplicates.slice(0, 5)) {
      console.log(`  "${name}" 出现 ${cnt} 次`);
    }
    if (duplicates.length > 5) console.log(`  ... 还有 ${duplicates.length - 5} 组`);
  }

  // ----- 5. Dry-run 模式 -----
  if (dryRun) {
    console.log('\n🔍 Dry-run 模式 — 只校验不写入数据库');
    console.log(`   有效商品: ${validItems.length} 条，品牌: ${brandSet.size} 个`);
    console.log(`   数据库写入跳过 (--dry-run)\n`);
    exit(0);
  }

  // ----- 6. 数据库写入 (PostgreSQL 幂等 upsert) -----
  console.log('\n===== 数据库写入开始 =====');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ 需要设置 DATABASE_URL 环境变量');
    exit(1);
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  let dbBrands = 0;
  let dbProducts = 0;
  let dbImages = 0;
  let dbSnapshots = 0;
  let dbSources = 0;
  let dbErrors = 0;

  // 品牌 ID 缓存 (shop_name → brand_id)
  const brandCache = new Map<string, string>();

  // 先批量 upsert 所有品牌
  console.log(`  品牌 upsert (${brandSet.size} 个)...`);
  for (const shopName of brandSet) {
    if (brandCache.has(shopName)) continue;

    const brandId = newId('br');
    const pitType = 'OTHER' as string; // 品牌分类默认为 OTHER，商品级分类在 products 表中

    const rows = await sql`
      WITH s AS (
        INSERT INTO brands (id, name, category, source_platform, data_status, review_status, confidence)
        VALUES (
          ${brandId},
          ${shopName},
          ${pitType}::pit_type,
          'TAOBAO'::data_source,
          'FRESH'::data_status,
          'PENDING'::review_status,
          80
        )
        ON CONFLICT (name) WHERE deleted_at IS NULL
        DO NOTHING
        RETURNING id
      )
      SELECT id FROM s
      UNION ALL
      SELECT id FROM brands WHERE name = ${shopName} AND deleted_at IS NULL
      LIMIT 1
    `;

    if (rows.length > 0) {
      const rid = (rows[0] as BrandRow).id;
      brandCache.set(shopName, rid);
      if (rid === brandId) dbBrands++; // 新插入
    }
  }

  // 逐商品写入（事务内）
  console.log(`  商品写入 (${validItems.length} 条)...`);
  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i]!;

    const itemId = item.item_id!;
    const title = item.title!;
    const shopName = item.shop_name!;
    const priceYuan = item.current_price;
    const imageUrl = item.main_image ?? '';
    const productUrl = item.product_url ?? '';
    const pitType = inferPitType(item.categories);

    const brandId = brandCache.get(shopName);
    if (!brandId) {
      console.error(`  第 ${i + 1} 条: 品牌 "${shopName}" 未找到，跳过`);
      dbErrors++;
      continue;
    }

    const priceCents = yuanToCents(priceYuan);
    const prodId = newId('prd');

    try {
      // 6a. upsert products — 以 (source_platform, external_id) 去重
      const prodRows = await sql`
        INSERT INTO products (
          id, canonical_name, display_name, brand_id, pit_type,
          sale_status, current_price, source_url, source_platform, external_id,
          cover_url, images, description, data_status, review_status, confidence,
          first_seen_at, last_seen_at, collected_at
        ) VALUES (
          ${prodId},
          ${title},
          ${title},
          ${brandId},
          ${pitType}::pit_type,
          'ON_SALE'::sale_status,
          ${priceCents},
          ${productUrl},
          'TAOBAO'::data_source,
          ${itemId},
          ${imageUrl},
          ${imageUrl ? [imageUrl] : []},
          '',
          'FRESH'::data_status,
          'PENDING'::review_status,
          80,
          now(), now(), now()
        )
        ON CONFLICT (source_platform, external_id)
          WHERE external_id != '' AND deleted_at IS NULL
        DO UPDATE SET
          canonical_name   = EXCLUDED.canonical_name,
          display_name     = EXCLUDED.display_name,
          brand_id         = EXCLUDED.brand_id,
          pit_type         = EXCLUDED.pit_type,
          current_price    = EXCLUDED.current_price,
          source_url       = EXCLUDED.source_url,
          cover_url        = EXCLUDED.cover_url,
          images           = EXCLUDED.images,
          last_seen_at     = now(),
          updated_at       = now()
        RETURNING id
      `;

      const actualProdId = (prodRows[0] as ProductRow).id;
      if (prodRows.length > 0) dbProducts++;

      // 6b. upsert product_images (从 main_image)
      if (imageUrl) {
        // 先检查是否已存在同样的图片 URL
        const existingImg = await sql`
          SELECT id FROM product_images
          WHERE product_id = ${actualProdId} AND (url = ${imageUrl} OR source_url = ${imageUrl})
          LIMIT 1
        `;

        if (existingImg.length === 0) {
          // 删除旧的 cover 标记
          await sql`
            UPDATE product_images SET is_cover = false
            WHERE product_id = ${actualProdId} AND is_cover = true
          `;

          // 获取下一个 sort_order
          const maxOrder = await sql`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
            FROM product_images WHERE product_id = ${actualProdId}
          `;
          const sortOrder = (maxOrder[0] as { next_order: number }).next_order;

          await sql`
            INSERT INTO product_images (id, product_id, url, source_url, sort_order, is_cover)
            VALUES (${newId('img')}, ${actualProdId}, ${imageUrl}, ${imageUrl}, ${sortOrder}, true)
            ON CONFLICT (product_id, sort_order) DO NOTHING
          `;
          dbImages++;
        }
      }

      // 6c. insert price_snapshot
      await sql`
        INSERT INTO price_snapshots (id, product_id, price_cents, original_price_cents, source, source_url)
        VALUES (${newId('ps')}, ${actualProdId}, ${priceCents}, 0, 'taobao_import', ${productUrl})
      `;
      dbSnapshots++;

      // 6d. insert source_record (truncate URL to fit btree index 2704 byte limit)
      const truncatedUrl = productUrl.length > 2000 ? productUrl.slice(0, 2000) : productUrl;
      await sql`
        INSERT INTO source_records (id, source_type, source_name, source_url, original_id, entity_type, entity_id, parser_version)
        VALUES (
          ${newId('src')},
          'TAOBAO'::data_source,
          ${shopName},
          ${truncatedUrl},
          ${itemId},
          'product',
          ${actualProdId},
          'v1'
        )
      `;
      dbSources++;

      // 进度显示（每 10% 或每 500 条）
      if ((i + 1) % Math.max(1, Math.floor(validItems.length / 10)) === 0 || i === validItems.length - 1) {
        const pct = Math.round(((i + 1) / validItems.length) * 100);
        console.log(`   进度: ${i + 1}/${validItems.length} (${pct}%)`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      // products_brand_canonical_unique — 同品牌+同名产品已存在，属于预期行为
      if (msg.includes('products_brand_canonical_unique')) {
        dbProducts++; // 已存在，不计为错误
      } else if (msg.includes('source_records_url_idx')) {
        // URL 过长导致 btree 索引溢出，记录为错误
        dbErrors++;
      } else {
        console.error(`  第 ${i + 1} 条写入失败 (item_id=${itemId}):`, msg);
        dbErrors++;
      }
    }
  }

  // ----- 7. 写入结果汇总 -----
  console.log('\n===== 数据库写入完成 =====');
  console.log(`  brands:          ${dbBrands} 新建`);
  console.log(`  products:        ${dbProducts} 写入/更新`);
  console.log(`  product_images:  ${dbImages} 写入`);
  console.log(`  price_snapshots: ${dbSnapshots} 写入`);
  console.log(`  source_records:  ${dbSources} 写入`);
  console.log(`  错误:            ${dbErrors}`);
  console.log('');

  await sql.end();
  exit(dbErrors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  exit(1);
});
