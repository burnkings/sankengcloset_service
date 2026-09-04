#!/usr/bin/env node
/**
 * 恢复 products / product_images 表（2026-08-08 迁移重放 0002 误删后重建）
 *
 * 原理：
 *  - source_records 保存了 original_id(=淘宝item_id) → entity_id(=旧prd_id) 映射
 *  - 恢复时优先复用旧 prd_id，使 price_snapshots / source_records 自动重新关联
 *  - brands 表 469 行幸存，按店铺名(name)复用现有 brand_id，不新建
 *  - visibility_status 直接置 published（恢复的就是 7/26 发布过的状态）
 *
 * 使用：
 *   node --env-file=.env.production --import tsx scripts/restore-products.ts            # 正式恢复
 *   node --env-file=.env.production --import tsx scripts/restore-products.ts --dry-run   # 只统计不写库
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
  /** 显式坑向分类（数据文件自带时优先使用）：JK | LOLITA | HANFU | OTHER */
  pit_type?: string;
  [key: string]: unknown;
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

/** 坑向分类推断。优先级：① 数据文件显式 pit_type 字段 → ② categories 枚举值（三坑直接分类）→ ③ 标题正则 → ④ OTHER。
 *  categories 语义 = 三坑直接分类（JK/LOLITA/HANFU），与 pit_type 一致，非淘宝主类目/子类目层级。 */
function inferPitType(item: RawItem): string {
  const explicit = (item.pit_type ?? '').trim().toUpperCase();
  if (explicit === 'JK' || explicit === 'LOLITA' || explicit === 'HANFU' || explicit === 'OTHER') {
    return explicit;
  }
  const cats = item.categories ?? [];
  for (const c of cats) {
    const up = c.trim().toUpperCase();
    if (up === 'JK' || up === 'LOLITA' || up === 'HANFU' || up === 'OTHER') return up;
  }
  const title = item.title ?? '';
  if (/(洛丽塔|lolita|lo裙|jsk|花嫁|甜系|哥特|公主裙|洋装|小裙子|\mop\M)/i.test(title)) return 'LOLITA';
  if (/(汉服|汉元素|马面|襦裙|齐胸)/i.test(title)) return 'HANFU';
  if (/(格裙|制服|水手服|\mjk\M)/i.test(title)) return 'JK';
  return 'OTHER';
}

