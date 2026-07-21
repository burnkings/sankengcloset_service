// scripts/crawler-test-no-db.ts — 无数据库管道测试
import { BrandApiSourceAdapter } from '../src/crawler/sources/brand-api.js';
import { BrandApiParser } from '../src/crawler/parsers/brand-api-parser.js';
import { FieldNormalizer } from '../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../src/crawler/pipelines/deduplicator.js';

const adapter = new BrandApiSourceAdapter({ rateLimitMs: 0 });
const parser = new BrandApiParser();
const normalizer = new FieldNormalizer();
const validator = new FieldValidator();
const deduplicator = new InMemoryDeduplicator();

console.log('=== Phase D4: Pipeline Test (No DB) ===\n');

// 1. Fetch
const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
console.log(`1. Fetch: status=${results[0]!.statusCode} type=${results[0]!.contentType}`);

// 2. Parse
const parsed = parser.parseList(results[0]!);
console.log(`2. Parse: ${parsed.length} items`);

// 3. Normalize + Validate + Dedup
let accepted = 0;
let rejected = 0;

for (const item of parsed) {
  const normalized = normalizer.normalize(item);
  const validation = validator.validate(normalized);
  const dedup = await deduplicator.check(normalized);

  const status = validation.valid ? '✅' : '❌';
  const dup = dedup.action === 'insert' ? 'NEW' : 'DUP';
  console.log(`${status} [${dup}] ${normalized.displayName} — ¥${normalized.currentPrice / 100} (${normalized.pitType}) conf=${normalized.confidence}`);

  if (validation.valid) accepted++;
  else rejected++;
}

console.log(`\n3. Results: ${accepted} accepted, ${rejected} rejected`);

// 4. Idempotency test
console.log('\n--- Idempotency Test ---');
const existing = parsed.map((item, i) => ({
  id: `existing_${i}`,
  brandId: 'br_001',
  canonicalName: normalizer.normalize(item).canonicalName,
  sourceUrl: item.sourceUrl,
}));
deduplicator.load(existing);

let dups = 0;
for (const item of parsed) {
  const normalized = normalizer.normalize(item);
  const dedup = await deduplicator.check(normalized);
  if (dedup.action === 'update') dups++;
}
console.log(`Second run: ${dups}/${parsed.length} detected as duplicates`);
console.log(`Idempotency: ${dups === parsed.length ? '✅ PASS' : '❌ FAIL'}`);

console.log('\n=== Pipeline Complete ===');
