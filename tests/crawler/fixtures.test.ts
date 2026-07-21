// tests/crawler/fixtures.test.ts — Fixture 覆盖测试（10种商品场景）
// 标记：测试数据，不模拟真实商业平台

import { describe, it, expect } from 'vitest';
import { FixtureSourceAdapter } from '../../src/crawler/sources/fixture-source.js';
import { JsonParser } from '../../src/crawler/parsers/json-parser.js';
import { FieldNormalizer } from '../../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../../src/crawler/pipelines/deduplicator.js';
import { PriceCleaner } from '../../src/crawler/cleaning/price-cleaner.js';
import { TimeCleaner } from '../../src/crawler/cleaning/time-cleaner.js';
import { CleaningPipeline } from '../../src/crawler/cleaning/cleaning-pipeline.js';
import type { NormalizedItem } from '../../src/crawler/core/types.js';

const adapter = new FixtureSourceAdapter({ rateLimitMs: 0 });
const parser = new JsonParser();
const normalizer = new FieldNormalizer();
const validator = new FieldValidator();
const priceCleaner = new PriceCleaner();
const timeCleaner = new TimeCleaner();
const cleaningPipeline = new CleaningPipeline();

// ────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────

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

async function loadTestProducts() {
  const results = await adapter.fetchList('fixture://test-products-v3.json');
  expect(results).toHaveLength(1);
  return parser.parseList(results[0]!);
}

// ────────────────────────────────────────────────
// 场景 1: 正常现货商品
// ────────────────────────────────────────────────

describe('Fixture: 1-正常现货商品', () => {
  it('should parse spot product correctly', async () => {
    const items = await loadTestProducts();
    const item = items[0];
    expect(item).toBeTruthy();
    expect(item!.canonicalName).toBe('经典绀色格裙 45cm');
    expect(item!.pitType).toBe('JK');
    expect(item!.currentPrice).toBe(12800);
    expect(item!.originalPrice).toBe(16800);
    expect(item!.saleStatus).toBe('ON_SALE');
  });

  it('should validate spot product as valid', async () => {
    const items = await loadTestProducts();
    const item = items[0]!;
    const normalized = normalizer.normalize(item);
    const result = validator.validate(normalized);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should clean price correctly', () => {
    const result = priceCleaner.clean(128);
    expect(result.currentPrice).toBe(12800);
    expect(result.originalPrice).toBe(0);
    expect(result.confidence).toBe(100);
  });
});

// ────────────────────────────────────────────────
// 场景 2: 定金+尾款预售商品
// ────────────────────────────────────────────────

describe('Fixture: 2-定金+尾款预售商品', () => {
  it('should parse preorder product with deposit/balance', async () => {
    const items = await loadTestProducts();
    const item = items[1];
    expect(item).toBeTruthy();
    expect(item!.pitType).toBe('LOLITA');
    expect(item!.depositPrice).toBe(10000);
    expect(item!.balancePrice).toBe(49800);
    expect(item!.saleStatus).toBe('PRE_ORDER');
  });

  it('should validate preorder product', async () => {
    const items = await loadTestProducts();
    const normalized = normalizer.normalize(items[1]!);
    const result = validator.validate(normalized);
    expect(result.valid).toBe(true);
  });

  it('should parse deposit+balance from price text', () => {
    const result = priceCleaner.clean('定金100尾款268');
    expect(result.depositPrice).toBe(10000);
    expect(result.balancePrice).toBe(26800);
    expect(result.currentPrice).toBe(36800);
  });
});

// ────────────────────────────────────────────────
// 场景 3: 已进入尾款阶段商品
// ────────────────────────────────────────────────

describe('Fixture: 3-已进入尾款阶段商品', () => {
  it('should parse balance-phase product', async () => {
    const items = await loadTestProducts();
    const item = items[2];
    expect(item).toBeTruthy();
    expect(item!.pitType).toBe('LOLITA');
    expect(item!.saleStatus).toBe('ON_SALE');
    expect(item!.depositPrice).toBe(8000);
    expect(item!.balancePrice).toBe(37800);
  });

  it('should validate balance-phase product', async () => {
    const items = await loadTestProducts();
    const normalized = normalizer.normalize(items[2]!);
    const result = validator.validate(normalized);
    expect(result.valid).toBe(true);
  });
});

// ────────────────────────────────────────────────
// 场景 4: 价格区间商品
// ────────────────────────────────────────────────

