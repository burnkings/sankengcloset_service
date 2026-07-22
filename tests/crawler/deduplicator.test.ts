// tests/crawler/deduplicator.test.ts — 去重器单元测试

import { describe, it, expect } from 'vitest';
import { InMemoryDeduplicator } from '../../src/crawler/pipelines/deduplicator.js';
import type { NormalizedItem } from '../../src/crawler/core/types.js';

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceUrl: 'https://example.com',
    externalId: 'test-001',
    canonicalName: '深蓝格裙',
    displayName: '深蓝格裙',
    brandName: '兔缝缝',
    normalizedBrandName: '兔缝缝',
    category: '格裙',
    subCategory: '',
    pitType: 'JK',
    currentPrice: 12800,
    originalPrice: 16800,
    depositPrice: 0,
    balancePrice: 0,
    currency: 'CNY',
    saleStatus: 'ON_SALE',
    description: '测试商品',
    rawDescription: '测试商品',
    coverUrl: 'https://example.com/img.jpg',
    images: [],
    sourcePublishedAt: null,
    shopUrl: '',
    tags: [],
    confidence: 100,
      release: null,
    ...overrides,
  };
}

describe('InMemoryDeduplicator', () => {
  it('should insert new product', async () => {
    const dedup = new InMemoryDeduplicator();
    dedup.load([]);
    const result = await dedup.check(makeItem());
    expect(result.action).toBe('insert');
  });

  it('should update existing product by brand+name', async () => {
    const dedup = new InMemoryDeduplicator();
    dedup.load([{ id: 'existing-1', brandId: 'br_001', brandName: '兔缝缝', canonicalName: '深蓝格裙', sourceUrl: '' }]);
    const result = await dedup.check(makeItem());
    expect(result.action).toBe('update');
    expect(result.existingId).toBe('existing-1');
  });

  it('should update existing product by sourceUrl', async () => {
    const dedup = new InMemoryDeduplicator();
    dedup.load([{ id: 'existing-2', brandId: 'br_other', brandName: '其他品牌', canonicalName: '其他商品', sourceUrl: 'https://example.com' }]);
    const result = await dedup.check(makeItem({ canonicalName: '其他商品' }));
    expect(result.action).toBe('update');
  });

  it('should be case-insensitive for name matching', async () => {
    const dedup = new InMemoryDeduplicator();
    dedup.load([{ id: 'existing-3', brandId: 'br_001', brandName: '兔缝缝', canonicalName: '深蓝格裙', sourceUrl: '' }]);
    const result = await dedup.check(makeItem({ canonicalName: '深蓝格裙' }));
    expect(result.action).toBe('update');
  });
});
