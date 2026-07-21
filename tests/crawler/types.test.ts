// tests/crawler/types.test.ts — 类型测试（RawCrawlItem + NormalizedProductCandidate）
// 验证新增领域类型的结构完整性和兼容性

import { describe, it, expect } from 'vitest';
import type {
  RawCrawlItem,
  NormalizedProductCandidate,
  ParsedItem,
  NormalizedItem,
  ValidationResult,
  ValidationError,
  DedupResult,
} from '../../src/crawler/core/types.js';

describe('RawCrawlItem 类型', () => {
  it('should accept valid RawCrawlItem', () => {
    const item: RawCrawlItem = {
      sourcePlatform: 'OFFICIAL',
      sourceUrl: 'https://example.com/product/001',
      externalId: 'ext_001',
      rawTitle: '深蓝格裙 45cm',
      rawDescription: '经典深蓝格裙',
      rawPriceText: '¥128',
      rawDateText: '2025-01-15',
      rawImageUrls: ['https://example.com/img1.jpg'],
      rawPayload: { html: '<div>test</div>' },
      fetchedAt: new Date(),
      parserVersion: 'v1',
    };
    expect(item.sourcePlatform).toBe('OFFICIAL');
    expect(item.rawImageUrls).toHaveLength(1);
  });

  it('should accept empty strings for optional-like fields', () => {
    const item: RawCrawlItem = {
      sourcePlatform: 'WEIBO',
      sourceUrl: '',
      externalId: '',
      rawTitle: '',
      rawDescription: '',
      rawPriceText: '',
      rawDateText: '',
      rawImageUrls: [],
      rawPayload: null,
      fetchedAt: new Date(),
      parserVersion: 'v0',
    };
    expect(item.rawImageUrls).toHaveLength(0);
  });
});

describe('NormalizedProductCandidate 类型', () => {
  it('should accept valid candidate', () => {
    const candidate: NormalizedProductCandidate = {
      name: '深蓝格裙 45cm',
      brand: '兔缝缝',
      pitType: 'JK',
      category: '格裙',
      saleStatus: 'ON_SALE',
      currentPrice: 12800,
      originalPrice: 16800,
      depositPrice: 0,
      balancePrice: 0,
      preorderStartAt: null,
      preorderEndAt: null,
      imageUrls: ['https://example.com/img.jpg'],
      sourceUrl: 'https://example.com/product/001',
      confidence: 95,
      validationErrors: [],
    };
    expect(candidate.pitType).toBe('JK');
    expect(candidate.confidence).toBe(95);
  });

  it('should accept all pitType values', () => {
    const pitTypes: Array<'JK' | 'LOLITA' | 'HANFU' | 'OTHER'> = ['JK', 'LOLITA', 'HANFU', 'OTHER'];
    for (const pt of pitTypes) {
      const candidate: NormalizedProductCandidate = {
        name: 'test',
        brand: 'test',
        pitType: pt,
        category: '',
        saleStatus: 'ON_SALE',
        currentPrice: 0,
        originalPrice: 0,
        depositPrice: 0,
        balancePrice: 0,
        preorderStartAt: null,
        preorderEndAt: null,
        imageUrls: [],
        sourceUrl: '',
        confidence: 0,
        validationErrors: [],
      };
      expect(candidate.pitType).toBe(pt);
    }
  });

  it('should accept all saleStatus values', () => {
    const statuses: Array<'UPCOMING' | 'ON_SALE' | 'PRE_ORDER' | 'SOLD_OUT' | 'ENDED'> = [
      'UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED',
    ];
    for (const status of statuses) {
      const candidate: NormalizedProductCandidate = {
        name: 'test',
        brand: 'test',
        pitType: 'JK',
        category: '',
        saleStatus: status,
        currentPrice: 0,
        originalPrice: 0,
        depositPrice: 0,
        balancePrice: 0,
        preorderStartAt: null,
        preorderEndAt: null,
        imageUrls: [],
        sourceUrl: '',
        confidence: 0,
        validationErrors: [],
      };
      expect(candidate.saleStatus).toBe(status);
    }
  });

  it('should accept Date objects for preorder dates', () => {
    const now = new Date();
    const candidate: NormalizedProductCandidate = {
      name: '预售商品',
      brand: '测试品牌',
      pitType: 'LOLITA',
      category: 'JSK',
      saleStatus: 'PRE_ORDER',
      currentPrice: 36800,
      originalPrice: 39800,
      depositPrice: 10000,
      balancePrice: 26800,
      preorderStartAt: now,
      preorderEndAt: new Date(now.getTime() + 7 * 86400000),
      imageUrls: [],
      sourceUrl: 'https://example.com',
      confidence: 90,
      validationErrors: [],
    };
    expect(candidate.preorderStartAt).toBeInstanceOf(Date);
    expect(candidate.preorderEndAt).toBeInstanceOf(Date);
  });

  it('should accept validationErrors array', () => {
    const errors: ValidationError[] = [
      { field: 'brand', code: 'REQUIRED', message: '品牌不能为空', severity: 'error' },
      { field: 'price', code: 'INVALID', message: '价格异常', severity: 'warning' },
    ];
    const candidate: NormalizedProductCandidate = {
      name: 'test',
      brand: '',
      pitType: 'OTHER',
      category: '',
      saleStatus: 'ON_SALE',
      currentPrice: 0,
      originalPrice: 0,
      depositPrice: 0,
      balancePrice: 0,
      preorderStartAt: null,
      preorderEndAt: null,
      imageUrls: [],
      sourceUrl: '',
      confidence: 30,
      validationErrors: errors,
    };
    expect(candidate.validationErrors).toHaveLength(2);
  });
});

describe('ParsedItem / NormalizedItem 兼容性', () => {
  it('should still create ParsedItem', () => {
    const item: ParsedItem = {
      sourceUrl: 'https://example.com',
      externalId: 'test',
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
      description: '测试',
      rawDescription: '测试',
      coverUrl: 'https://example.com/img.jpg',
      images: [],
      sourcePublishedAt: null,
      shopUrl: '',
      tags: [],
    };
    expect(item.canonicalName).toBe('深蓝格裙');
  });

  it('should still create NormalizedItem extending ParsedItem', () => {
    const item: NormalizedItem = {
      sourceUrl: 'https://example.com',
      externalId: 'test',
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
      description: '测试',
      rawDescription: '测试',
      coverUrl: 'https://example.com/img.jpg',
      images: [],
      sourcePublishedAt: null,
      shopUrl: '',
      tags: [],
      normalizedBrandName: '兔缝缝',
      confidence: 95,
    };
    expect(item.normalizedBrandName).toBe('兔缝缝');
    expect(item.confidence).toBe(95);
  });
});

describe('ValidationResult / DedupResult 兼容性', () => {
  it('should create ValidationResult', () => {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };
    expect(result.valid).toBe(true);
  });

  it('should create DedupResult', () => {
    const result: DedupResult = {
      action: 'insert',
      existingId: null,
      reason: '新商品',
    };
    expect(result.action).toBe('insert');
  });
});
