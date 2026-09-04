/**
 * 商品数据文件格式校验 — 导入前必跑
 *
 * 用法：
 *   node --env-file=.env.production --import tsx scripts/validate-data-file.ts /home/admin/xxx.json
 *   node --env-file=.env.production --import tsx scripts/validate-data-file.ts /home/admin/xxx.json --strict
 *
 * 校验项（对应 docs/DATA-FILE-FORMAT-SPEC.md）：
 *   1. 顶层结构：店铺 key → 商品数组
 *   2. item_id 唯一（重复 = 同商品采两次）
 *   3. 必填字段：item_id / title / shop_name
 *   4. categories：必须是大写三坑枚举单值（JK/LOLITA/HANFU/OTHER），禁止淘宝类目层级/中文/多值
 *   5. pit_type：与 categories 同值（若两者都提供必须一致）
 *   6. current_price：数字或数字字符串；9999 占位价告警
 *   7. sku_checked && sku_failed 同时为 true（自相矛盾）
 *   8. 控制字符 \x00-\x1f\x7f（店铺名/标题）
 *   9. main_image 扩展名与 URL 尾部一致（.jpg/.jpeg/.png/.webp）
 *
 * 退出码：0 = 通过（--strict 下 0 错误）；1 = 存在错误；2 = 用法错误
 */
import { readFileSync } from 'node:fs';
import { exit } from 'node:process';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const jsonPath = args.find((a) => !a.startsWith('--'));

if (!jsonPath) {
  console.error('用法: validate-data-file.ts <data.json> [--strict]');
  exit(2);
}

const VALID_PIT = ['JK', 'LOLITA', 'HANFU', 'OTHER'] as const;
const CTRL_RE = /[\x00-\x1f\x7f]/;
const IMG_EXT_RE = /\.(jpe?g|png|webp)$/i;

interface RawItem {
  item_id?: string;
  title?: string;
  shop_name?: string;
  current_price?: number | string;
  main_image?: string;
  categories?: string[];
  pit_type?: string;
  sku_checked?: boolean;
  sku_failed?: boolean;
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
} catch (e) {
  console.error(`✗ JSON 解析失败: ${(e as Error).message}`);
  exit(1);
}
if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
  console.error('✗ 顶层必须是 { 店铺名: [商品...] } 对象');
  exit(1);
}

const shops = raw as Record<string, RawItem[]>;
const items = Object.entries(shops).flatMap(([shop, arr]) =>
  (arr ?? []).map((p) => ({ ...p, _shop: shop }))
);

const errors: string[] = [];
const warnings: string[] = [];
const seenIds = new Map<string, number>();

function err(msg: string): void {
  errors.push(msg);
}
function warn(msg: string): void {
  warnings.push(msg);
}

console.log(`文件: ${jsonPath}`);
console.log(`店铺数: ${Object.keys(shops).length} | 商品数: ${items.length}\n`);

// 0. 店铺 value 类型
for (const [shop, arr] of Object.entries(shops)) {
  if (!Array.isArray(arr)) err(`店铺 "${shop}" 的 value 不是数组`);
}

