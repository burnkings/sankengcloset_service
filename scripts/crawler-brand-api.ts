// scripts/crawler-brand-api.ts — 品牌 API 采集脚本（完整闭环）
// 流程：SourceAdapter → Parser → Normalizer → Validator → Deduplicator → Persistence

import postgres from 'postgres';
import { BrandApiSourceAdapter } from '../src/crawler/sources/brand-api.js';
import { BrandApiParser } from '../src/crawler/parsers/brand-api-parser.js';
import { FieldNormalizer } from '../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../src/crawler/pipelines/deduplicator.js';
import { CrawlPipeline } from '../src/crawler/pipelines/crawl-pipeline.js';
import type { CrawlJobConfig } from '../src/crawler/core/types.js';

// ────────────────────────────────────────────────
// 配置
// ────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:***@localhost:5432/sankeng';

// 解析参数
function getArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback;
}

const CRAWL_MODE = getArg('mode', 'incremental') as 'incremental' | 'full' | 'backfill' | 'manual';
const BRAND_ID = getArg('brand-id', '');
const MAX_ITEMS = parseInt(getArg('max-items', '50'), 10);

// Full/Backfill 硬上限
const HARD_LIMITS: Record<string, number> = { incremental: 500, full: 1000, backfill: 500, manual: 1000 };
const cappedMax = Math.min(MAX_ITEMS, HARD_LIMITS[CRAWL_MODE] || 200);

// 数据源：fixture 模式（本地测试）或 HTTP 模式（真实采集）
const SOURCE_URL = process.argv.includes('--http')
  ? 'http://127.0.0.1:9876/api/products'
  : 'fixture://brand-tufengfeng-api.json';

const config: CrawlJobConfig = {
  sourceType: 'OFFICIAL',
  sourceUrl: SOURCE_URL,
  parserVersion: 'v1',
  trigger: 'manual',
  maxRetries: 2,
  retryDelayMs: 2000,
  requestTimeoutMs: 10000,
  rateLimitMs: 2000,
  userAgent: 'SankengBot/1.0 (+https://sankengcloset.com)',
  dryRun: DRY_RUN,
  crawlMode: CRAWL_MODE,
};

// ────────────────────────────────────────────────
// 初始化
// ────────────────────────────────────────────────

const sql = postgres(DATABASE_URL, { max: 2 });
const adapter = new BrandApiSourceAdapter({ rateLimitMs: 0 });
const parser = new BrandApiParser();
const normalizer = new FieldNormalizer();
const validator = new FieldValidator();
const deduplicator = new InMemoryDeduplicator();

const pipeline = new CrawlPipeline(sql, adapter, parser, normalizer, validator, deduplicator);

// ────────────────────────────────────────────────
// 执行
// ────────────────────────────────────────────────

console.log(`=== Phase D5.2: Brand API Crawler ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'} | CrawlMode: ${CRAWL_MODE}`);
console.log(`MaxItems: ${cappedMax}${MAX_ITEMS !== cappedMax ? ` (capped from ${MAX_ITEMS})` : ''}`);
console.log(`Brand: ${BRAND_ID || 'all'} | Source: ${SOURCE_URL}\n`);

try {
  const result = await pipeline.run(config);

  console.log(`--- Job Stats ---`);
  console.log(`Job ID:      ${result.stats.jobId}`);
  console.log(`Status:      ${result.stats.status}`);
  console.log(`Fetched:     ${result.stats.fetchedCount}`);
  console.log(`Parsed:      ${result.stats.parsedCount}`);
  console.log(`Accepted:    ${result.stats.acceptedCount}`);
  console.log(`Rejected:    ${result.stats.rejectedCount}`);
  console.log(`Duplicates:  ${result.stats.duplicateCount}`);
  console.log(`Errors:      ${result.stats.errorCount}`);

  if (result.stats.errors.length > 0) {
    console.log(`\n--- Errors ---`);
    result.stats.errors.forEach(e => console.log(`  ❌ ${e}`));
  }

  console.log(`\n--- Items ---`);
  for (const entry of result.items) {
    const status = entry.validation.valid ? '✅' : '❌';
    const dup = entry.dedup.action === 'insert' ? 'NEW'
      : entry.dedup.action === 'update' ? 'DUP'
      : 'SKIP';
    const price = `¥${entry.item.currentPrice / 100}`;
    console.log(`${status} [${dup}] ${entry.item.displayName} — ${price} (${entry.item.pitType})`);

    if (entry.validation.warnings.length > 0) {
      entry.validation.warnings.forEach(w => console.log(`    ⚠️  ${w.message}`));
    }
    if (entry.productId) {
      console.log(`    📦 productId: ${entry.productId}`);
    }
  }

  // 二次运行测试幂等性
  if (!DRY_RUN && result.stats.acceptedCount > 0) {
    console.log(`\n--- 幂等性测试（第二次运行）---`);

    // 记录运行前的数量
    const countBefore = await sql`SELECT count(*) as cnt FROM products WHERE deleted_at IS NULL`;
    const productsBefore = Number(countBefore[0]!.cnt);
    const srcBefore = await sql`SELECT count(*) as cnt FROM source_records`;
    const psBefore = await sql`SELECT count(*) as cnt FROM price_snapshots`;

    const result2 = await pipeline.run(config);

    // 检查运行后的数量
    const countAfter = await sql`SELECT count(*) as cnt FROM products WHERE deleted_at IS NULL`;
    const productsAfter = Number(countAfter[0]!.cnt);
    const srcAfter = await sql`SELECT count(*) as cnt FROM source_records`;
    const psAfter = await sql`SELECT count(*) as cnt FROM price_snapshots`;

    console.log(`产品数量: ${productsBefore} → ${productsAfter} (不应新增)`);
    console.log(`来源记录: ${srcBefore[0]!.cnt} → ${srcAfter[0]!.cnt} (不应新增)`);
    console.log(`价格快照: ${psBefore[0]!.cnt} → ${psAfter[0]!.cnt} (同价不新增)`);
    console.log(`第二次 accepted: ${result2.stats.acceptedCount}`);

    const noNewProducts = productsAfter === productsBefore;
    const noNewSourceRecords = srcAfter[0]!.cnt === srcBefore[0]!.cnt;
    const noNewPriceSnapshots = psAfter[0]!.cnt === psBefore[0]!.cnt;

    console.log(`\n幂等性: ${noNewProducts && noNewSourceRecords && noNewPriceSnapshots ? '✅ 通过' : '❌ 失败'}`);
    if (!noNewProducts) console.log(`  ❌ 产品数量增加了 ${productsAfter - productsBefore}`);
    if (!noNewSourceRecords) console.log(`  ❌ 来源记录增加了 ${Number(srcAfter[0]!.cnt) - Number(srcBefore[0]!.cnt)}`);
    if (!noNewPriceSnapshots) console.log(`  ❌ 价格快照增加了 ${Number(psAfter[0]!.cnt) - Number(psBefore[0]!.cnt)}`);
  }

} catch (e) {
  console.error(`\n❌ 采集失败: ${(e as Error).message}`);
  console.error((e as Error).stack);
} finally {
  await sql.end();
}
