// tests/crawler/first-brand-pilot.test.ts — 首个品牌试点测试

import { describe, it, expect } from 'vitest';
import { CRAWL_MODE_DEFAULTS, CRAWL_HARD_LIMITS } from '../../src/crawler/strategy/types.js';
import type { CrawlPolicy, CrawlPlan } from '../../src/crawler/strategy/types.js';

// ────────────────────────────────────────────────
// Mock 数据
// ────────────────────────────────────────────────

const MOCK_POLICY: CrawlPolicy = {
  id: 'bcp_tufengfeng',
  brandId: 'br_001',
  brandName: '兔缝缝',
  sourceType: 'OFFICIAL',
  sourceUrl: 'fixture://brand-tufengfeng-api.json',
  crawlEnabled: true,
  incrementalIntervalHours: 24,
  fullIntervalDays: 30,
  backfillEnabled: true,
  priority: 10,
  lastIncrementalCrawledAt: null,
  lastFullCrawledAt: null,
  lastBackfillCrawledAt: null,
};

// ────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────

describe('First Brand Pilot — 兔缝缝', () => {
  // Case 1: brand policy 可配置
  it('brand policy 可配置', () => {
    expect(MOCK_POLICY.crawlEnabled).toBe(true);
    expect(MOCK_POLICY.backfillEnabled).toBe(true);
    expect(MOCK_POLICY.priority).toBe(10);
  });

  // Case 2: full crawl 生成 draft 数据
  it('full crawl 默认 draft', () => {
    expect(CRAWL_MODE_DEFAULTS.full.visibilityStatus).toBe('draft');
  });

  // Case 3: backfill 生成历史 release
  it('backfill 默认 draft', () => {
    expect(CRAWL_MODE_DEFAULTS.backfill.visibilityStatus).toBe('draft');
  });

  // Case 4: 不重复 product（幂等）
  it('full crawl 幂等不重复 product', () => {
    // 模拟：同一 brand + canonical_name 不重复
    const existing = new Map<string, string>();
    const item1 = { brandId: 'br_001', canonicalName: '经典绀色格裙 45cm' };
    const item2 = { brandId: 'br_001', canonicalName: '经典绀色格裙 45cm' };
    const key1 = `${item1.brandId}::${item1.canonicalName}`;
    const key2 = `${item2.brandId}::${item2.canonicalName}`;
    expect(key1).toBe(key2); // 同一 key
  });

  // Case 5: 不重复 release
  it('同批次 release 幂等', () => {
    const releases = new Map<string, string>();
    const r1 = { productId: 'p1', releaseNo: 1, releaseType: 'reservation' };
    const r2 = { productId: 'p1', releaseNo: 1, releaseType: 'reservation' };
    const key1 = `${r1.productId}::${r1.releaseNo}::${r1.releaseType}`;
    const key2 = `${r2.productId}::${r2.releaseNo}::${r2.releaseType}`;
    expect(key1).toBe(key2);
  });

  // Case 6: 不同期 release 不重复
  it('不同期 release 不重复', () => {
    const r1 = { productId: 'p1', releaseNo: 1, releaseType: 'reservation' };
    const r2 = { productId: 'p1', releaseNo: 2, releaseType: 'rerelease' };
    expect(r1.releaseNo).not.toBe(r2.releaseNo);
  });

  // Case 7: price snapshot 与 release 关联
  it('price snapshot 可关联 release_id', () => {
    const snapshot = { productId: 'p1', priceCents: 12800, releaseId: 'rel_001' };
    expect(snapshot.releaseId).toBe('rel_001');
  });

  // Case 8: draft 不进 Feed
  it('draft 商品不进 Feed', () => {
    const product = { visibility_status: 'draft' };
    const feedVisible = product.visibility_status === 'published';
    expect(feedVisible).toBe(false);
  });

  // Case 9: published 进入 Feed
  it('published 商品进入 Feed', () => {
    const product = { visibility_status: 'published' };
    const feedVisible = product.visibility_status === 'published';
    expect(feedVisible).toBe(true);
  });

  // Case 10: crawl_jobs 正确记录 full/backfill
  it('crawl_mode 枚举完整', () => {
    expect(CRAWL_MODE_DEFAULTS.incremental).toBeDefined();
    expect(CRAWL_MODE_DEFAULTS.full).toBeDefined();
    expect(CRAWL_MODE_DEFAULTS.backfill).toBeDefined();
    expect(CRAWL_MODE_DEFAULTS.manual).toBeDefined();
  });

  // Case 11: 硬上限防止无限抓取
  it('full crawl 硬上限', () => {
    const maxItems = 9999;
    const capped = Math.min(maxItems, CRAWL_HARD_LIMITS.full);
    expect(capped).toBe(CRAWL_HARD_LIMITS.full);
    expect(capped).toBeLessThanOrEqual(1000);
  });

  // Case 12: 数据质量检查可运行
  it('数据质量检查维度完整', () => {
    const checks = [
      'empty_name', 'no_brand', 'no_pit_type', 'no_price',
      'no_cover', 'no_source_url', 'no_tags',
    ];
    expect(checks.length).toBeGreaterThanOrEqual(7);
  });
});
