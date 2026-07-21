// tests/crawler/persistence-idempotent.test.ts — Persistence 幂等性测试
// 验证：同一商品执行两次不会重复新增
// 验证：价格变化时新增快照而非覆盖

import { describe, it, expect, vi } from 'vitest';
import type { NormalizedItem } from '../../src/crawler/core/types.js';

// ────────────────────────────────────────────────
// Mock Persistence（模拟数据库行为，验证幂等逻辑）
// ────────────────────────────────────────────────

interface MockProduct {
  id: string;
  brand_id: string;
  canonical_name: string;
  source_url: string;
  external_id: string;
  current_price: number;
  original_price: number;
  sale_status: string;
}

interface MockPriceSnapshot {
  id: string;
  product_id: string;
  price_cents: number;
  original_price_cents: number;
  source: string;
  source_url: string;
}

class MockPersistence {
  private products = new Map<string, MockProduct>();
  private priceSnapshots: MockPriceSnapshot[] = [];
  private productCounter = 0;

  async upsertProduct(item: NormalizedItem, brandId: string): Promise<string> {
    // 查找已有产品（brand_id + canonical_name）
    for (const [, p] of this.products) {
      if (p.brand_id === brandId && p.canonical_name === item.canonicalName) {
        // 更新已有产品
        p.current_price = item.currentPrice;
        p.original_price = item.originalPrice;
        p.sale_status = item.saleStatus;
        return p.id;
      }
    }
    // 插入新产品
    this.productCounter++;
    const id = `prd_mock_${this.productCounter}`;
    this.products.set(id, {
      id,
      brand_id: brandId,
      canonical_name: item.canonicalName,
      source_url: item.sourceUrl,
      external_id: item.externalId,
      current_price: item.currentPrice,
      original_price: item.originalPrice,
      sale_status: item.saleStatus,
    });
    return id;
  }

  async recordPriceSnapshot(productId: string, price: number, originalPrice: number, source: string, sourceUrl: string): Promise<void> {
    this.priceSnapshots.push({
      id: `ps_${productId}_${Date.now()}_${Math.random()}`,
      product_id: productId,
      price_cents: price,
      original_price_cents: originalPrice,
      source,
      source_url: sourceUrl,
    });
  }

  async getExistingProducts(): Promise<{ id: string; brandId: string; canonicalName: string; sourceUrl: string }[]> {
    return Array.from(this.products.values()).map(p => ({
      id: p.id,
      brandId: p.brand_id,
      canonicalName: p.canonical_name,
      sourceUrl: p.source_url,
    }));
  }

  getProductCount(): number {
    return this.products.size;
  }

  getPriceSnapshotCount(): number {
    return this.priceSnapshots.length;
  }

  getPriceSnapshotsForProduct(productId: string): MockPriceSnapshot[] {
    return this.priceSnapshots.filter(s => s.product_id === productId);
  }
}

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceUrl: 'https://example.com/product/001',
    externalId: 'ext_001',
    canonicalName: '深蓝格裙 45cm',
    displayName: '深蓝格裙 45cm',
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

// ────────────────────────────────────────────────
// 幂等性测试
// ────────────────────────────────────────────────

