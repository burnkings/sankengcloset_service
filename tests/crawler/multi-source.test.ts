// tests/crawler/multi-source.test.ts — 多来源测试

import { describe, it, expect } from 'vitest';
import { WeiboBrandSourceAdapter } from '../../src/crawler/sources/weibo-brand.js';
import { WeiboParser } from '../../src/crawler/parsers/weibo-parser.js';
import { WechatMpSourceAdapter } from '../../src/crawler/sources/wechat-mp.js';
import { WechatMpParser } from '../../src/crawler/parsers/wechat-mp-parser.js';
import { SourceMerger, SOURCE_PRIORITY } from '../../src/crawler/pipelines/source-merger.js';
import { FieldNormalizer } from '../../src/crawler/normalizers/field-normalizer.js';
import type { NormalizedItem } from '../../src/crawler/core/types.js';

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceUrl: 'https://example.com', externalId: 'test',
    canonicalName: '测试商品', displayName: '测试商品',
    brandName: '兔缝缝', normalizedBrandName: '兔缝缝',
    category: '格裙', subCategory: '', pitType: 'JK',
    currentPrice: 12800, originalPrice: 0, depositPrice: 0, balancePrice: 0,
    currency: 'CNY', saleStatus: 'ON_SALE',
    description: '描述', rawDescription: '描述',
    coverUrl: 'https://example.com/img.jpg', images: ['https://example.com/img.jpg'],
    sourcePublishedAt: null, shopUrl: '', tags: [], confidence: 100,
    ...overrides,
  };
}

describe('Weibo Source', () => {
  const adapter = new WeiboBrandSourceAdapter({ rateLimitMs: 0 });
  const parser = new WeiboParser();

  it('should fetch weibo fixture', async () => {
    const results = await adapter.fetchList('fixture://weibo-tufengfeng.json');
    expect(results).toHaveLength(1);
    expect(results[0]!.statusCode).toBe(200);
  });

  it('should parse weibo posts with product hints', async () => {
    const results = await adapter.fetchList('fixture://weibo-tufengfeng.json');
    const items = parser.parseList(results[0]!);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.brandName).toBe('兔缝缝JK制服');
    expect(items[0]!.sourceUrl).toContain('fixture://');
  });

  it('should extract deposit/balance from weibo', async () => {
    const results = await adapter.fetchList('fixture://weibo-tufengfeng.json');
    const items = parser.parseList(results[0]!);
    const preOrder = items.find((i: any) => i.saleStatus === 'PRE_ORDER');
    expect(preOrder).toBeTruthy();
    expect(preOrder!.depositPrice).toBe(3000);
    expect(preOrder!.balancePrice).toBe(5900);
  });
});

describe('WeChat MP Source', () => {
  const adapter = new WechatMpSourceAdapter({ rateLimitMs: 0 });
  const parser = new WechatMpParser();

  it('should fetch wechat fixture', async () => {
    const results = await adapter.fetchList('fixture://wechat-tufengfeng.json');
    expect(results).toHaveLength(1);
  });

  it('should parse wechat articles into products', async () => {
    const results = await adapter.fetchList('fixture://wechat-tufengfeng.json');
    const items = parser.parseList(results[0]!);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.brandName).toBe('兔缝缝JK制服');
  });

  it('should extract multiple products from single article', async () => {
    const results = await adapter.fetchList('fixture://wechat-tufengfeng.json');
    const items = parser.parseList(results[0]!);
    expect(items.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SourceMerger', () => {
  const merger = new SourceMerger();

  it('should merge by priority', () => {
    const candidates = [
      { item: makeItem({ currentPrice: 13800 }), sourceType: 'WEIBO', priority: SOURCE_PRIORITY['WEIBO']! },
      { item: makeItem({ currentPrice: 12800, description: '更详细的描述' }), sourceType: 'OFFICIAL', priority: SOURCE_PRIORITY['OFFICIAL']! },
    ];
    const result = merger.merge(candidates);
    expect(result.winner.sourceType).toBe('OFFICIAL');
    expect(result.winner.item.currentPrice).toBe(12800);
    expect(result.winner.item.description).toBe('更详细的描述');
  });

  it('should merge images from multiple sources', () => {
    const candidates = [
      { item: makeItem({ images: ['img1.jpg'] }), sourceType: 'OFFICIAL', priority: 1 },
      { item: makeItem({ images: ['img2.jpg', 'img3.jpg'] }), sourceType: 'WEIBO', priority: 4 },
    ];
    const result = merger.merge(candidates);
    expect(result.winner.item.images).toHaveLength(3);
  });

  it('should merge deposit from lower priority source', () => {
    const candidates = [
      { item: makeItem({ depositPrice: 0 }), sourceType: 'OFFICIAL', priority: 1 },
      { item: makeItem({ depositPrice: 3000, balancePrice: 5900 }), sourceType: 'WEIBO', priority: 4 },
    ];
    const result = merger.merge(candidates);
    expect(result.winner.item.depositPrice).toBe(3000);
    expect(result.winner.item.balancePrice).toBe(5900);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('should handle single candidate', () => {
    const candidates = [
      { item: makeItem(), sourceType: 'OFFICIAL', priority: 1 },
    ];
    const result = merger.merge(candidates);
    expect(result.losers).toHaveLength(0);
  });

  it('should disable specific sources', () => {
    const disabled = new Set(['WEIBO']);
    expect(merger.isSourceDisabled('WEIBO', disabled)).toBe(true);
    expect(merger.isSourceDisabled('OFFICIAL', disabled)).toBe(false);
  });
});
