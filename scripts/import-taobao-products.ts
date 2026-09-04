#!/usr/bin/env node
/**
 * Phase 2.5-D Product V2 — 人工导入本地 JSON 脚本（Raw → Normalize → Product）
 *
 * 输入：完整有效 JSON 文件路径
 * 格式：{ 店铺名: 商品数组 } 或 [ 商品数组 ]
 *
 * 使用：npx tsx scripts/import-taobao-products.ts <json-path> [--dry-run]
 * 需要设置 DATABASE_URL 环境变量。
 *
 * 数据流：
 *   Raw        — raw_data 保存采集 JSON 原文（parsed_json=完整原始对象，raw_content=原文行，
 *                 未知字段全部保留，不清洗任何业务字段），关联 import_batch
 *   Normalize  — 云端唯一业务解释层（纯函数）：标题清洗 / 价格语义 / canonical_url / pit_type / sale_status
 *   Product    — external_id=item_id 稳定身份（唯一索引已存在），多图，价格拆分列
 *
 * 幂等：
 *   products       ON CONFLICT (source_platform, external_id) DO UPDATE
 *   source_records source_records_dedup_uniq 唯一索引 + ON CONFLICT DO NOTHING
 *   product_images 按 product_id 重建（反映最新 images[]）
 *   price_snapshots 价格与最新快照一致时不重复插
 *
 * 兼容旧版字段（title/current_price/product_url/main_image）：
 *   新版字段缺失时自动回退，保证采集端冻结前文件也能导入。
 */

import { readFileSync } from 'fs';
import { exit } from 'process';
import { randomUUID, createHash } from 'node:crypto';
import postgres from 'postgres';

// --------------- Types ---------------

interface RawItem {
  /** 淘宝 item_id（Product 稳定身份） */
  item_id?: string;
  /** 新版：原始标题 */
  title_raw?: string;
  /** 旧版兼容 */
  title?: string;
  /** 新版：原始价格字符串 */
  price_raw?: string | number;
  /** 旧版兼容 */
  current_price?: string | number;
  /** 新版：原始 URL（含 tracking 参数） */
  url_raw?: string;
  /** 旧版兼容 */
  product_url?: string;
  /** 新版：多图数组 */
  images?: string[];
  /** 旧版兼容：主图 */
  main_image?: string;
  /** 新版：SKU 原始数据（本阶段原样入 raw，不解析） */
  variants_raw?: unknown;
  /** 新版：购买文案原始文本 */
  purchase_text_raw?: string;
  /** 店铺名 */
  shop_name?: string;
  /** 搜索店铺名 */
  query_shop?: string;
  /** 店铺链接 */
  shop_link?: string;
  /** 采集时间 */
  fetched_at?: string;
  /** 采集端版本 */
  crawler_version?: string;
  /** 数据来源 */
  source?: string;
  categories?: string[];
  /** 显式坑向分类（数据文件自带时优先使用）：JK | LOLITA | HANFU | OTHER */
  pit_type?: string;
  [key: string]: unknown;
}

interface BrandRow {
  id: string;
}

interface ProductRow {
  id: string;
}

interface SnapshotRow {
  price_cents: number;
}

type PriceType = 'FULL' | 'DEPOSIT' | 'BALANCE' | 'INTENTION' | 'UNKNOWN';

