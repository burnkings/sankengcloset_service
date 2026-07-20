// tests/crawler/cleaning.test.ts — 清洗管道测试

import { describe, it, expect } from 'vitest';
import { TextCleaner } from '../../src/crawler/cleaning/text-cleaner.js';
import { PriceCleaner } from '../../src/crawler/cleaning/price-cleaner.js';
import { TimeCleaner } from '../../src/crawler/cleaning/time-cleaner.js';
import { CategoryStandardizer } from '../../src/crawler/cleaning/category-standardizer.js';
import { QualityScorer } from '../../src/crawler/cleaning/quality-scorer.js';
import { CleaningPipeline } from '../../src/crawler/cleaning/cleaning-pipeline.js';
import type { ParsedItem } from '../../src/crawler/core/types.js';

function makeItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    sourceUrl: 'https://example.com',
    externalId: 'test-001',
    canonicalName: '深蓝格裙 45cm',
    displayName: '深蓝格裙 45cm',
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
    description: '测试商品描述',
    rawDescription: '测试商品描述',
    coverUrl: 'https://example.com/img.jpg',
    images: ['https://example.com/img.jpg'],
    sourcePublishedAt: '2025-01-15T10:00:00Z',
    shopUrl: '',
    tags: [],
    ...overrides,
  };
}

describe('TextCleaner', () => {
  const cleaner = new TextCleaner();

  it('should strip HTML tags', () => {
    expect(cleaner.stripHtml('<p>测试<b>文本</b></p>').trim()).toBe('测试文本');
  });

  it('should normalize whitespace', () => {
    expect(cleaner.normalizeWhitespace('  多  空格  ')).toBe('多  空格');
  });

  it('should strip marketing text', () => {
    expect(cleaner.stripMarketing('限时特价！包邮！')).toBe('');
  });

  it('should convert full-width to half-width', () => {
    expect(cleaner.cleanTitle('深蓝格裙４５ｃｍ')).toBe('深蓝格裙45cm');
  });
});

describe('PriceCleaner', () => {
  const cleaner = new PriceCleaner();

  it('should parse single price', () => {
    const result = cleaner.clean('¥128');
    expect(result.currentPrice).toBe(12800);
  });

  it('should parse price range', () => {
    const result = cleaner.clean('¥128-168');
    expect(result.currentPrice).toBe(12800);
    expect(result.originalPrice).toBe(16800);
  });

  it('should parse deposit + balance', () => {
    const result = cleaner.clean('定金100尾款268');
    expect(result.depositPrice).toBe(10000);
    expect(result.balancePrice).toBe(26800);
    expect(result.currentPrice).toBe(36800);
  });

  it('should handle empty input', () => {
    const result = cleaner.clean('');
    expect(result.currentPrice).toBe(0);
  });

  it('should handle number input', () => {
    const result = cleaner.clean(128);
    expect(result.currentPrice).toBe(12800);
  });
});

describe('TimeCleaner', () => {
  const cleaner = new TimeCleaner();

  it('should parse ISO 8601', () => {
    const result = cleaner.clean('2025-01-15T10:00:00Z');
    expect(result.iso).toBeTruthy();
    expect(result.confidence).toBe(100);
  });

  it('should parse YYYY-MM-DD', () => {
    const result = cleaner.clean('2025-01-15');
    expect(result.iso).toBeTruthy();
    expect(result.confidence).toBe(95);
  });

  it('should parse Chinese date', () => {
    const result = cleaner.clean('2025年1月15日');
    expect(result.iso).toBeTruthy();
    expect(result.confidence).toBe(90);
  });

  it('should not force year for month-day only', () => {
    const result = cleaner.clean('1月15日');
    expect(result.iso).toBeNull();
    expect(result.confidence).toBeLessThan(50);
  });

  it('should handle empty input', () => {
    const result = cleaner.clean('');
    expect(result.iso).toBeNull();
  });
});

describe('CategoryStandardizer', () => {
  const s = new CategoryStandardizer();

  it('should standardize pit type', () => {
    expect(s.standardizePitType('jk')).toBe('JK');
    expect(s.standardizePitType('lolita')).toBe('LOLITA');
    expect(s.standardizePitType('汉服')).toBe('HANFU');
    expect(s.standardizePitType('未知')).toBe('OTHER');
  });

  it('should standardize product type', () => {
    expect(s.standardizeProductType('格裙')).toBe('格裙');
    expect(s.standardizeProductType('jsk')).toBe('JSK');
    expect(s.standardizeProductType('马面')).toBe('马面裙');
  });

  it('should standardize sale status', () => {
    expect(s.standardizeSaleStatus('on_sale')).toBe('ON_SALE');
    expect(s.standardizeSaleStatus('预售')).toBe('PRE_ORDER');
  });
});

describe('QualityScorer', () => {
  const scorer = new QualityScorer();

  it('should score complete item high', () => {
    const score = scorer.score({
      sourceType: 'OFFICIAL',
      canonicalName: '深蓝格裙',
      brandName: '兔缝缝',
      category: '格裙',
      currentPrice: 12800,
      description: '描述',
      coverUrl: 'https://example.com/img.jpg',
      images: ['a', 'b', 'c'],
      sourcePublishedAt: new Date().toISOString(),
      confidence: 95,
      reviewStatus: 'APPROVED',
    });
    expect(score.total).toBeGreaterThanOrEqual(80);
  });

  it('should score incomplete item low', () => {
    const score = scorer.score({
      sourceType: 'AI_EXTRACT',
      confidence: 30,
    });
    expect(score.total).toBeLessThan(50);
  });
});

describe('CleaningPipeline', () => {
  const pipeline = new CleaningPipeline();

  it('should clean and standardize item', () => {
    const result = pipeline.clean(makeItem());
    expect(result.canonicalName).toBe('深蓝格裙 45cm');
    expect(result.pitType).toBe('JK');
    expect(result.currentPrice).toBe(12800);
    expect(result.needsReview).toBe(false);
  });

  it('should flag unknown pit type for review', () => {
    const result = pipeline.clean(makeItem({ pitType: 'OTHER' as any }));
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContain('坑向无法确认');
  });

  it('should flag zero price for review', () => {
    const result = pipeline.clean(makeItem({ currentPrice: 0 }));
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContain('价格无效');
  });
});