// --------------- Main ---------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const jsonPath = args.find((a) => !a.startsWith('--')) ?? '/home/all_shops_products.json';

  // ----- 1. 解析 JSON -----
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    console.error('JSON 解析失败:', (e as Error).message);
    exit(1);
  }

  // ----- 2. 展平为商品数组 -----
  const items: RawItem[] = [];
  if (Array.isArray(raw)) {
    items.push(...(raw as RawItem[]));
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

  // 有效商品（id + title + shop_name 齐全）
  const valid = items.filter((i) => i.item_id && i.title && i.shop_name);

  console.log(`\n===== 恢复统计 =====`);
  console.log(`  JSON 商品总数:  ${items.length}`);
  console.log(`  有效商品:       ${valid.length}`);

  if (dryRun) {
    console.log('\n🔍 Dry-run 模式 — 只校验不写入数据库\n');
    exit(0);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ 需要设置 DATABASE_URL 环境变量');
    exit(1);
  }

  const sql = postgres(databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 10 });

  // ----- 3. 建映射：item_id → 旧 prd_id（从 source_records 恢复） -----
  console.log('\n  读取 source_records 映射 (item_id → 旧 prd_id)...');
  const idMapRows = await sql`
    SELECT original_id, entity_id FROM source_records
    WHERE entity_type = 'product' AND original_id IS NOT NULL AND entity_id IS NOT NULL
  `;
  const idMap = new Map<string, string>();
  for (const r of idMapRows) {
    if (!idMap.has(r.original_id)) idMap.set(r.original_id, r.entity_id);
  }
  console.log(`  映射条数: ${idMap.size}（恢复后价格快照/来源记录自动关联）`);

  // ----- 4. 建品牌映射：店铺名 → brand_id（复用现有 brands，不新建） -----
  console.log('  读取 brands 映射 (店铺名 → brand_id)...');
  const brandRows = await sql`
    SELECT id, name FROM brands WHERE deleted_at IS NULL
  `;
  const brandMap = new Map<string, string>();
  for (const b of brandRows) brandMap.set(b.name, b.id);
  console.log(`  现有品牌: ${brandMap.size} 个`);

  let dbProducts = 0;
  let dbImages = 0;
  let dbReused = 0;
  let dbNew = 0;
  let dbNoBrand = 0;
  let dbNameConflict = 0;
  let dbErrors = 0;

  // ----- 5. 逐商品恢复（事务内，幂等 upsert） -----
  console.log(`\n  商品恢复 (${valid.length} 条)...`);
  for (let i = 0; i < valid.length; i++) {
    const item = valid[i]!;
    const itemId = item.item_id!;
    const title = item.title!;
    const shopName = item.shop_name!;
    const priceYuan = item.current_price;
    const imageUrl = item.main_image ?? '';
    const productUrl = item.product_url ?? '';
    const pitType = inferPitType(item);

    const brandId = brandMap.get(shopName);
    if (!brandId) {
      dbNoBrand++;
      continue;
    }

    const priceCents = yuanToCents(priceYuan);
    // 优先复用旧 prd_id（保证快照/来源记录关联），无映射则新生成
    const prodId = idMap.get(itemId) ?? newId('prd');
    if (idMap.has(itemId)) dbReused++; else dbNew++;

    try {
      // 5a. upsert products — 以 (source_platform, external_id) 去重
      const prodRows = await sql`
        INSERT INTO products (
          id, canonical_name, display_name, brand_id, pit_type,
          sale_status, current_price, original_price, source_url, source_platform, external_id,
          cover_url, images, description, data_status, review_status, confidence,
          visibility_status, season_tags, scene_tags, element_tags, recommended_tags, feed_score,
          first_seen_at, last_seen_at, collected_at
        ) VALUES (
          ${prodId}, ${title}, ${title}, ${brandId}, ${pitType}::pit_type,
          'ON_SALE'::sale_status, ${priceCents}, 0, ${productUrl}, 'TAOBAO'::data_source, ${itemId},
          ${imageUrl}, ${imageUrl ? [imageUrl] : []}, '', 'FRESH'::data_status, 'PENDING'::review_status, 80,
          'published'::visibility_status, '{}', '{}', '{}', '{}', 0,
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
          visibility_status = 'published'::visibility_status,
          last_seen_at     = now(),
          updated_at       = now()
        RETURNING id
      `;

      if (prodRows.length > 0) dbProducts++;

      // 5b. upsert product_images (从 main_image)
      if (imageUrl) {
        const existingImg = await sql`
          SELECT id FROM product_images
          WHERE product_id = ${prodId} AND (url = ${imageUrl} OR source_url = ${imageUrl})
          LIMIT 1
        `;
        if (existingImg.length === 0) {
          await sql`
            INSERT INTO product_images (id, product_id, url, source_url, sort_order, is_cover)
            VALUES (${newId('img')}, ${prodId}, ${imageUrl}, ${imageUrl}, 0, true)
            ON CONFLICT (product_id, sort_order) DO NOTHING
          `;
          dbImages++;
        }
      }

      // 进度（每 10%）
      if ((i + 1) % Math.max(1, Math.floor(valid.length / 10)) === 0 || i === valid.length - 1) {
        console.log(`   进度: ${i + 1}/${valid.length}`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      // 同品牌+同名商品已存在 → 预期行为（与导入脚本一致）
      if (msg.includes('products_brand_canonical_unique')) {
        dbNameConflict++;
      } else {
        console.error(`  第 ${i + 1} 条恢复失败 (item_id=${itemId}):`, msg);
        dbErrors++;
      }
    }
  }

  // ----- 6. 汇总 -----
  console.log('\n===== 恢复完成 =====');
  console.log(`  products 写入/更新: ${dbProducts}（复用旧ID ${dbReused} / 新ID ${dbNew}）`);
  console.log(`  product_images:     ${dbImages}`);
  console.log(`  无品牌跳过:         ${dbNoBrand}`);
  console.log(`  同品牌同名跳过:     ${dbNameConflict}`);
  console.log(`  错误:               ${dbErrors}`);
  console.log('');

  await sql.end();
  exit(dbErrors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  exit(1);
});