interface NormalizedPrice {
  priceCents: number;        // 展示价（分）
  priceType: PriceType;
  depositCents: number;
  balanceCents: number;
  originalCents: number;
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

/** 提取原始标题（新版 title_raw 优先，旧版 title 回退） */
function rawTitle(item: RawItem): string {
  return (item.title_raw ?? item.title ?? '').trim();
}

/** 提取原始价格（新版 price_raw 优先，旧版 current_price 回退） */
function rawPrice(item: RawItem): string | number | undefined {
  return item.price_raw ?? item.current_price;
}

/** 提取原始 URL（新版 url_raw 优先，旧版 product_url 回退） */
function rawUrl(item: RawItem): string {
  return (item.url_raw ?? item.product_url ?? '').trim();
}

/** 提取图片数组（新版 images[] 优先，旧版 [main_image] 回退） */
function rawImages(item: RawItem): string[] {
  if (Array.isArray(item.images) && item.images.length > 0) {
    return item.images.filter((u): u is string => typeof u === 'string' && u.trim() !== '');
  }
  const main = item.main_image;
  if (typeof main === 'string' && main.trim() !== '') return [main.trim()];
  return [];
}

/** 提取店铺名（shop_name 优先，query_shop 回退） */
function rawShopName(item: RawItem): string {
  return (item.shop_name ?? item.query_shop ?? '').trim();
}

// --------------- Normalize 层（云端唯一业务解释层，纯函数，可重放） ---------------

/** 标题清洗：剥离营销前缀（【意向金…】【定金…】【跳转链接】等），保留款式核心 */
function normalizeTitle(raw: string): string {
  if (!raw) return '';
  // 剥离 【...】 中的营销前缀（意向金/定金/尾款/跳转/预售/现货/已售完/截团等）
  let t = raw.replace(/【[^】]*(意向金|定金|尾款|跳转|预售|现货|已售完|截团|清仓|特价)[^】]*】/g, '');
  // 去连续空白
  t = t.replace(/\s+/g, ' ').trim();
  // 若清洗后为空（整条都是营销前缀），保留原文（宁可不洗也不丢）
  return t || raw.trim();
}

/** 价格语义 Normalize：区分 FULL / DEPOSIT / BALANCE / INTENTION / UNKNOWN */
function normalizePrice(item: RawItem): NormalizedPrice {
  const title = rawTitle(item);
  const priceVal = rawPrice(item);
  const priceCentsRaw = yuanToCents(priceVal);
  const isIntentPrice = priceCentsRaw === 100 || priceCentsRaw === 999900; // 1元 / 9999元 占位

  // 1. 意向金判定：标题含"意向金"，或跳转占位价
  if (/意向金|1元抵|1r抵/.test(title) || (isIntentPrice && /跳转/.test(title))) {
    return { priceCents: 0, priceType: 'INTENTION', depositCents: 0, balanceCents: 0, originalCents: 0 };
  }
  // 2. 跳转占位价（9999 无明确语义）
  if (isIntentPrice) {
    return { priceCents: 0, priceType: 'UNKNOWN', depositCents: 0, balanceCents: 0, originalCents: 0 };
  }
  // 3. 定金
  if (/定金/.test(title)) {
    return { priceCents: priceCentsRaw, priceType: 'DEPOSIT', depositCents: priceCentsRaw, balanceCents: 0, originalCents: 0 };
  }
  // 4. 尾款
  if (/尾款/.test(title)) {
    return { priceCents: priceCentsRaw, priceType: 'BALANCE', depositCents: 0, balanceCents: priceCentsRaw, originalCents: 0 };
  }
  // 5. 无价格
  if (priceCentsRaw <= 0) {
    return { priceCents: 0, priceType: 'UNKNOWN', depositCents: 0, balanceCents: 0, originalCents: 0 };
  }
  // 6. 普通售价
  return { priceCents: priceCentsRaw, priceType: 'FULL', depositCents: 0, balanceCents: 0, originalCents: priceCentsRaw };
}

/** canonical URL：由 item_id 生成稳定链接（不依赖 tracking URL） */
function canonicalUrl(itemId: string): string {
  return `https://item.taobao.com/item.htm?id=${itemId}`;
}

/** 坑向分类推断。优先级：① 数据文件显式 pit_type 字段 → ② 标题正则（大小写不敏感+词边界）→ ③ categories 全数组（任一元素，非仅 [0]）→ ④ OTHER */
function inferPitType(item: RawItem): string {
  const explicit = (item.pit_type ?? '').trim().toUpperCase();
  if (explicit === 'JK' || explicit === 'LOLITA' || explicit === 'HANFU' || explicit === 'OTHER') {
    return explicit;
  }
  const title = rawTitle(item);
  if (/(洛丽塔|lolita|lo裙|jsk|花嫁|甜系|哥特|公主裙|洋装|小裙子|\mop\M)/i.test(title)) return 'LOLITA';
  if (/(汉服|汉元素|马面|襦裙|齐胸)/i.test(title)) return 'HANFU';
  if (/(格裙|制服|水手服|\mjk\M)/i.test(title)) return 'JK';
  const cats = item.categories ?? [];
  for (const c of cats) {
    const up = c.trim().toUpperCase();
    if (up === 'JK' || up === 'LOLITA' || up === 'HANFU' || up === 'OTHER') return up;
  }
  if (cats.some((c) => /JK|制服|格裙|水手服/i.test(c))) return 'JK';
  if (cats.some((c) => /LOLITA|洛丽塔|LO/i.test(c))) return 'LOLITA';
  if (cats.some((c) => /汉服|汉元素/i.test(c))) return 'HANFU';
  return 'OTHER';
}

/** sale_status 推断：购买文案/标题含售罄→SOLD_OUT、预约/预售→PRE_ORDER，默认 ON_SALE */
function inferSaleStatus(item: RawItem): string {
  const text = `${item.purchase_text_raw ?? ''} ${rawTitle(item)}`;
  if (/已售完|售罄|下架|已截团/.test(text)) return 'SOLD_OUT';
  if (/预约|预售|定金/.test(text)) return 'PRE_ORDER';
  return 'ON_SALE';
}

/** Raw 校验：item_id 必须存在 */
function validItemId(item: RawItem): boolean {
  return typeof item.item_id === 'string' && item.item_id.trim() !== '';
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

  // ----- 2. 展平为商品数组（保留原始对象引用 → Raw 层可存原文） -----
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
  let noImage = 0;
  let noPrice = 0;
  let otherCategory = 0;
  let noItemId = 0;
  const categoryCounts: Record<string, number> = {};
  const priceTypeCounts: Record<string, number> = {};
  const brandSet = new Set<string>();

  interface MissingFields { item_id: number; title: number; price: number; }
  const missingFields: MissingFields = { item_id: 0, title: 0, price: 0 };

  // 有效商品列表（待写入，保留原始对象 → Raw 原文保真）
  const validItems: RawItem[] = [];

  for (const item of items) {
    const id = item.item_id;
    const title = rawTitle(item);
    const price = rawPrice(item);
    const shopName = rawShopName(item);
    const images = rawImages(item);

    if (!id || id.trim() === '') { missingFields.item_id++; noItemId++; }
    if (!title) missingFields.title++;
    if (price == null || price === '' || (typeof price === 'number' && isNaN(price))) missingFields.price++;

    const pitType = inferPitType(item);
    const priceNorm = normalizePrice(item);
    if (pitType === 'OTHER') otherCategory++;
    categoryCounts[pitType] = (categoryCounts[pitType] || 0) + 1;
    priceTypeCounts[priceNorm.priceType] = (priceTypeCounts[priceNorm.priceType] || 0) + 1;

    if (id && title && shopName) {
      brandSet.add(shopName);
      success++;
      validItems.push(item);
    } else {
      skipped++;
    }

    if (images.length === 0) noImage++;
    if (price == null || price === '' || (typeof price === 'number' && isNaN(price))) noPrice++;
  }

  // ----- 4. 输出报告 -----
  console.log('\n===== 导入统计 =====');
  console.log(`  总数:        ${total}`);
  console.log(`  有效:        ${success}`);
  console.log(`  跳过(无id/名/店): ${skipped}`);
  console.log(`  品牌数:      ${brandSet.size}`);
  console.log(`  无图片:      ${noImage}`);
  console.log(`  无价格:      ${noPrice}`);
  console.log(`  无 item_id:  ${noItemId}`);
  console.log(`  OTHER 分类:  ${otherCategory}`);
  console.log(`\n分类分布:`);
  for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\nprice_type 分布:`);
  for (const [pt, count] of Object.entries(priceTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pt}: ${count}`);
  }
  console.log(`\n字段缺失:`);
  for (const [field, count] of Object.entries(missingFields)) {
    if (count > 0) console.log(`  ${field}: ${count}`);
  }

  // ----- 5. Dry-run 模式 -----
  if (dryRun) {
    console.log('\n🔍 Dry-run 模式 — 只校验不写入数据库');
    console.log(`   有效商品: ${validItems.length} 条，品牌: ${brandSet.size} 个`);
    console.log(`   数据库写入跳过 (--dry-run)\n`);
    exit(0);
  }

  // ----- 6. 数据库写入 (Raw → Normalize → Product) -----
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

  let dbBatches = 0;
  let dbBrands = 0;
  let dbProducts = 0;
  let dbImages = 0;
  let dbSnapshots = 0;
  let dbSources = 0;
  let dbRaws = 0;
  let dbErrors = 0;

  // 品牌 ID 缓存 (shop_name → brand_id)
  const brandCache = new Map<string, string>();

  try {
    // 6.0 创建 import_batch
    const batchId = newId('ib');
    const fileBase = jsonPath.split('/').pop() ?? '';
    const sampleFetchedAt = (items[0] as RawItem | undefined)?.fetched_at;
    await sql`
      INSERT INTO import_batches (id, source, crawler_version, file_name, fetched_at, total_records, status)
      VALUES (${batchId}, 'TAOBAO', ${(items[0] as RawItem | undefined)?.crawler_version ?? ''}, ${fileBase},
              ${sampleFetchedAt ? new Date(sampleFetchedAt) : null}, ${validItems.length}, 'running')
    `;
    dbBatches++;
    console.log(`  import_batch: ${batchId} (${validItems.length} 条, 文件 ${fileBase})`);

    // 6.1 先批量 upsert 所有品牌
    console.log(`  品牌 upsert (${brandSet.size} 个)...`);
    for (const shopName of brandSet) {
      if (brandCache.has(shopName)) continue;

      const brandId = newId('br');
      const rows = await sql`
        WITH s AS (
          INSERT INTO brands (id, name, category, source_platform, data_status, review_status, confidence)
          VALUES (
            ${brandId},
            ${shopName},
            'OTHER'::pit_type,
            'TAOBAO'::data_source,
            'FRESH'::data_status,
            'PENDING'::review_status,
            80
          )
          ON CONFLICT (name, category) WHERE deleted_at IS NULL
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

    // 6.2 逐商品写入（每 200 条一个事务，错误记录后继续）
    console.log(`  商品写入 (${validItems.length} 条)...`);
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i]!;
      const itemId = item.item_id!.trim();
      const shopName = rawShopName(item);
      const brandId = brandCache.get(shopName);
      if (!brandId) {
        console.error(`  第 ${i + 1} 条: 品牌 "${shopName}" 未找到，跳过`);
        dbErrors++;
        continue;
      }

      try {
        const title = rawTitle(item);
        const imageUrls = rawImages(item);
        const sourceUrl = rawUrl(item);
        const pitType = inferPitType(item);
        const priceNorm = normalizePrice(item);
        const saleStatus = inferSaleStatus(item);
        const canonical = canonicalUrl(itemId);
        const prodId = newId('prd');
        const coverUrl = imageUrls[0] ?? '';

        // 6a. Raw 持久化 — 保存采集 JSON 原文（parsed_json=完整原始对象，未知字段全保留）
        //     ⚠️ 独立提交：Raw 保真是最高优先级，即使后续 Product 写入失败也不回滚 raw。
        const rawId = newId('raw');
        const rawJson = JSON.parse(JSON.stringify(item)) as Parameters<typeof sql.json>[0];
        await sql`
          INSERT INTO raw_data (id, source_type, source_url, content_type, raw_content, parsed_json, fetched_at, import_batch_id)
          VALUES (${rawId}, 'TAOBAO'::data_source, ${sourceUrl || canonical}, 'application/json',
                  ${JSON.stringify(item)}, ${sql.json(rawJson)},
                  ${item.fetched_at ? new Date(item.fetched_at) : new Date()}, ${batchId})
        `;
        dbRaws++;

        await sql.begin(async (tx) => {
          // 6b. Product upsert — external_id=item_id 稳定身份
          const prodRows = await tx`
            INSERT INTO products (
              id, canonical_name, display_name, brand_id, pit_type,
              sale_status, current_price, deposit_price, balance_price, original_price,
              price_type, source_url, canonical_url, source_platform, external_id,
              cover_url, images, description, data_status, review_status, confidence,
              visibility_status, first_seen_at, last_seen_at, collected_at
            ) VALUES (
              ${prodId},
              ${title},
              ${title},
              ${brandId},
              ${pitType}::pit_type,
              ${saleStatus}::sale_status,
              ${priceNorm.priceCents},
              ${priceNorm.depositCents},
              ${priceNorm.balanceCents},
              ${priceNorm.originalCents},
              ${priceNorm.priceType}::price_type,
              ${sourceUrl},
              ${canonical},
              'TAOBAO'::data_source,
              ${itemId},
              ${coverUrl},
              ${imageUrls},
              '',
              'FRESH'::data_status,
              'PENDING'::review_status,
              80,
              'published'::visibility_status,
              now(), now(), now()
            )
            ON CONFLICT (source_platform, external_id)
              WHERE external_id != '' AND deleted_at IS NULL
            DO UPDATE SET
              canonical_name   = EXCLUDED.canonical_name,
              display_name     = EXCLUDED.display_name,
              brand_id         = EXCLUDED.brand_id,
              pit_type         = EXCLUDED.pit_type,
              sale_status      = EXCLUDED.sale_status,
              current_price    = EXCLUDED.current_price,
              deposit_price    = EXCLUDED.deposit_price,
              balance_price    = EXCLUDED.balance_price,
              original_price   = EXCLUDED.original_price,
              price_type       = EXCLUDED.price_type,
              source_url       = EXCLUDED.source_url,
              canonical_url    = EXCLUDED.canonical_url,
              cover_url        = EXCLUDED.cover_url,
              images           = EXCLUDED.images,
              visibility_status = 'published'::visibility_status,
              last_seen_at     = now(),
              updated_at       = now()
            RETURNING id
          `;

          const actualProdId = (prodRows[0] as ProductRow).id;
          if (prodRows.length > 0) dbProducts++;

          // 6c. product_images — 按 product_id 重建（反映最新 images[]，多图全量）
          await tx`DELETE FROM product_images WHERE product_id = ${actualProdId}`;
          for (let k = 0; k < imageUrls.length; k++) {
            await tx`
              INSERT INTO product_images (id, product_id, url, source_url, sort_order, is_cover)
              VALUES (${newId('img')}, ${actualProdId}, ${imageUrls[k]!}, ${imageUrls[k]!}, ${k}, ${k === 0})
              ON CONFLICT (product_id, sort_order) DO NOTHING
            `;
            dbImages++;
          }

          // 6d. price_snapshot — 价格与最新快照一致时不重复插
          const latest = await tx`
            SELECT price_cents FROM price_snapshots
            WHERE product_id = ${actualProdId}
            ORDER BY fetched_at DESC, created_at DESC LIMIT 1
          `;
          const latestPrice = (latest[0] as SnapshotRow | undefined)?.price_cents;
          if (latestPrice === undefined || latestPrice !== priceNorm.priceCents) {
            await tx`
              INSERT INTO price_snapshots (id, product_id, price_cents, original_price_cents, deposit_cents, balance_cents, source, source_url)
              VALUES (${newId('ps')}, ${actualProdId}, ${priceNorm.priceCents}, ${priceNorm.originalCents},
                      ${priceNorm.depositCents}, ${priceNorm.balanceCents}, 'taobao_import', ${sourceUrl})
            `;
            dbSnapshots++;
          }

          // 6e. source_record — raw_data_id 关联 + 幂等（dedup 唯一索引）
          const truncatedUrl = sourceUrl.length > 2000 ? sourceUrl.slice(0, 2000) : sourceUrl;
          await tx`
            INSERT INTO source_records (id, source_type, source_name, source_url, original_id, raw_data_id, entity_type, entity_id, parser_version)
            VALUES (
              ${newId('src')},
              'TAOBAO'::data_source,
              ${shopName},
              ${truncatedUrl},
              ${itemId},
              ${rawId},
              'product',
              ${actualProdId},
              'v2'
            )
            ON CONFLICT (source_type, original_id, entity_type, entity_id) DO NOTHING
          `;
          dbSources++;
        });
      } catch (err) {
        const msg = (err as Error).message;
        // products_brand_canonical_unique — 同品牌+同名但不同 item_id，预期冲突（保留已存在者）
        if (msg.includes('products_brand_canonical_unique')) {
          dbProducts++; // 已存在，不计为错误
        } else {
          console.error(`  第 ${i + 1} 条写入失败 (item_id=${itemId}):`, msg);
          dbErrors++;
        }
      }

      // 进度显示
      if ((i + 1) % Math.max(1, Math.floor(validItems.length / 10)) === 0 || i === validItems.length - 1) {
        const pct = Math.round(((i + 1) / validItems.length) * 100);
        console.log(`   进度: ${i + 1}/${validItems.length} (${pct}%)`);
      }
    }

    // 6.3 更新 import_batch 状态
    await sql`
      UPDATE import_batches
      SET success_records = ${dbProducts}, failed_records = ${dbErrors}, status = ${dbErrors > 0 ? 'failed' : 'done'}
      WHERE id = ${batchId}
    `;
  } finally {
    await sql.end();
  }

  // ----- 7. 写入结果汇总 -----
  console.log('\n===== 数据库写入完成 =====');
  console.log(`  import_batches:  ${dbBatches}`);
  console.log(`  brands:          ${dbBrands} 新建`);
  console.log(`  raw_data:        ${dbRaws} 写入`);
  console.log(`  products:        ${dbProducts} 写入/更新`);
  console.log(`  product_images:  ${dbImages} 写入`);
  console.log(`  price_snapshots: ${dbSnapshots} 写入`);
  console.log(`  source_records:  ${dbSources} 写入`);
  console.log(`  错误:            ${dbErrors}`);
  console.log('');

  exit(dbErrors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  exit(1);
});
