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
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:sankeng@localhost:5432/sankeng';

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

console.log(`=== Phase D4: Brand API Crawler ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);
console.log(`Source: ${SOURCE_URL}\n`);

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
    const result2 = await pipeline.run(config);
    console.log(`Accepted: ${result2.stats.acceptedCount} (应为 0)`);
    console.log(`Duplicates: ${result2.stats.duplicateCount}`);
    const idempotent = result2.stats.acceptedCount === 0;
    console.log(`幂等性: ${idempotent ? '✅ 通过' : '❌ 失败'}`);
  }

} catch (e) {
  console.error(`\n❌ 采集失败: ${(e as Error).message}`);
  console.error((e as Error).stack);
} finally {
  await sql.end();
}
