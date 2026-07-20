// tests/crawler/validator.test.ts — 校验器单元测试

import { describe, it, expect } from 'vitest';
import { FieldValidator } from '../../src/crawler/pipelines/validator.js';
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
    ...overrides,
  };
}

describe('FieldValidator', () => {
  const validator = new FieldValidator();

  it('should pass valid item', () => {
    const result = validator.validate(makeItem());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject empty name', () => {
    const result = validator.validate(makeItem({ canonicalName: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'canonicalName')).toBe(true);
  });

  it('should reject invalid pitType', () => {
    const result = validator.validate(makeItem({ pitType: 'INVALID' as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'pitType')).toBe(true);
  });

  it('should reject negative price', () => {
    const result = validator.validate(makeItem({ currentPrice: -100 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'currentPrice')).toBe(true);
  });

  it('should warn on missing brand', () => {
    const result = validator.validate(makeItem({ brandName: '' }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.field === 'brandName')).toBe(true);
  });

  it('should reject invalid sourceUrl', () => {
    const result = validator.validate(makeItem({ sourceUrl: 'not-a-url' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sourceUrl')).toBe(true);
  });

  it('should accept fixture:// URLs', () => {
    const result = validator.validate(makeItem({ sourceUrl: 'fixture://test.json' }));
    expect(result.valid).toBe(true);
  });
});
