// tests/crawler/brand-api.integration.test.ts — 品牌 API 采集集成测试
// 验证完整管道：Source → Parser → Normalizer → Validator → Deduplicator

import { describe, it, expect } from 'vitest';
import { BrandApiSourceAdapter } from '../../src/crawler/sources/brand-api.js';
import { BrandApiParser } from '../../src/crawler/parsers/brand-api-parser.js';
import { FieldNormalizer } from '../../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../../src/crawler/pipelines/deduplicator.js';
import type { NormalizedItem } from '../../src/crawler/core/types.js';

const adapter = new BrandApiSourceAdapter({ rateLimitMs: 0 });
const parser = new BrandApiParser();
const normalizer = new FieldNormalizer();
const validator = new FieldValidator();

describe('BrandApiSourceAdapter', () => {
  it('should fetch fixture data', async () => {
    const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
    expect(results).toHaveLength(1);
    expect(results[0]!.statusCode).toBe(200);
    expect(results[0]!.contentType).toContain('json');
  });

  it('should record fetchedAt and durationMs', async () => {
    const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
    expect(results[0]!.fetchedAt).toBeInstanceOf(Date);
    expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('BrandApiParser', () => {
  it('should parse brand API response', async () => {
    const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
    const items = parser.parseList(results[0]!);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.brandName).toBe('兔缝缝');
    expect(items[0]!.pitType).toBe('JK');
  });

  it('should extract all required fields', async () => {
    const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
    const items = parser.parseList(results[0]!);
    const item = items[0]!;
    expect(item.canonicalName).toBeTruthy();
    expect(item.sourceUrl).toBeTruthy();
    expect(item.currentPrice).toBeGreaterThan(0);
    expect(item.images.length).toBeGreaterThan(0);
  });

  it('should map sale status correctly', async () => {
    const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
    const items = parser.parseList(results[0]!);
    for (const item of items) {
      expect(['ON_SALE', 'PRE_ORDER', 'UPCOMING', 'SOLD_OUT', 'ENDED']).toContain(item.saleStatus);
    }
  });

});

describe('BrandApi 完整管道', () => {
  it('should complete full pipeline: fetch → parse → normalize → validate', async () => {
    const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
    const parsed = parser.parseList(results[0]!);
    expect(parsed.length).toBeGreaterThan(0);

    for (const item of parsed) {
      const normalized = normalizer.normalize(item);
      const validation = validator.validate(normalized);

      expect(normalized.canonicalName).toBeTruthy();
      expect(normalized.normalizedBrandName).toBe('兔缝缝');
      expect(normalized.confidence).toBeGreaterThan(0);
      expect(validation.valid).toBe(true);
    }
  });

  it('should deduplicate on second run', async () => {
    const deduplicator = new InMemoryDeduplicator();
    const results = await adapter.fetchList('fixture://brand-tufengfeng-api.json');
    const parsed = parser.parseList(results[0]!);

    // 第一次：全部 insert
    for (const item of parsed) {
      const normalized = normalizer.normalize(item);
      const result = await deduplicator.check(normalized);
      expect(result.action).toBe('insert');
    }

    // 加载已有数据
    const existing = parsed.map((item, i) => ({
      id: `existing_${i}`,
      brandId: 'br_001',
      canonicalName: normalizer.normalize(item).canonicalName,
      sourceUrl: item.sourceUrl,
    }));
    deduplicator.load(existing);

    // 第二次：全部 update
    for (const item of parsed) {
      const normalized = normalizer.normalize(item);
      const result = await deduplicator.check(normalized);
      expect(result.action).toBe('update');
    }
  });
});
