// scripts/cleaning-report.ts — 数据清洗报告

import postgres from 'postgres';
import { CleaningPipeline } from '../src/crawler/cleaning/cleaning-pipeline.js';
import { TextCleaner } from '../src/crawler/cleaning/text-cleaner.js';
import { AdvancedDeduplicator } from '../src/crawler/cleaning/advanced-deduplicator.js';
import { QualityScorer } from '../src/crawler/cleaning/quality-scorer.js';
import type { ParsedItem } from '../src/crawler/core/types.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:sankeng@localhost:5432/sankeng';
const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  console.log('=== Phase D5: 数据清洗报告 ===\n');

  // 1. 加载所有产品
  const products = await sql`
    SELECT p.*, b.name as brand_name
    FROM products p LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.deleted_at IS NULL
    ORDER BY p.created_at
  `;

  console.log(`产品总数: ${products.length}\n`);

  // 2. 清洗管道
  const pipeline = new CleaningPipeline();
  const textCleaner = new TextCleaner();
  const deduplicator = new AdvancedDeduplicator();
  const qualityScorer = new QualityScorer();

  // 加载去重数据
  deduplicator.load(products.map(p => ({
    id: String(p.id),
    canonicalName: String(p.canonical_name),
    brandName: String(p.brand_name ?? ''),
    category: String(p.category),
    currentPrice: Number(p.current_price),
    sourceUrl: String(p.source_url),
    sourcePlatform: String(p.source_platform),
    images: Array.isArray(p.images) ? p.images.map(String) : [],
  })));

  // 3. 清洗每个产品
  let totalNeedsReview = 0;
  let totalDuplicates = 0;
  let priceIssues = 0;
  let dateIssues = 0;
  const qualityScores: number[] = [];
  const reviewReasons: Record<string, number> = {};

  for (const p of products) {
    const item: ParsedItem = {
      sourceUrl: String(p.source_url),
      externalId: String(p.external_id ?? ''),
      canonicalName: String(p.canonical_name),
      displayName: String(p.display_name),
      brandName: String(p.brand_name ?? ''),
      category: String(p.category),
      subCategory: String(p.sub_category ?? ''),
      pitType: String(p.pit_type) as any,
      currentPrice: Number(p.current_price),
      originalPrice: Number(p.original_price),
      depositPrice: Number(p.deposit_price),
      balancePrice: Number(p.balance_price),
      currency: String(p.currency ?? 'CNY'),
      saleStatus: String(p.sale_status),
      description: String(p.description),
      rawDescription: String(p.raw_description),
      coverUrl: String(p.cover_url),
      images: Array.isArray(p.images) ? p.images.map(String) : [],
      sourcePublishedAt: p.source_published_at ? String(p.source_published_at) : null,
      shopUrl: String(p.shop_url ?? ''),
      tags: [],
    };

    const cleaned = pipeline.clean(item);
    if (cleaned.needsReview) {
      totalNeedsReview++;
      for (const r of cleaned.reviewReasons) {
        reviewReasons[r] = (reviewReasons[r] ?? 0) + 1;
      }
    }
    if (cleaned.cleanPrice.currentPrice <= 0) priceIssues++;
    if (!cleaned.cleanTime.iso && item.sourcePublishedAt) { dateIssues++; }
    qualityScores.push(cleaned.qualityScore.total);

    // 去重检查
    const matches = deduplicator.findMatches({
      canonicalName: cleaned.canonicalName,
      brandName: cleaned.brandName,
      category: cleaned.category,
      currentPrice: cleaned.currentPrice,
      sourceUrl: cleaned.sourceUrl,
      images: cleaned.images,
    });
    if (matches.length > 0) totalDuplicates++;
  }

  // 4. 输出报告
  console.log('--- 清洗统计 ---');
  console.log(`需要人工审核: ${totalNeedsReview}/${products.length}`);
  console.log(`疑似重复: ${totalDuplicates}/${products.length}`);
  console.log(`价格问题: ${priceIssues}/${products.length}`);
  console.log(`日期问题: ${dateIssues}/${products.length}`);

  console.log('\n--- 审核原因分布 ---');
  for (const [reason, count] of Object.entries(reviewReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log('\n--- 质量评分分布 ---');
  const sorted = [...qualityScores].sort((a, b) => a - b);
  const avg = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
  console.log(`  平均分: ${avg.toFixed(1)}`);
  console.log(`  最低分: ${sorted[0]}`);
  console.log(`  最高分: ${sorted[sorted.length - 1]}`);
  console.log(`  中位数: ${sorted[Math.floor(sorted.length / 2)]}`);

  // 质量区间分布
  const ranges = [
    { label: '90-100 (优秀)', min: 90, max: 100 },
    { label: '70-89 (良好)', min: 70, max: 89 },
    { label: '50-69 (一般)', min: 50, max: 69 },
    { label: '0-49 (差)', min: 0, max: 49 },
  ];
  for (const r of ranges) {
    const count = qualityScores.filter(s => s >= r.min && s <= r.max).length;
    console.log(`  ${r.label}: ${count}`);
  }

  // 5. 清洗前后对比（抽样）
  console.log('\n--- 清洗前后对比（前5条） ---');
  for (let i = 0; i < Math.min(5, products.length); i++) {
    const p = products[i];
    const raw = String(p?.canonical_name ?? "");
    const cleaned = raw ? textCleaner.cleanTitle(raw) : ""
    const changed = raw !== cleaned ? ` → "${cleaned}"` : ' (无变化)';
    console.log(`  ${raw}${changed}`);
  }

  // 6. 原始数据保留确认
  const rawCount = await sql`SELECT count(*) as cnt FROM products WHERE raw_description != '' AND deleted_at IS NULL`;
  console.log(`\n--- 原始数据保留 ---`);
  console.log(`  保留原始描述的产品: ${(rawCount[0] ?? {cnt: 0}).cnt}/${products.length}`);

  await sql.end();
  console.log('\n=== 报告完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
