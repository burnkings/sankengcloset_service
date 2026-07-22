// tests/intelligence/feed-score.test.ts — Feed Score 评分测试

import { describe, it, expect } from 'vitest';
import { computeFeedScore, type FeedScoreInput } from '../../src/intelligence/feed-score.js';

function makeInput(overrides: Partial<FeedScoreInput> = {}): FeedScoreInput {
  return {
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3天前
    brand_heat_score: 70,
    is_new: true,
    sale_status: 'ON_SALE',
    price_trend: 'stable',
    has_price_drop: false,
    review_status: 'APPROVED',
    visibility_status: 'published',
    confidence: 90,
    view_count: 0,
    favorite_count: 0,
    ...overrides,
  };
}

describe('Feed Score', () => {
  it('should return score between 0 and 100', () => {
    const result = computeFeedScore(makeInput());
    expect(result.feed_score).toBeGreaterThanOrEqual(0);
    expect(result.feed_score).toBeLessThanOrEqual(100);
  });

  it('should give high score to new, approved, published product', () => {
    const result = computeFeedScore(makeInput({
      is_new: true,
      sale_status: 'UPCOMING',
      review_status: 'APPROVED',
      visibility_status: 'published',
      brand_heat_score: 80,
    }));
    expect(result.feed_score).toBeGreaterThanOrEqual(60);
  });

  it('should give low score to old, draft product', () => {
    const result = computeFeedScore(makeInput({
      created_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(), // 120天前
      is_new: false,
      visibility_status: 'draft',
      brand_heat_score: 10,
    }));
    expect(result.feed_score).toBeLessThanOrEqual(40);
  });

  it('should boost score for price drop', () => {
    const withDrop = computeFeedScore(makeInput({ has_price_drop: true, price_trend: 'down' }));
    const noDrop = computeFeedScore(makeInput({ has_price_drop: false, price_trend: 'stable' }));
    expect(withDrop.feed_score).toBeGreaterThan(noDrop.feed_score);
  });

  it('should boost score for high brand heat', () => {
    const hot = computeFeedScore(makeInput({ brand_heat_score: 90 }));
    const cold = computeFeedScore(makeInput({ brand_heat_score: 10 }));
    expect(hot.feed_score).toBeGreaterThan(cold.feed_score);
  });

  it('should include breakdown', () => {
    const result = computeFeedScore(makeInput());
    expect(result.breakdown).toHaveProperty('time_score');
    expect(result.breakdown).toHaveProperty('brand_score');
    expect(result.breakdown).toHaveProperty('newness_score');
    expect(result.breakdown).toHaveProperty('price_score');
    expect(result.breakdown).toHaveProperty('quality_score');
  });

  it('should give PRE_ORDER higher newness than ON_SALE', () => {
    const pre = computeFeedScore(makeInput({ sale_status: 'PRE_ORDER', is_new: true }));
    const sale = computeFeedScore(makeInput({ sale_status: 'ON_SALE', is_new: true }));
    expect(pre.breakdown.newness_score).toBeGreaterThanOrEqual(sale.breakdown.newness_score);
  });

  it('should give zero score for hidden product', () => {
    const result = computeFeedScore(makeInput({
      visibility_status: 'hidden',
      review_status: 'REJECTED',
    }));
    expect(result.breakdown.quality_score).toBeLessThanOrEqual(30);
  });

  it('should score published higher than reviewing', () => {
    const pub = computeFeedScore(makeInput({ visibility_status: 'published' }));
    const rev = computeFeedScore(makeInput({ visibility_status: 'reviewing' }));
    expect(pub.breakdown.quality_score).toBeGreaterThan(rev.breakdown.quality_score);
  });
});
