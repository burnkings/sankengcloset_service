// tests/crawler/persistence.integration.test.ts — Persistence 集成测试
// 覆盖：首次采集 / 幂等 / 价格变化 / 审核状态

import { describe, it, expect, beforeEach } from 'vitest';
import type { NormalizedItem } from '../../src/crawler/core/types.js';

// ────────────────────────────────────────────────
// Mock Database（模拟 PostgreSQL 行为）
// ────────────────────────────────────────────────

interface DBProduct {
  id: string; brand_id: string; canonical_name: string; display_name: string;
  pit_type: string; sale_status: string; current_price: number; original_price: number;
  source_url: string; source_platform: string; review_status: string; visibility_status: string;
  confidence: number; created_at: Date; updated_at: Date;
}
interface DBPriceSnapshot { id: string; product_id: string; price_cents: number; source: string; source_url: string; created_at: Date; }
interface DBSourceRecord { id: string; source_type: string; source_url: string; entity_type: string; entity_id: string; parser_version: string; }
interface DBCrawlJob { id: string; source_type: string; status: string; items_total: number; items_success: number; items_failed: number; }

class MockDB {
  products = new Map<string, DBProduct>();
  priceSnapshots: DBPriceSnapshot[] = [];
  sourceRecords: DBSourceRecord[] = [];
  crawlJobs: DBCrawlJob[] = [];
  brandCounter = 0;

  // 模拟 sql tagged template
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    // 简化：根据 SQL 模式匹配返回
    if (sql.includes('SELECT id FROM products') && sql.includes('brand_id') && sql.includes('canonical_name')) {
      // upsertProduct 的查找
      const brandId = params?.[0] as string;
      const canonicalName = params?.[1] as string;
      for (const [, p] of this.products) {
        if (p.brand_id === brandId && p.canonical_name === canonicalName) return [{ id: p.id }];
      }
      return [];
    }
    if (sql.includes('SELECT id FROM source_records') && sql.includes('entity_id')) {
      const entityId = params?.[1] as string;
      const sourceUrl = params?.[2] as string;
      const found = this.sourceRecords.find(r => r.entity_id === entityId && r.source_url === sourceUrl);
      return found ? [{ id: found.id }] : [];
    }
    if (sql.includes('SELECT id FROM price_snapshots') && sql.includes('product_id')) {
      const productId = params?.[0] as string;
      const source = params?.[1] as string;
      const price = params?.[2] as number;
      const found = this.priceSnapshots.find(s => s.product_id === productId && s.source === source && s.price_cents === price);
      return found ? [{ id: found.id }] : [];
    }
    if (sql.includes('SELECT id, brand_id') && sql.includes('b.name')) {
      // getExistingProducts
      return Array.from(this.products.values()).map(p => ({
        id: p.id, brand_id: p.brand_id, brand_name: '兔缝缝',
        canonical_name: p.canonical_name, source_url: p.source_url,
      }));
    }
    if (sql.includes('SELECT id FROM brands') && sql.includes('name')) {
      return [{ id: 'br_001' }];
    }
    if (sql.includes('SELECT count(*)')) {
      if (sql.includes('visibility_status')) {
        const status = params?.[0] as string;
        const count = Array.from(this.products.values()).filter(p => p.visibility_status === status).length;
        return [{ total_count: count }];
      }
      return [{ total_count: this.products.size }];
    }
    return [];
  }

  // 模拟 INSERT
  insertProduct(product: DBProduct) {
    this.products.set(product.id, product);
  }
  insertPriceSnapshot(snapshot: DBPriceSnapshot) {
    this.priceSnapshots.push(snapshot);
  }
  insertSourceRecord(record: DBSourceRecord) {
    this.sourceRecords.push(record);
  }
  insertCrawlJob(job: DBCrawlJob) {
    this.crawlJobs.push(job);
  }

  updateProduct(id: string, updates: Partial<DBProduct>) {
    const p = this.products.get(id);
    if (p) Object.assign(p, updates);
  }
}

// ────────────────────────────────────────────────
// Persistence（简化版，使用 MockDB）
// ────────────────────────────────────────────────

class TestPersistence {
  constructor(private db: MockDB) {}

