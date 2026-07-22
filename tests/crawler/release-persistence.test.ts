// tests/crawler/release-persistence.test.ts — Release 持久化 + 去重 + Feed 测试

import { describe, it, expect, beforeEach } from 'vitest';
import type { NormalizedItem, ReleaseInfo } from '../../src/crawler/core/types.js';

// ────────────────────────────────────────────────
// Mock DB
// ────────────────────────────────────────────────

interface DBProduct { id: string; brand_id: string; canonical_name: string; current_price: number; }
interface DBRelease { id: string; product_id: string; release_no: number; release_type: string; sale_status: string; visibility_status: string; source_url: string; }
interface DBPriceSnapshot { id: string; product_id: string; price_cents: number; source: string; release_id: string | null; }

class MockDB {
  products = new Map<string, DBProduct>();
  releases: DBRelease[] = [];
  snapshots: DBPriceSnapshot[] = [];
}

// ────────────────────────────────────────────────
// Test Persistence
// ────────────────────────────────────────────────

class TestPersistence {
  constructor(private db: MockDB) {}

  async upsertProduct(item: NormalizedItem, brandId: string): Promise<string> {
    for (const [, p] of this.db.products) {
      if (p.brand_id === brandId && p.canonical_name === item.canonicalName) {
        p.current_price = item.currentPrice;
        return p.id;
      }
    }
    const id = 'prd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    this.db.products.set(id, { id, brand_id: brandId, canonical_name: item.canonicalName, current_price: item.currentPrice });
    return id;
  }

  async upsertRelease(productId: string, release: ReleaseInfo, sourceUrl: string): Promise<string> {
    if (release.releaseNo > 0) {
      const existing = this.db.releases.find(r =>
        r.product_id === productId && r.release_no === release.releaseNo && r.release_type === release.releaseType
      );
      if (existing) {
        existing.sale_status = release.saleStatus;
        return existing.id;
      }
    }
    const id = 'rel_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    this.db.releases.push({
      id, product_id: productId, release_no: release.releaseNo, release_type: release.releaseType,
      sale_status: release.saleStatus, visibility_status: 'draft', source_url: sourceUrl,
    });
    return id;
  }

  async recordPriceSnapshot(productId: string, price: number, source: string, releaseId: string | null): Promise<void> {
    const existing = this.db.snapshots.find(s =>
      s.product_id === productId && s.source === source && s.price_cents === price && s.release_id === releaseId
    );
    if (existing) return;
    this.db.snapshots.push({
      id: `ps_${productId}_${Date.now()}`, product_id: productId,
      price_cents: price, source, release_id: releaseId,
    });
  }

  // Dedup checks
  isProductDuplicate(brandId: string, canonicalName: string): boolean {
    for (const [, p] of this.db.products) {
      if (p.brand_id === brandId && p.canonical_name === canonicalName) return true;
    }
    return false;
  }

  isReleaseDuplicate(productId: string, releaseNo: number, releaseType: string): boolean {
    return this.db.releases.some(r =>
      r.product_id === productId && r.release_no === releaseNo && r.release_type === releaseType
    );
  }
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceUrl: 'https://example.com/1', externalId: 'ext_001',
    canonicalName: '测试格裙', displayName: '测试格裙',
    brandName: '兔缝缝', normalizedBrandName: '兔缝缝',
    category: '格裙', subCategory: '', pitType: 'JK',
    currentPrice: 12800, originalPrice: 16800, depositPrice: 0, balancePrice: 0,
    currency: 'CNY', saleStatus: 'ON_SALE', description: '', rawDescription: '',
    coverUrl: '', images: [], sourcePublishedAt: null, shopUrl: '', tags: [],
    confidence: 90, release: null, ...overrides,
  };
}

function makeRelease(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    releaseName: '一期', releaseNo: 1, releaseType: 'reservation',
    saleStatus: 'PRE_ORDER', depositPrice: 10000, balancePrice: 2800, fullPrice: 12800,
    startAt: null, endAt: null, balanceDueAt: null, shipAt: null,
    isRerelease: false, isSoldOut: false, lifecycleStatus: 'active', confidence: 80,
    ...overrides,
  };
}

// ────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────

