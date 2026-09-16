#!/usr/bin/env node
/**
 * scripts/import-legacy-json.mjs
 * 旧淘宝JSON数据导入 → 12表 products 表
 *
 * 用法: node --env-file-if-exists=.env scripts/import-legacy-json.mjs <json-file>
 *
 * 转换规则:
 * - item_id → stable product ID (prd_taobao_{item_id})
 * - product_url → canonical_url (移除追踪参数和skuId)
 * - main_image → products.images JSONB 对象数组
 * - current_price ≤ 5 → price_type=INTENTION, 不作为全价
 * - 缺少品牌映射时不创建 brand_id
 * - 重复导入更新同一商品，不覆盖已补全的新资料
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

// ─── 配置 ─────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

// ─── 工具函数 ─────────────────────────────────────────────

/** 从淘宝URL提取纯商品链接 */
function canonicalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) return `https://item.taobao.com/item.htm?id=${id}`;
    return url.split('?')[0];
  } catch {
    return url;
  }
}

/** 规范化坑向枚举 */
function normalizeCategory(raw) {
  if (!raw) return 'OTHER';
  const upper = String(raw).toUpperCase().trim();
  if (['JK', 'LOLITA', 'HANFU', 'OTHER'].includes(upper)) return upper;
  if (upper.includes('JK')) return 'JK';
  if (upper.includes('LOLI')) return 'LOLITA';
  if (upper.includes('HANFU') || upper.includes('汉服')) return 'HANFU';
  return 'OTHER';
}

/** 价格转整数分，意向金检测 */
function parsePriceCents(priceStr) {
  if (!priceStr) return { cents: null, isIntention: false };
  const num = Number(priceStr);
  if (!Number.isFinite(num) || num < 0) return { cents: null, isIntention: false };
  // ≤5元视为意向金
  if (num <= 5) return { cents: Math.round(num * 100), isIntention: true };
  // 过滤异常高价（>100000元）
  if (num > 100000) return { cents: null, isIntention: false };
  return { cents: Math.round(num * 100), isIntention: false };
}

/** 构建images JSONB */
function buildImages(imageUrl) {
  if (!imageUrl) return '[]';
  return JSON.stringify([{
    url: imageUrl,
    thumbnailUrl: null,
    width: null,
    height: null,
    sizeBytes: null,
    objectKey: null,
  }]);
}

/** 构建variants JSONB */
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
  return JSON.stringify(variants);
}

// ─── 主逻辑 ───────────────────────────────────────────────

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('Usage: node scripts/import-legacy-json.mjs <json-file>');
    process.exit(1);
  }

  const raw = await readFile(resolve(jsonPath), 'utf8');
  const data = JSON.parse(raw);

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const intentionProducts = [];

  await sql.begin(async (tx) => {
    for (const [shopName, items] of Object.entries(data)) {
      for (const item of items) {
        try {
          const itemId = item.item_id;
          if (!itemId) { skipped++; continue; }

          const productId = `prd_taobao_${itemId}`;
          const canonicalUrl = canonicalizeUrl(item.product_url);
          const category = normalizeCategory(item.pit_type || (item.categories?.[0]));
          const { cents: priceCents, isIntention } = parsePriceCents(item.current_price);
          const priceType = isIntention ? 'INTENTION' : (priceCents != null ? 'UNKNOWN' : 'UNKNOWN');
          const images = buildImages(item.main_image);
          const variants = buildVariants(item.colors, item.sizes);
          const title = String(item.title || '').trim();
          if (!title) { skipped++; continue; }

          // 检查是否已存在
          const existing = await tx`SELECT id, title, price_cents, description FROM products WHERE id = ${productId} AND deleted_at IS NULL`;

          if (existing.length > 0) {
            // 更新：不覆盖已补全的资料
            const old = existing[0];
            const updates = [];
            const vals = [];

            // 仅更新来源侧可能变化的字段
            // 不覆盖已有价格（新资料优先）
            if (old.price_cents == null && priceCents != null && !isIntention) {
              updates.push(`price_cents = $${updates.length + 1}`);
              vals.push(priceCents);
            }
            // 不覆盖已有图片（新资料优先）
            // 更新店铺名（可能变化）
            updates.push(`shop_name = $${updates.length + 1}`);
            vals.push(item.shop_name || shopName);
            updates.push(`updated_at = now()`);

            if (updates.length > 1) { // >1 because updated_at is always added
              await tx.unsafe(
                `UPDATE products SET ${updates.join(', ')} WHERE id = '${productId}'`,
                vals
              );
            }
            updated++;
          } else {
            // 新建
            const description = isIntention
              ? `意向金${item.current_price}元，全价待定`
              : '';

            const imagesJson = JSON.parse(images);
            const variantsJson = JSON.parse(variants);

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
                ${tx.json(imagesJson)}, ${tx.json(variantsJson)}, ${description},
                'UNKNOWN', ${isIntention ? null : priceCents}, ${priceType}, NULL,
                'CNY', 'taobao', ${itemId}, ${canonicalUrl},
                'published'
              )
              ON CONFLICT (id) DO NOTHING
            `;

            if (isIntention) {
              intentionProducts.push({ id: productId, title, price: item.current_price });
            }
            created++;
          }
        } catch (e) {
          errors++;
          if (errors <= 5) {
            console.error(`Error importing ${item.item_id}: ${e.message}`);
          }
        }
      }
    }
  });

  console.log(`\n=== 导入完成 ===`);
  console.log(`新建: ${created}`);
  console.log(`更新: ${updated}`);
  console.log(`跳过: ${skipped}`);
  console.log(`错误: ${errors}`);

  if (intentionProducts.length > 0) {
    console.log(`\n=== 意向金商品（${intentionProducts.length}件，价格不作为全价） ===`);
    for (const p of intentionProducts.slice(0, 10)) {
      console.log(`  ${p.id}: ${p.title} (意向金${p.price}元)`);
    }
    if (intentionProducts.length > 10) console.log(`  ... 共${intentionProducts.length}件`);
  }

  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