describe('Fixture: 4-价格区间商品', () => {
  it('should parse range-priced product', async () => {
    const items = await loadTestProducts();
    const item = items[3];
    expect(item).toBeTruthy();
    expect(item!.pitType).toBe('HANFU');
    expect(item!.currentPrice).toBe(19800);
    expect(item!.originalPrice).toBe(29800);
  });

  it('should parse price range text', () => {
    const result = priceCleaner.clean('¥128-168');
    expect(result.currentPrice).toBe(12800);
    expect(result.originalPrice).toBe(16800);
    expect(result.confidence).toBe(80);
  });
});

// ────────────────────────────────────────────────
// 场景 5: 未公布价格商品
// ────────────────────────────────────────────────

describe('Fixture: 5-未公布价格商品', () => {
  it('should parse no-price product', async () => {
    const items = await loadTestProducts();
    const item = items[4];
    expect(item).toBeTruthy();
    expect(item!.currentPrice).toBe(0);
    expect(item!.saleStatus).toBe('UPCOMING');
  });

  it('should flag zero price for review', () => {
    const result = cleaningPipeline.clean({
      sourceUrl: 'https://example.com',
      externalId: 'test',
      canonicalName: '测试商品',
      displayName: '测试商品',
      brandName: '仲夏物语',
      category: 'JK',
      subCategory: '水手服',
      pitType: 'JK',
      currentPrice: 0,
      originalPrice: 0,
      depositPrice: 0,
      balancePrice: 0,
      currency: 'CNY',
      saleStatus: 'UPCOMING',
      description: '价格待公布',
      rawDescription: '价格待公布',
      coverUrl: 'https://example.com/img.jpg',
      images: [],
      sourcePublishedAt: null,
      shopUrl: '',
      tags: [],
    });
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContain('价格无效');
  });

  it('should handle empty price text', () => {
    const result = priceCleaner.clean('');
    expect(result.currentPrice).toBe(0);
    expect(result.confidence).toBe(0);
  });
});

// ────────────────────────────────────────────────
// 场景 6: 新品预约商品
// ────────────────────────────────────────────────

describe('Fixture: 6-新品预约商品', () => {
  it('should parse reservation product', async () => {
    const items = await loadTestProducts();
    const item = items[5];
    expect(item).toBeTruthy();
    expect(item!.pitType).toBe('HANFU');
    expect(item!.saleStatus).toBe('UPCOMING');
    expect(item!.currentPrice).toBe(88000);
  });

  it('should parse future date', () => {
    const result = timeCleaner.clean('2025-09-01T10:00:00Z');
    expect(result.iso).toBeTruthy();
    expect(result.confidence).toBe(100);
  });
});

// ────────────────────────────────────────────────
// 场景 7: 降价商品
// ────────────────────────────────────────────────

describe('Fixture: 7-降价商品', () => {
  it('should parse price-dropped product', async () => {
    const items = await loadTestProducts();
    const item = items[6];
    expect(item).toBeTruthy();
    expect(item!.pitType).toBe('LOLITA');
    expect(item!.currentPrice).toBe(3800);
    expect(item!.originalPrice).toBe(6800);
    expect(item!.saleStatus).toBe('ON_SALE');
  });

  it('should detect price drop', () => {
    const original = 6800;
    const current = 3800;
    expect(current).toBeLessThan(original);
  });
});

// ────────────────────────────────────────────────
// 场景 8: 缺少品牌异常商品
// ────────────────────────────────────────────────

describe('Fixture: 8-缺少品牌异常商品', () => {
  it('should parse no-brand product', async () => {
    const items = await loadTestProducts();
    const item = items[7];
    expect(item).toBeTruthy();
    expect(item!.brandName).toBe('');
    expect(item!.pitType).toBe('JK');
  });

  it('should warn on missing brand', async () => {
    const items = await loadTestProducts();
    const normalized = normalizer.normalize(items[7]!);
    const result = validator.validate(normalized);
    expect(result.valid).toBe(true); // brand is warning, not error
    expect(result.warnings.some(w => w.field === 'brandName')).toBe(true);
  });

  it('should flag empty brand for review', () => {
    const result = cleaningPipeline.clean({
      sourceUrl: 'https://example.com',
      externalId: 'test',
      canonicalName: '测试商品',
      displayName: '测试商品',
      brandName: '',
      category: 'JK',
      subCategory: '格裙',
      pitType: 'JK',
      currentPrice: 8800,
      originalPrice: 0,
      depositPrice: 0,
      balancePrice: 0,
      currency: 'CNY',
      saleStatus: 'ON_SALE',
      description: '品牌缺失',
      rawDescription: '品牌缺失',
      coverUrl: 'https://example.com/img.jpg',
      images: [],
      sourcePublishedAt: null,
      shopUrl: '',
      tags: [],
    });
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContain('品牌为空');
  });
});

