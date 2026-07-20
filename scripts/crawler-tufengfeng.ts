// scripts/crawler-tufengfeng.ts — 兔缝缝品牌官网采集（Dry-run + 小规模写库）

import postgres from 'postgres';
import { OfficialBrandSourceAdapter } from '../src/crawler/sources/official-brand.js';
import { OfficialBrandParser } from '../src/crawler/parsers/official-brand-parser.js';
import { FieldNormalizer } from '../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../src/crawler/pipelines/deduplicator.js';
import { CrawlPipeline } from '../src/crawler/pipelines/crawl-pipeline.js';
import type { CrawlJobConfig } from '../src/crawler/core/types.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:sankeng@localhost:5432/sankeng';
const DRY_RUN = process.argv.includes('--dry-run');
const sql = postgres(DATABASE_URL, { max: 1 });

const config: CrawlJobConfig = {
  sourceType: 'OFFICIAL',
  sourceUrl: 'fixture://tufengfeng-official.json',
  parserVersion: 'v1',
  trigger: 'manual',
  maxRetries: 0,
  retryDelayMs: 0,
  requestTimeoutMs: 5000,
  rateLimitMs: 0,
  userAgent: 'SankengBot/1.0',
  dryRun: DRY_RUN,
};

const adapter = new OfficialBrandSourceAdapter({ rateLimitMs: 0 });
const parser = new OfficialBrandParser();
const normalizer = new FieldNormalizer();
const validator = new FieldValidator();
const deduplicator = new InMemoryDeduplicator();

const pipeline = new CrawlPipeline(sql, adapter, parser, normalizer, validator, deduplicator);

console.log(`=== 兔缝缝品牌官网采集 (${DRY_RUN ? 'Dry Run' : 'Write Mode'}) ===\n`);

const result = await pipeline.run(config);

console.log(`Job ID: ${result.stats.jobId}`);
console.log(`Status: ${result.stats.status}`);
console.log(`Fetched: ${result.stats.fetchedCount}`);
console.log(`Parsed: ${result.stats.parsedCount}`);
console.log(`Accepted: ${result.stats.acceptedCount}`);
console.log(`Rejected: ${result.stats.rejectedCount}`);
console.log(`Duplicates: ${result.stats.duplicateCount}`);
console.log(`Errors: ${result.stats.errorCount}`);

if (result.stats.errors.length > 0) {
  console.log('\nErrors:');
  result.stats.errors.forEach(e => console.log(`  - ${e}`));
}

console.log('\n--- Items ---');
for (const entry of result.items) {
  const status = entry.validation.valid ? '✅' : '❌';
  const dup = entry.dedup.action === 'insert' ? 'NEW' : entry.dedup.action === 'update' ? 'UPD' : 'SKIP';
  const dbId = entry.productId ?? '-';
  console.log(`${status} [${dup}] ${entry.item.displayName} — ¥${entry.item.currentPrice / 100} (db:${dbId})`);
  if (entry.validation.warnings.length > 0) {
    entry.validation.warnings.forEach(w => console.log(`    ⚠️  ${w.message}`));
  }
}

// 数据质量统计
console.log('\n--- 数据质量 ---');
const valid = result.items.filter(i => i.validation.valid).length;
const total = result.items.length;
console.log(`解析成功率: ${total > 0 ? (valid / total * 100).toFixed(1) : 0}%`);
console.log(`必填字段完整率: ${result.items.filter(i => i.item.canonicalName && i.item.brandName).length}/${total}`);
console.log(`来源可追踪率: ${result.items.filter(i => i.item.sourceUrl).length}/${total}`);
console.log(`图片可用率: ${result.items.filter(i => i.item.coverUrl).length}/${total}`);

await sql.end();
