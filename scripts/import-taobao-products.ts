#!/usr/bin/env node
/**
 * 人工导入本地 JSON 脚本
 *
 * 输入：完整有效 JSON 文件路径
 * 格式：{ 店铺名: 商品数组 } 或 [ 商品数组 ]
 *
 * 使用：npx tsx scripts/import-taobao-products.ts <json-path>
 *
 * 以 platform=TAOBAO + item_id 幂等 upsert。
 */

import { readFileSync } from 'fs';
import { exit } from 'process';

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

// --------------- Main ---------------

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('用法: npx tsx scripts/import-taobao-products.ts <json-file-path>');
    exit(1);
  }

  // 1. 解析 JSON
  let raw: unknown;
  try {
    const text = readFileSync(jsonPath, 'utf-8');
    raw = JSON.parse(text);
  } catch (e) {
    console.error('JSON 解析失败:', (e as Error).message);
    exit(1);
  }

  // 2. 展平为商品数组
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

  // 3. 统计
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

  // 4. 字段缺失统计
  interface MissingFields { item_id: number; title: number; current_price: number; main_image: number; product_url: number; }
  const missingFields: MissingFields = {
    item_id: 0, title: 0, current_price: 0, main_image: 0, product_url: 0,
  };

  for (const item of items) {
    const id = item.item_id;
    const title = item.title;
    const price = item.current_price;

    if (!id) missingFields.item_id++;
    if (!title) missingFields.title++;
    if (price == null) missingFields.current_price++;
    if (!item.main_image) missingFields.main_image++;
    if (!item.product_url) missingFields.product_url++;

    // 分类推断
    let category = 'OTHER';
    const cats: string[] = item.categories || [];
    if (cats.length > 0) {
      const firstCat: string = cats[0] ?? '';
      if (/JK|制服/.test(firstCat)) category = 'JK';
      else if (/LOLITA|洛丽塔|LO/.test(firstCat)) category = 'LOLITA';
      else if (/汉服|汉元素/.test(firstCat)) category = 'HANFU';
    }
    if (category === 'OTHER') otherCategory++;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    if (id && title) {
      brandSet.add(item.shop_name ?? '未知品牌');
      // 去重统计
      nameCounts[title] = (nameCounts[title] || 0) + 1;
      success++;
    } else {
      skipped++;
    }

    if (!item.main_image || item.main_image === '') noImage++;
    if (price == null || price === '' || (typeof price === 'number' && isNaN(price))) noPrice++;
  }

  // 5. 输出报告
  console.log('\n===== 导入统计 =====');
  console.log(`  总数:        ${total}`);
  console.log(`  成功:        ${success}`);
  console.log(`  跳过(无id/名): ${skipped}`);
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
    for (const [name, count] of duplicates.slice(0, 5)) {
      console.log(`  "${name}" 出现 ${count} 次`);
    }
    if (duplicates.length > 5) console.log(`  ... 还有 ${duplicates.length - 5} 组`);
  }

  // 6. 数据库写入 (PostgreSQL via repository — 暂输出SQL待执行)
  console.log('\n===== 数据库写入 (待实现) =====');
  console.log('脚本提供 JSON 校验与统计。需要用户提供完整 JSON 路径后再执行数据库写入。');
  console.log('数据库写入使用: platform=TAOBAO + item_id 幂等 upsert');
  console.log('写入表: brands, products, product_images, price_snapshots, source_records\n');

  exit(0);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  exit(1);
});