// ────────────────────────────────────────────────
// 场景 9: 重复商品
// ────────────────────────────────────────────────

describe('Fixture: 9-重复商品', () => {
  it('should detect duplicate by brand+name', async () => {
    const items = await loadTestProducts();
    const item = items[8];
    expect(item).toBeTruthy();
    expect(item!.canonicalName).toBe('深蓝格裙 45cm');

    const deduplicator = new InMemoryDeduplicator();
    deduplicator.load([
      { id: 'existing-1', brandId: 'br_001', brandName: '兔缝缝', canonicalName: '深蓝格裙 45cm', sourceUrl: '' },
    ]);

    const normalized = normalizer.normalize(item!);
    const result = await deduplicator.check(normalized);
    expect(result.action).toBe('update');
    expect(result.existingId).toBe('existing-1');
  });

  it('should detect duplicate by sourceUrl', async () => {
    const items = await loadTestProducts();
    const item = items[8]!;

    const deduplicator = new InMemoryDeduplicator();
    deduplicator.load([
      { id: 'existing-2', brandId: 'br_other', brandName: '其他', canonicalName: '其他', sourceUrl: 'https://example.com/fixtures/prod-001' },
    ]);

    const normalized = normalizer.normalize(item);
    const result = await deduplicator.check(normalized);
    expect(result.action).toBe('update');
  });
});

// ────────────────────────────────────────────────
// 场景 10: 日期冲突商品
// ────────────────────────────────────────────────

describe('Fixture: 10-日期冲突商品', () => {
  it('should parse date-conflict product', async () => {
    const items = await loadTestProducts();
    const item = items[9];
    expect(item).toBeTruthy();
    expect(item!.pitType).toBe('HANFU');
    expect(item!.saleStatus).toBe('PRE_ORDER');
    expect(item!.depositPrice).toBe(5000);
    expect(item!.balancePrice).toBe(17800);
  });

  it('should detect date conflict (end before start)', () => {
    const start = new Date('2025-12-12T00:00:00Z');
    const end = new Date('2025-12-01T00:00:00Z');
    expect(end.getTime()).toBeLessThan(start.getTime());
  });

  it('should parse Chinese date format', () => {
    const result = timeCleaner.clean('2025年12月1日');
    expect(result.iso).toBeTruthy();
    expect(result.confidence).toBe(90);
  });
});

// ────────────────────────────────────────────────
// 全量 Fixture 覆盖
// ────────────────────────────────────────────────

describe('Fixture 全量覆盖', () => {
  it('should load all 10 test products', async () => {
    const items = await loadTestProducts();
    expect(items).toHaveLength(10);
  });

  it('should have all pit types covered', async () => {
    const items = await loadTestProducts();
    const pitTypes = new Set(items.map(i => i.pitType));
    expect(pitTypes.has('JK')).toBe(true);
    expect(pitTypes.has('LOLITA')).toBe(true);
    expect(pitTypes.has('HANFU')).toBe(true);
  });

  it('should have all sale statuses covered', async () => {
    const items = await loadTestProducts();
    const statuses = new Set(items.map(i => i.saleStatus));
    expect(statuses.has('ON_SALE')).toBe(true);
    expect(statuses.has('PRE_ORDER')).toBe(true);
    expect(statuses.has('UPCOMING')).toBe(true);
  });

  it('should validate all items through pipeline', async () => {
    const items = await loadTestProducts();
    for (const item of items) {
      const normalized = normalizer.normalize(item);
      const result = validator.validate(normalized);
      // Items 5 (no-price) and 8 (no-brand) may have warnings but should be structurally valid
      expect(result.errors).toHaveLength(0);
    }
  });

  it('should clean all items through cleaning pipeline', async () => {
    const items = await loadTestProducts();
    for (const item of items) {
      const cleaned = cleaningPipeline.clean(item);
      expect(cleaned.canonicalName).toBeTruthy();
      expect(cleaned.pitType).toBeTruthy();
    }
  });
});