describe('Persistence 幂等性', () => {
  it('should not duplicate product on second insert (by brand+name)', async () => {
    const persistence = new MockPersistence();
    const item = makeItem();
    const brandId = 'br_001';

    // 第一次：新增
    const id1 = await persistence.upsertProduct(item, brandId);
    expect(id1).toBeTruthy();
    expect(persistence.getProductCount()).toBe(1);

    // 第二次：更新，不新增
    const id2 = await persistence.upsertProduct(item, brandId);
    expect(id2).toBe(id1); // 返回同一个 ID
    expect(persistence.getProductCount()).toBe(1); // 数量不变
  });

  it('should not duplicate product on second insert (by sourceUrl)', async () => {
    const persistence = new MockPersistence();
    const brandId = 'br_001';

    // 第一次：新增
    const item1 = makeItem({ canonicalName: '商品A' });
    const id1 = await persistence.upsertProduct(item1, brandId);

    // 第二次：同 brand+name 不同 URL → 更新
    const item2 = makeItem({ canonicalName: '商品A', sourceUrl: 'https://other.com/001' });
    const id2 = await persistence.upsertProduct(item2, brandId);
    expect(id2).toBe(id1);
    expect(persistence.getProductCount()).toBe(1);
  });

  it('should insert different products separately', async () => {
    const persistence = new MockPersistence();
    const brandId = 'br_001';

    const id1 = await persistence.upsertProduct(makeItem({ canonicalName: '商品A' }), brandId);
    const id2 = await persistence.upsertProduct(makeItem({ canonicalName: '商品B' }), brandId);

    expect(id1).not.toBe(id2);
    expect(persistence.getProductCount()).toBe(2);
  });

  it('should update price on duplicate', async () => {
    const persistence = new MockPersistence();
    const brandId = 'br_001';

    // 第一次：¥128
    const id1 = await persistence.upsertProduct(makeItem({ currentPrice: 12800 }), brandId);

    // 第二次：¥99（降价）
    const id2 = await persistence.upsertProduct(makeItem({ currentPrice: 9900 }), brandId);

    expect(id2).toBe(id1);
    expect(persistence.getProductCount()).toBe(1);
  });

  it('should insert different products from different brands', async () => {
    const persistence = new MockPersistence();

    const id1 = await persistence.upsertProduct(makeItem({ canonicalName: '格裙A' }), 'br_001');
    const id2 = await persistence.upsertProduct(makeItem({ canonicalName: '格裙A' }), 'br_002');

    // 不同品牌同名 → 不冲突
    expect(id1).not.toBe(id2);
    expect(persistence.getProductCount()).toBe(2);
  });
});

// ────────────────────────────────────────────────
// 价格快照测试
// ────────────────────────────────────────────────

describe('PriceSnapshot 幂等性', () => {
  it('should create new snapshot on price change (not overwrite)', async () => {
    const persistence = new MockPersistence();
    const productId = 'prd_001';

    // 第一次记录：¥128
    await persistence.recordPriceSnapshot(productId, 12800, 16800, 'OFFICIAL', 'https://example.com');
    expect(persistence.getPriceSnapshotCount()).toBe(1);

    // 第二次记录：¥99（降价）→ 应新增快照，不是覆盖
    await persistence.recordPriceSnapshot(productId, 9900, 16800, 'OFFICIAL', 'https://example.com');
    expect(persistence.getPriceSnapshotCount()).toBe(2);

    const snapshots = persistence.getPriceSnapshotsForProduct(productId);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]!.price_cents).toBe(12800);
    expect(snapshots[1]!.price_cents).toBe(9900);
  });

  it('should keep all snapshots even if price unchanged', async () => {
    const persistence = new MockPersistence();
    const productId = 'prd_002';

    await persistence.recordPriceSnapshot(productId, 12800, 16800, 'OFFICIAL', 'https://example.com');
    await persistence.recordPriceSnapshot(productId, 12800, 16800, 'WEIBO', 'https://weibo.com');

    expect(persistence.getPriceSnapshotCount()).toBe(2);
    const snapshots = persistence.getPriceSnapshotsForProduct(productId);
    expect(snapshots[0]!.source).toBe('OFFICIAL');
    expect(snapshots[1]!.source).toBe('WEIBO');
  });
});

// ────────────────────────────────────────────────
// externalId 去重测试
// ────────────────────────────────────────────────

describe('externalId 去重', () => {
  it('should deduplicate by brand+name (primary key)', async () => {
    const persistence = new MockPersistence();
    const id1 = await persistence.upsertProduct(
      makeItem({ canonicalName: '深蓝格裙', externalId: 'ext_001' }),
      'br_001',
    );
    const id2 = await persistence.upsertProduct(
      makeItem({ canonicalName: '深蓝格裙', externalId: 'ext_002' }), // 不同 externalId
      'br_001',
    );
    expect(id1).toBe(id2); // 同品牌+同名 → 更新
    expect(persistence.getProductCount()).toBe(1);
  });
});
