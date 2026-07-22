// tests/content/feed-ranker.test.ts — Feed 排序理由引擎测试

import { describe, it, expect } from 'vitest';
import {
  generateFeedReason,
  computeRankingScore,
  formatPriceSummary,
  getReleaseTypeName,
  mergeTags,
  reasonBoost,
} from '../../src/intelligence/feed-ranker.js';

describe('Feed Ranker', () => {
  describe('formatPriceSummary', () => {
    it('formats price in yuan', () => {
      expect(formatPriceSummary(36800)).toBe('¥368.00');
      expect(formatPriceSummary(12800)).toBe('¥128.00');
    });

    it('shows 待定 for zero price', () => {
      expect(formatPriceSummary(0)).toBe('价格待定');
    });

    it('shows 待定 for negative price', () => {
      expect(formatPriceSummary(-100)).toBe('价格待定');
    });
  });

  describe('getReleaseTypeName', () => {
    it('maps known types', () => {
      expect(getReleaseTypeName('first_release')).toBe('首发');
      expect(getReleaseTypeName('rerelease')).toBe('再贩');
      expect(getReleaseTypeName('reservation')).toBe('预约');
      expect(getReleaseTypeName('spot')).toBe('现货');
      expect(getReleaseTypeName('lottery')).toBe('抽选');
    });

    it('returns 未知 for unknown type', () => {
      expect(getReleaseTypeName('unknown')).toBe('未知');
      expect(getReleaseTypeName('')).toBe('未知');
    });
  });

  describe('mergeTags', () => {
    it('merges and deduplicates tags', () => {
      const result = mergeTags(['春季'], ['日常'], ['蝴蝶结'], ['热门']);
      expect(result).toEqual(['春季', '日常', '蝴蝶结', '热门']);
    });

    it('deduplicates across categories', () => {
      const result = mergeTags(['春季', '日常'], ['日常', '约会'], [], []);
      expect(result).toEqual(['春季', '日常', '约会']);
    });

    it('handles empty arrays', () => {
      expect(mergeTags([], [], [], [])).toEqual([]);
    });
  });

  describe('generateFeedReason', () => {
    it('returns 即将截止预约 for event ending within 72h', () => {
      const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h from now
      const reason = generateFeedReason({
        saleStatus: 'PRE_ORDER',
        releaseType: 'reservation',
        isRerelease: false,
        isNew: true,
        brandHeatScore: 50,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 50,
        eventEndAt: soon,
      });
      expect(reason).toBe('即将截止预约');
    });

    it('returns 热门品牌新品 for high heat + new', () => {
      const reason = generateFeedReason({
        saleStatus: 'UPCOMING',
        releaseType: 'first_release',
        isRerelease: false,
        isNew: true,
        brandHeatScore: 80,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 70,
      });
      expect(reason).toBe('热门品牌新品');
    });

    it('returns 历史高热再贩 for high score + rerelease', () => {
      const reason = generateFeedReason({
        saleStatus: 'ON_SALE',
        releaseType: 'rerelease',
        isRerelease: true,
        isNew: false,
        brandHeatScore: 50,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 70,
      });
      expect(reason).toBe('历史高热再贩');
    });

    it('returns 最近降价 for price drop', () => {
      const reason = generateFeedReason({
        saleStatus: 'ON_SALE',
        releaseType: 'unknown',
        isRerelease: false,
        isNew: false,
        brandHeatScore: 50,
        hasPriceDrop: true,
        priceTrend: 'down',
        feedScore: 50,
      });
      expect(reason).toBe('最近降价');
    });

    it('returns 首发预售 for reservation + PRE_ORDER', () => {
      const reason = generateFeedReason({
        saleStatus: 'PRE_ORDER',
        releaseType: 'reservation',
        isRerelease: false,
        isNew: false,
        brandHeatScore: 30,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 40,
      });
      expect(reason).toBe('首发预售');
    });

    it('returns 品牌上新 for new product', () => {
      const reason = generateFeedReason({
        saleStatus: 'ON_SALE',
        releaseType: 'unknown',
        isRerelease: false,
        isNew: true,
        brandHeatScore: 30,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 50,
      });
      expect(reason).toBe('品牌上新');
    });

    it('returns 再贩返场 for rerelease', () => {
      const reason = generateFeedReason({
        saleStatus: 'ON_SALE',
        releaseType: 'rerelease',
        isRerelease: true,
        isNew: false,
        brandHeatScore: 30,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 40,
      });
      expect(reason).toBe('再贩返场');
    });

    it('returns 现货在售 for ON_SALE', () => {
      const reason = generateFeedReason({
        saleStatus: 'ON_SALE',
        releaseType: 'unknown',
        isRerelease: false,
        isNew: false,
        brandHeatScore: 30,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 40,
      });
      expect(reason).toBe('现货在售');
    });

    it('returns 精选推荐 as default', () => {
      const reason = generateFeedReason({
        saleStatus: 'SOLD_OUT',
        releaseType: 'unknown',
        isRerelease: false,
        isNew: false,
        brandHeatScore: 10,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore: 10,
      });
      expect(reason).toBe('精选推荐');
    });
  });

  describe('reasonBoost', () => {
    it('returns higher boost for higher priority reasons', () => {
      expect(reasonBoost('即将截止预约')).toBeGreaterThan(reasonBoost('热门品牌新品'));
      expect(reasonBoost('热门品牌新品')).toBeGreaterThan(reasonBoost('历史高热再贩'));
      expect(reasonBoost('历史高热再贩')).toBeGreaterThan(reasonBoost('最近降价'));
      expect(reasonBoost('最近降价')).toBeGreaterThan(reasonBoost('精选推荐'));
    });

    it('returns 0 for default reason', () => {
      expect(reasonBoost('精选推荐')).toBe(0);
    });
  });

  describe('computeRankingScore', () => {
    it('adds feed score and reason boost', () => {
      const score = computeRankingScore(60, '热门品牌新品');
      expect(score).toBe(60 + 25); // 85
    });

    it('handles default reason with no boost', () => {
      const score = computeRankingScore(50, '精选推荐');
      expect(score).toBe(50);
    });
  });
});
