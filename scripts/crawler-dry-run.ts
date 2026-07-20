// scripts/crawler-dry-run.ts — Dry-run 命令

import postgres from 'postgres';
import { FixtureSourceAdapter } from '../src/crawler/sources/fixture-source.js';
import { JsonParser } from '../src/crawler/parsers/json-parser.js';
import { FieldNormalizer } from '../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../src/crawler/pipelines/deduplicator.js';
import { CrawlPipeline } from '../src/crawler/pipelines/crawl-pipeline.js';
import type { CrawlJobConfig } from '../src/crawler/core/types.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:sankeng@localhost:5432/sankeng';
const sql = postgres(DATABASE_URL, { max: 1 });

const config: CrawlJobConfig = {
  sourceType: 'FIXTURE',
  sourceUrl: 'fixture://sample-products.json',
  parserVersion: 'v1',
  trigger: 'manual',
  maxRetries: 0,
  retryDelayMs: 0,
  requestTimeoutMs: 5000,
  rateLimitMs: 0,
  userAgent: 'SankengBot/1.0',
  dryRun: true,
};

const adapter = new FixtureSourceAdapter({ rateLimitMs: 0 });
const parser = new JsonParser();
const normalizer = new FieldNormalizer();
const validator = new FieldValidator();
const deduplicator = new InMemoryDeduplicator();

const pipeline = new CrawlPipeline(sql, adapter, parser, normalizer, validator, deduplicator);

console.log('=== Dry Run: Fixture Source ===\n');

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
  const dup = entry.dedup.action === 'insert' ? 'NEW' : entry.dedup.action === 'update' ? 'DUP' : 'SKIP';
  console.log(`${status} [${dup}] ${entry.item.displayName} — ¥${entry.item.currentPrice / 100}`);
  if (entry.validation.warnings.length > 0) {
    entry.validation.warnings.forEach(w => console.log(`    ⚠️  ${w.message}`));
  }
}

await sql.end();