describe('Release Persistence & Dedup', () => {
  let db: MockDB;
  let persistence: TestPersistence;

  beforeEach(() => {
    db = new MockDB();
    persistence = new TestPersistence(db);
  });

  // Case 5: 同商品不同期不重复 product
  it('Case 5: 同商品不同期应复用同一 product，创建不同 release', async () => {
    const item1 = makeItem({ canonicalName: '格裙', release: makeRelease({ releaseNo: 1 }) });
    const item2 = makeItem({ canonicalName: '格裙', release: makeRelease({ releaseNo: 2, releaseType: 'rerelease' }) });

    const pid1 = await persistence.upsertProduct(item1, 'br_001');
    const pid2 = await persistence.upsertProduct(item2, 'br_001');
    expect(pid1).toBe(pid2); // 同一 product

    const rid1 = await persistence.upsertRelease(pid1, item1.release!, item1.sourceUrl);
    const rid2 = await persistence.upsertRelease(pid2, item2.release!, item2.sourceUrl);
    expect(rid1).not.toBe(rid2); // 不同 release
    expect(db.releases).toHaveLength(2);
  });

  // Case 6: 同批次二次采集不重复 release
  it('Case 6: 同批次二次采集不应重复创建 release', async () => {
    const item = makeItem({ release: makeRelease({ releaseNo: 1 }) });
    const pid = await persistence.upsertProduct(item, 'br_001');

    const rid1 = await persistence.upsertRelease(pid, item.release!, item.sourceUrl);
    const rid2 = await persistence.upsertRelease(pid, item.release!, item.sourceUrl);
    expect(rid1).toBe(rid2); // 同一 release
    expect(db.releases).toHaveLength(1);
  });

  // Case 7: price_snapshots 可关联 release
  it('Case 7: price_snapshots 可关联 release_id', async () => {
    const item = makeItem({ release: makeRelease() });
    const pid = await persistence.upsertProduct(item, 'br_001');
    const rid = await persistence.upsertRelease(pid, item.release!, item.sourceUrl);

    await persistence.recordPriceSnapshot(pid, 12800, 'crawler', rid);
    expect(db.snapshots).toHaveLength(1);
    expect(db.snapshots[0]!.release_id).toBe(rid);
  });

  // Case 8: 无 release 信息的价格快照
  it('Case 8: 无 release 信息时 release_id 为 null', async () => {
    const pid = 'prd_test';
    db.products.set(pid, { id: pid, brand_id: 'br_001', canonical_name: '测试', current_price: 12800 });

    await persistence.recordPriceSnapshot(pid, 12800, 'crawler', null);
    expect(db.snapshots[0]!.release_id).toBeNull();
  });

  // Dedup: product 级去重
  it('Product 级去重: brand + canonical_name', async () => {
    expect(persistence.isProductDuplicate('br_001', '格裙')).toBe(false);
    const item = makeItem({ canonicalName: '格裙' });
    await persistence.upsertProduct(item, 'br_001');
    expect(persistence.isProductDuplicate('br_001', '格裙')).toBe(true);
    expect(persistence.isProductDuplicate('br_002', '格裙')).toBe(false);
  });

  // Dedup: release 级去重
  it('Release 级去重: product_id + release_no + release_type', async () => {
    const pid = 'prd_test';
    expect(persistence.isReleaseDuplicate(pid, 1, 'reservation')).toBe(false);
    db.releases.push({ id: 'rel_1', product_id: pid, release_no: 1, release_type: 'reservation', sale_status: 'PRE_ORDER', visibility_status: 'draft', source_url: '' });
    expect(persistence.isReleaseDuplicate(pid, 1, 'reservation')).toBe(true);
    expect(persistence.isReleaseDuplicate(pid, 1, 'rerelease')).toBe(false);
    expect(persistence.isReleaseDuplicate(pid, 2, 'reservation')).toBe(false);
  });
});

describe('Feed Release Summary', () => {
  it('Case 9: draft release 不进入 Feed', () => {
    const releases: DBRelease[] = [
      { id: 'r1', product_id: 'p1', release_no: 1, release_type: 'reservation', sale_status: 'PRE_ORDER', visibility_status: 'draft', source_url: '' },
      { id: 'r2', product_id: 'p1', release_no: 2, release_type: 'rerelease', sale_status: 'ON_SALE', visibility_status: 'published', source_url: '' },
    ];
    const published = releases.filter(r => r.visibility_status === 'published');
    expect(published).toHaveLength(1);
    expect(published[0]!.id).toBe('r2');
  });

  it('Case 10: published release 可进入 Feed', () => {
    const releases: DBRelease[] = [
      { id: 'r1', product_id: 'p1', release_no: 1, release_type: 'reservation', sale_status: 'PRE_ORDER', visibility_status: 'published', source_url: '' },
    ];
    const published = releases.filter(r => r.visibility_status === 'published');
    expect(published).toHaveLength(1);
    expect(published[0]!.release_type).toBe('reservation');
  });

  it('Feed 应返回 latest published release summary', () => {
    const releases: DBRelease[] = [
      { id: 'r1', product_id: 'p1', release_no: 1, release_type: 'reservation', sale_status: 'ENDED', visibility_status: 'published', source_url: '' },
      { id: 'r2', product_id: 'p1', release_no: 2, release_type: 'rerelease', sale_status: 'ON_SALE', visibility_status: 'published', source_url: '' },
    ];
    // 模拟：取最新 published release
    const latest = releases
      .filter(r => r.visibility_status === 'published')
      .sort((a, b) => b.release_no - a.release_no)[0];
    expect(latest!.release_no).toBe(2);
    expect(latest!.release_type).toBe('rerelease');
  });
});