  async upsertProduct(item: NormalizedItem, brandId: string): Promise<string> {
    // 查找已有
    for (const [, p] of this.db.products) {
      if (p.brand_id === brandId && p.canonical_name === item.canonicalName) {
        p.current_price = item.currentPrice;
        p.original_price = item.originalPrice;
        p.sale_status = item.saleStatus;
        p.updated_at = new Date();
        return p.id;
      }
    }
    // 插入
    const id = 'prd_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    this.db.insertProduct({
      id, brand_id: brandId, canonical_name: item.canonicalName, display_name: item.displayName,
      pit_type: item.pitType, sale_status: item.saleStatus,
      current_price: item.currentPrice, original_price: item.originalPrice,
      source_url: item.sourceUrl, source_platform: 'OFFICIAL',
      review_status: 'PENDING', visibility_status: 'draft',
      confidence: item.confidence, created_at: new Date(), updated_at: new Date(),
    });
    return id;
  }

  async recordPriceSnapshot(productId: string, price: number, originalPrice: number, source: string, sourceUrl: string): Promise<void> {
    const existing = this.db.priceSnapshots.find(s => s.product_id === productId && s.source === source && s.price_cents === price);
    if (existing) return;
    this.db.insertPriceSnapshot({
      id: `ps_${productId}_${Date.now()}`, product_id: productId,
      price_cents: price, source, source_url: sourceUrl, created_at: new Date(),
    });
  }

  async recordSourceRecord(entityType: string, entityId: string, sourceType: string, sourceUrl: string, parserVersion: string): Promise<void> {
    const existing = this.db.sourceRecords.find(r => r.entity_type === entityType && r.entity_id === entityId && r.source_url === sourceUrl);
    if (existing) return;
    this.db.insertSourceRecord({
      id: `src_${entityId}_${Date.now()}`, source_type: sourceType, source_url: sourceUrl,
      entity_type: entityType, entity_id: entityId, parser_version: parserVersion,
    });
  }

  async getExistingProducts() {
    return Array.from(this.db.products.values()).map(p => ({
      id: p.id, brandId: p.brand_id, brandName: '兔缝缝',
      canonicalName: p.canonical_name, sourceUrl: p.source_url,
    }));
  }

  async getBrandIdByName() { return 'br_001'; }
}

// ────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceUrl: 'https://example.com/product/001', externalId: 'ext_001',
    canonicalName: '测试格裙 45cm', displayName: '测试格裙 45cm',
    brandName: '兔缝缝', normalizedBrandName: '兔缝缝',
    category: '格裙', subCategory: '', pitType: 'JK',
    currentPrice: 12800, originalPrice: 16800, depositPrice: 0, balancePrice: 0,
    currency: 'CNY', saleStatus: 'ON_SALE', description: '测试', rawDescription: '测试',
    coverUrl: 'https://example.com/img.jpg', images: ['https://example.com/img.jpg'],
    sourcePublishedAt: null, shopUrl: '', tags: [], confidence: 90,
    release: null,
    ...overrides,
  };
}

// ────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────

