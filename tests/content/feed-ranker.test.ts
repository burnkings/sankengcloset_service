// tests/content/feed-ranker.test.ts — updated for 12-table schema
import { describe, it, expect } from 'vitest';
import { formatPriceSummary, getReleaseTypeName, mergeTags, generateFeedReason } from '../../src/intelligence/feed-ranker.js';

describe('feed-ranker', () => {
  it('formatPriceSummary returns price string', () => {
    expect(formatPriceSummary(36800)).toBe('¥368.00');
    expect(formatPriceSummary(0)).toBe('价格待定');
  });

  it('getReleaseTypeName', () => {
    expect(getReleaseTypeName('first_release')).toBe('首发');
    expect(getReleaseTypeName('rerelease')).toBe('再贩');
    expect(getReleaseTypeName('unknown')).toBe('未知');
  });

  it('mergeTags merges from row object', () => {
    const row = { season_tags: ['春'], scene_tags: ['日常'], element_tags: ['蕾丝'], recommended_tags: ['热门'] };
    expect(mergeTags(row)).toEqual(['春', '日常', '蕾丝', '热门']);
  });

  it('mergeTags merges from arrays', () => {
    expect(mergeTags(['春'], ['日常'], ['蕾丝'], ['热门'])).toEqual(['春', '日常', '蕾丝', '热门']);
  });

  it('generateFeedReason', () => {
    expect(generateFeedReason({ sale_status: 'PRE_ORDER' })).toBe('预约中');
    expect(generateFeedReason({ sale_status: 'ON_SALE' })).toBe('在售');
    expect(generateFeedReason({ feed_score: 80 })).toBe('热门商品');
    expect(generateFeedReason({})).toBe('');
  });
});
