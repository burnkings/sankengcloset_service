// tests/crawler/normalizer.test.ts — 标准化器单元测试

import { describe, it, expect } from 'vitest';
import { FieldNormalizer } from '../../src/crawler/normalizers/field-normalizer.js';
import type { ParsedItem } from '../../src/crawler/core/types.js';

function makeItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    sourceUrl: 'https://example.com',
    externalId: 'test-001',
    canonicalName: '深蓝格裙',
    displayName: '深蓝格裙',
    brandName: '兔缝缝',
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
    ...overrides,
  };
}

describe('FieldNormalizer', () => {
  const normalizer = new FieldNormalizer();

  it('should normalize brand name', () => {
    const result = normalizer.normalize(makeItem({ brandName: '星晨猫' }));
    expect(result.normalizedBrandName).toBe('星辰猫');
  });

  it('should normalize category', () => {
    const result = normalizer.normalize(makeItem({ category: 'jsk' }));
    expect(result.category).toBe('JSK');
  });

  it('should trim product name', () => {
    const result = normalizer.normalize(makeItem({ canonicalName: '  深蓝格裙  ' }));
    expect(result.canonicalName).toBe('深蓝格裙');
  });

  it('should calculate confidence based on completeness', () => {
    const full = normalizer.normalize(makeItem());
    const empty = normalizer.normalize(makeItem({
      brandName: '',
      currentPrice: 0,
      coverUrl: '',
    }));
    expect(full.confidence).toBe(100);
    expect(empty.confidence).toBeLessThan(full.confidence);
  });

  it('should handle unknown brand name', () => {
    const result = normalizer.normalize(makeItem({ brandName: '未知品牌' }));
    expect(result.normalizedBrandName).toBe('未知品牌');
  });
});