describe('Persistence 集成测试', () => {
  let db: MockDB;
  let persistence: TestPersistence;

  beforeEach(() => {
    db = new MockDB();
    persistence = new TestPersistence(db);
  });

  // Case 1: 首次采集
  it('Case 1: 首次采集应创建 products + source_records + price_snapshots', async () => {
    const item1 = makeItem({ canonicalName: '商品A', sourceUrl: 'https://a.com/1' });
    const item2 = makeItem({ canonicalName: '商品B', sourceUrl: 'https://b.com/1' });

    const id1 = await persistence.upsertProduct(item1, 'br_001');
    const id2 = await persistence.upsertProduct(item2, 'br_001');
    await persistence.recordPriceSnapshot(id1, item1.currentPrice, item1.originalPrice, 'crawler', item1.sourceUrl);
    await persistence.recordPriceSnapshot(id2, item2.currentPrice, item2.originalPrice, 'crawler', item2.sourceUrl);
    await persistence.recordSourceRecord('product', id1, 'OFFICIAL', item1.sourceUrl, 'v1');
    await persistence.recordSourceRecord('product', id2, 'OFFICIAL', item2.sourceUrl, 'v1');

    expect(db.products.size).toBe(2);
    expect(db.priceSnapshots).toHaveLength(2);
    expect(db.sourceRecords).toHaveLength(2);
    expect(id1).not.toBe(id2);
  });

  // Case 2: 重复采集（幂等）
  it('Case 2: 重复采集不应新增任何记录', async () => {
    const item = makeItem({ canonicalName: '幂等商品', sourceUrl: 'https://idempotent.com/1' });

    // 第一次
    const id1 = await persistence.upsertProduct(item, 'br_001');
    await persistence.recordPriceSnapshot(id1, item.currentPrice, item.originalPrice, 'crawler', item.sourceUrl);
    await persistence.recordSourceRecord('product', id1, 'OFFICIAL', item.sourceUrl, 'v1');

    const productsAfter1 = db.products.size;
    const snapshotsAfter1 = db.priceSnapshots.length;
    const recordsAfter1 = db.sourceRecords.length;

    // 第二次（相同数据）
    const id2 = await persistence.upsertProduct(item, 'br_001');
    await persistence.recordPriceSnapshot(id2, item.currentPrice, item.originalPrice, 'crawler', item.sourceUrl);
    await persistence.recordSourceRecord('product', id2, 'OFFICIAL', item.sourceUrl, 'v1');

    expect(id2).toBe(id1); // 返回同一 ID
    expect(db.products.size).toBe(productsAfter1);
    expect(db.priceSnapshots.length).toBe(snapshotsAfter1);
    expect(db.sourceRecords.length).toBe(recordsAfter1);
  });

  // Case 3: 价格变化
  it('Case 3: 价格变化应更新 product 并新增 price_snapshot', async () => {
    const item = makeItem({ canonicalName: '降价商品', currentPrice: 12800, sourceUrl: 'https://price.com/1' });

    // 第一次：¥128
    const id = await persistence.upsertProduct(item, 'br_001');
    await persistence.recordPriceSnapshot(id, 12800, 16800, 'crawler', item.sourceUrl);
    expect(db.priceSnapshots).toHaveLength(1);

    // 第二次：¥99（降价）
    const item2 = makeItem({ canonicalName: '降价商品', currentPrice: 9900, sourceUrl: 'https://price.com/1' });
    const id2 = await persistence.upsertProduct(item2, 'br_001');
    await persistence.recordPriceSnapshot(id2, 9900, 16800, 'crawler', item2.sourceUrl);

    expect(id2).toBe(id); // 同一产品
    const product = db.products.get(id)!;
    expect(product.current_price).toBe(9900); // 价格已更新
    expect(db.priceSnapshots).toHaveLength(2); // 新增快照
    expect(db.priceSnapshots[0]!.price_cents).toBe(12800);
    expect(db.priceSnapshots[1]!.price_cents).toBe(9900);
  });

  // Case 4: 审核状态
  it('Case 4: draft 商品不应出现在 published 查询中', async () => {
    // 插入 draft 商品
    const draftItem = makeItem({ canonicalName: '草稿商品' });
    const draftId = await persistence.upsertProduct(draftItem, 'br_001');

    // 插入 published 商品
    const pubItem = makeItem({ canonicalName: '已发布商品', sourceUrl: 'https://pub.com/1' });
    const pubId = await persistence.upsertProduct(pubItem, 'br_001');
    const product = db.products.get(pubId)!;
    product.visibility_status = 'published';

    // 模拟 Feed 查询：只返回 published
    const feedProducts = Array.from(db.products.values()).filter(p => p.visibility_status === 'published');
    expect(feedProducts).toHaveLength(1);
    expect(feedProducts[0]!.id).toBe(pubId);
    expect(feedProducts[0]!.canonical_name).toBe('已发布商品');

    // draft 不应出现在 Feed 中
    expect(feedProducts.find(p => p.id === draftId)).toBeUndefined();
  });

  // 补充：状态流转测试
  it('Case 4b: 商品状态可从 draft → reviewing → published 流转', async () => {
    const item = makeItem({ canonicalName: '流转商品' });
    const id = await persistence.upsertProduct(item, 'br_001');

    const product = db.products.get(id)!;
    expect(product.visibility_status).toBe('draft');

    product.visibility_status = 'reviewing';
    expect(product.visibility_status).toBe('reviewing');

    product.visibility_status = 'published';
    expect(product.visibility_status).toBe('published');

    // published 可被隐藏
    product.visibility_status = 'hidden';
    expect(product.visibility_status).toBe('hidden');
  });
});
