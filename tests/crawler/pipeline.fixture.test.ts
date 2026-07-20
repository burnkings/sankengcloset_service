// tests/crawler/pipeline.fixture.test.ts — Fixture 集成测试

import { describe, it, expect } from 'vitest';
import { FixtureSourceAdapter } from '../../src/crawler/sources/fixture-source.js';
import { JsonParser } from '../../src/crawler/parsers/json-parser.js';
import { FieldNormalizer } from '../../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../../src/crawler/pipelines/deduplicator.js';

describe('Fixture Pipeline (no DB)', () => {
  const adapter = new FixtureSourceAdapter({ rateLimitMs: 0 });
  const parser = new JsonParser();
  const normalizer = new FieldNormalizer();
  const validator = new FieldValidator();

  it('should fetch fixture data', async () => {
    const results = await adapter.fetchList('fixture://sample-products.json');
    expect(results).toHaveLength(1);
    expect(results[0]!.statusCode).toBe(200);
    const items = JSON.parse(results[0]!.body);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(3);
  });

  it('should parse fixture JSON', async () => {
    const results = await adapter.fetchList('fixture://sample-products.json');
    const items = parser.parseList(results[0]!);
    expect(items).toHaveLength(3);
    expect(items[0]!.canonicalName).toBe('深蓝格裙 45cm');
    expect(items[0]!.pitType).toBe('JK');
    expect(items[1]!.pitType).toBe('LOLITA');
    expect(items[2]!.pitType).toBe('HANFU');
  });

  it('should normalize and validate all items', async () => {
    const results = await adapter.fetchList('fixture://sample-products.json');
    const parsed = parser.parseList(results[0]!);

    for (const item of parsed) {
      const normalized = normalizer.normalize(item);
      const validation = validator.validate(normalized);
      expect(validation.valid).toBe(true);
      expect(normalized.confidence).toBeGreaterThan(0);
    }
  });

  it('should deduplicate correctly', async () => {
    const deduplicator = new InMemoryDeduplicator();
    deduplicator.load([
      { id: 'existing-1', brandId: 'br_001', brandName: '兔缝缝', canonicalName: '深蓝格裙 45cm', sourceUrl: '' },
    ]);

    const results = await adapter.fetchList('fixture://sample-products.json');
    const parsed = parser.parseList(results[0]!);

    const normalized0 = normalizer.normalize(parsed[0]!);
    const dedup0 = await deduplicator.check(normalized0);
    expect(dedup0.action).toBe('update');

    const normalized1 = normalizer.normalize(parsed[1]!);
    const dedup1 = await deduplicator.check(normalized1);
    expect(dedup1.action).toBe('insert');
  });
});