// 逐商品检查
const catsBad: string[] = [];
const catsEmpty = { n: 0 };
items.forEach((p, i) => {
  const at = `#${i + 1} "${(p.title ?? '').slice(0, 30)}"`;

  // 1. 必填
  if (!p.item_id) err(`${at} 缺 item_id`);
  if (!p.title) err(`${at} 缺 title`);
  if (!p.shop_name) err(`${at} 缺 shop_name`);

  // 2. item_id 唯一
  if (p.item_id) {
    const prev = seenIds.get(p.item_id);
    if (prev !== undefined) err(`${at} item_id 重复（#${prev}）`);
    else seenIds.set(p.item_id, i + 1);
  }

  // 3. categories：三坑枚举单值
  const cats = p.categories;
  if (cats === undefined || cats === null) {
    catsEmpty.n++;
  } else if (!Array.isArray(cats)) {
    err(`${at} categories 必须是数组`);
  } else if (cats.length === 0) {
    catsEmpty.n++;
    if (strict) err(`${at} categories 空数组（规范：省略或 ["OTHER"]）`);
  } else if (cats.length > 1) {
    err(`${at} categories 多值 ${JSON.stringify(cats)}（一条商品只属一坑，禁止 ["JK","洛丽塔"] 层级）`);
    catsBad.push(JSON.stringify(cats));
  } else {
    const cat0 = cats[0] ?? '';
    const v = cat0.trim().toUpperCase();
    if (!VALID_PIT.includes(v as (typeof VALID_PIT)[number])) {
      err(`${at} categories 非法值 "${cat0}"（须为 JK/LOLITA/HANFU/OTHER，禁止淘宝类目/中文别名）`);
      catsBad.push(cat0);
    } else if (v !== cat0) {
      err(`${at} categories 非大写枚举 "${cat0}"（须为 ${v}）`);
    }
  }

  // 4. pit_type 与 categories 一致
  const pt = (p.pit_type ?? '').trim().toUpperCase();
  const cat0 = (cats && cats.length === 1 ? cats[0] ?? '' : '').trim().toUpperCase();
  if (pt && !VALID_PIT.includes(pt as (typeof VALID_PIT)[number])) {
    err(`${at} pit_type 非法值 "${p.pit_type}"`);
  } else if (pt && cat0 && cat0 !== pt) {
    err(`${at} pit_type=${p.pit_type} 与 categories=${cats?.[0]} 不一致`);
  }

  // 5. 价格
  const price = p.current_price;
  if (price != null && price !== '') {
    const n = typeof price === 'string' ? Number.parseFloat(price) : Number(price);
    if (Number.isNaN(n)) err(`${at} current_price 非数字 "${price}"`);
    else if (n === 9999) warn(`${at} current_price=9999 疑似占位价（意向金/售罄展示）`);
    else if (n < 0) err(`${at} current_price 负数 ${price}`);
  }

  // 6. sku 自相矛盾
  if (p.sku_checked === true && p.sku_failed === true) {
    warn(`${at} sku_checked 与 sku_failed 同时为 true`);
  }

  // 7. 控制字符
  if (p.shop_name && CTRL_RE.test(p.shop_name)) err(`${at} shop_name 含控制字符`);
  if (p.title && CTRL_RE.test(p.title)) err(`${at} title 含控制字符`);

  // 8. 图片扩展名
  if (p.main_image) {
    const base = p.main_image.split('?')[0] ?? '';
    if (base && !IMG_EXT_RE.test(base)) {
      err(`${at} main_image 扩展名非图片格式 ${base.slice(-30)}`);
    }
  }
});

// 汇总
console.log(`[必填/结构] 缺失 item_id/title/shop_name 等错误: ${errors.length} 条`);
console.log(`[categories] 空/省略: ${catsEmpty.n} 条 | 非法或多值: ${catsBad.length} 条`);
console.log(`[告警] ${warnings.length} 条（价格占位/sku矛盾/图片扩展名）`);
if (catsBad.length) {
  console.log('categories 非法样例:', [...new Set(catsBad)].slice(0, 5).join(' | '));
}

if (errors.length) {
  console.error(`\n✗ 校验未通过：${errors.length} 个错误（--strict 下 ${warnings.length} 个告警也算失败）`);
  errors.slice(0, 30).forEach((e) => console.error('  ✗', e));
  exit(1);
}
if (strict && warnings.length) {
  console.error(`\n✗ strict 模式：${warnings.length} 个告警视为失败`);
  warnings.slice(0, 30).forEach((w) => console.error('  ⚠', w));
  exit(1);
}
console.log(`\n✓ 校验通过（${items.length} 条商品，${warnings.length} 条告警）`);
exit(0);
