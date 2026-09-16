#!/usr/bin/env node
/**
 * scripts/import-legacy-json.mjs
 * 旧淘宝JSON数据导入 → 12表 products 表
 *
 * 价格类型识别规则（基于标题语义，非金额大小）：
 * - 标题含"意向金" → INTENTION，price_cents=null
 * - 标题含"定金"且无"全款" → DEPOSIT，price_cents=定金金额
 * - 标题含"尾款" → BALANCE，price_cents=尾款金额
 * - 其他 → UNKNOWN，price_cents=报价（参考价，非全价）
 * - 缺失/负数/非数字/异常高价 → null
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }
const sql = postgres(DATABASE_URL, { max: 1 });

function canonicalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) return `https://item.taobao.com/item.htm?id=${id}`;
    return url.split('?')[0];
  } catch { return url; }
}

function normalizeCategory(raw) {
  if (!raw) return 'OTHER';
  const upper = String(raw).toUpperCase().trim();
  if (['JK', 'LOLITA', 'HANFU', 'OTHER'].includes(upper)) return upper;
  if (upper.includes('JK')) return 'JK';
  if (upper.includes('LOLI')) return 'LOLITA';
  if (upper.includes('HANFU') || upper.includes('汉服')) return 'HANFU';
  return 'OTHER';
}

/** 基于标题语义识别价格类型 */
function detectPriceType(title, priceNum) {
  if (!title) return { type: 'UNKNOWN', cents: parsePrice(priceNum), description: '' };
  
  const t = title;
  
  // 意向金：标题明确含"意向金"
  if (/意向金/.test(t)) {
    return { type: 'INTENTION', cents: null, description: `意向金${priceNum}元，全价待定` };
  }
  
  // 定金：标题含"定金"（不含"全款"等）
  if (/定金/.test(t) && !/全款|全价/.test(t)) {
    const cents = parsePrice(priceNum);
    return { type: 'DEPOSIT', cents, description: '' };
  }
  
  // 尾款：标题含"尾款"
  if (/尾款/.test(t)) {
    const cents = parsePrice(priceNum);
    return { type: 'BALANCE', cents, description: '' };
  }
  
  // 抵扣信息：标题含"抵X元"，不推导全价
  if (/抵\d+元/.test(t)) {
    return { type: 'INTENTION', cents: null, description: `抵扣商品，全价待定` };
  }
  
  // 普通报价
  const cents = parsePrice(priceNum);
  return { type: 'UNKNOWN', cents, description: '' };
}

function parsePrice(priceNum) {
  if (priceNum == null) return null;
  const num = Number(priceNum);
  if (!Number.isFinite(num) || num < 0) return null;
  if (num > 100000) return null; // 异常高价
  return Math.round(num * 100);
}

function buildImages(imageUrl) {
  if (!imageUrl) return [];
  return [{ url: imageUrl, thumbnailUrl: null, width: null, height: null, sizeBytes: null, objectKey: null }];
}

function buildVariants(colors, sizes) {
  const variants = [];
  if (Array.isArray(colors)) {
    for (const c of colors) {
      if (c) variants.push({ id: `color-${c}`, name: '', styleName: '', colorName: String(c), sizeName: '' });
    }
  }
  if (Array.isArray(sizes)) {
    for (const s of sizes) {
      if (s) variants.push({ id: `size-${s}`, name: '', styleName: '', colorName: '', sizeName: String(s) });
    }
  }
  return variants;
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Usage: node scripts/import-legacy-json.mjs <json-file>'); process.exit(1); }

  const raw = await readFile(resolve(jsonPath), 'utf8');
  const data = JSON.parse(raw);

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const stats = { intention: 0, deposit: 0, balance: 0, unknown: 0, nullPrice: 0 };

  await sql.begin(async (tx) => {
    for (const [shopName, items] of Object.entries(data)) {
      for (const item of items) {
        try {
          const itemId = item.item_id;
          if (!itemId) { skipped++; continue; }

          const productId = `prd_taobao_${itemId}`;
          const canonicalUrl = canonicalizeUrl(item.product_url);
          const category = normalizeCategory(item.pit_type || (item.categories?.[0]));
          const title = String(item.title || '').trim();
          if (!title) { skipped++; continue; }

          const { type: priceType, cents: priceCents, description } = detectPriceType(title, item.current_price);
          
          // 统计
          if (priceType === 'INTENTION') stats.intention++;
          else if (priceType === 'DEPOSIT') stats.deposit++;
          else if (priceType === 'BALANCE') stats.balance++;
          else stats.unknown++;
          if (priceCents == null) stats.nullPrice++;

          const images = buildImages(item.main_image);
          const variants = buildVariants(item.colors, item.sizes);

          // 检查是否已存在
          const existing = await tx`SELECT id, title, price_cents, price_type, description, images FROM products WHERE id = ${productId} AND deleted_at IS NULL`;

          if (existing.length > 0) {
            // 更新：修正价格类型（不覆盖已补全的其他资料）
            const old = existing[0];
            
            // 更新价格类型（仅当现有类型为UNKNOWN或null时）
            const shouldUpdatePrice = (old.price_type === 'UNKNOWN' || old.price_type == null) && priceType !== 'UNKNOWN';
            const shouldUpdateDescription = (old.description === '' || old.description == null) && description !== '';
            
            await tx`UPDATE products SET 
              price_type = CASE WHEN ${shouldUpdatePrice} THEN ${priceType} ELSE price_type END,
              price_cents = CASE WHEN ${shouldUpdatePrice} THEN ${priceCents} ELSE price_cents END,
              description = CASE WHEN ${shouldUpdateDescription} THEN ${description} ELSE description END,
              shop_name = ${item.shop_name || shopName}, 
              updated_at = now() 
              WHERE id = ${productId}`;
            updated++;
          } else {
            // 新建
            await tx`
              INSERT INTO products (
                id, title, brand_id, shop_name, category, sub_category,
                images, variants, description,
                sale_status, price_cents, price_type, original_price_cents,
                currency, source_platform, external_id, canonical_url,
                visibility_status
              ) VALUES (
                ${productId}, ${title}, NULL, ${item.shop_name || shopName},
                ${category}, '',
                ${tx.json(images)}, ${tx.json(variants)}, ${description},
                'UNKNOWN', ${priceCents}, ${priceType}, NULL,
                'CNY', 'taobao', ${itemId}, ${canonicalUrl},
                'published'
              )
              ON CONFLICT (id) DO UPDATE SET
                price_cents = EXCLUDED.price_cents,
                price_type = EXCLUDED.price_type,
                description = CASE WHEN products.description = '' THEN EXCLUDED.description ELSE products.description END,
                updated_at = now()
            `;
            created++;
          }
        } catch (e) {
          errors++;
          if (errors <= 5) console.error(`Error importing ${item.item_id}: ${e.message}`);
        }
      }
    }
  });

  console.log(`\n=== 导入完成 ===`);
  console.log(`新建: ${created}`);
  console.log(`更新: ${updated}`);
  console.log(`跳过: ${skipped}`);
  console.log(`错误: ${errors}`);
  console.log(`\n=== 价格类型统计 ===`);
  console.log(`意向金 (INTENTION): ${stats.intention}`);
  console.log(`定金 (DEPOSIT): ${stats.deposit}`);
  console.log(`尾款 (BALANCE): ${stats.balance}`);
  console.log(`普通报价 (UNKNOWN): ${stats.unknown}`);
  console.log(`无价格 (null): ${stats.nullPrice}`);

  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });