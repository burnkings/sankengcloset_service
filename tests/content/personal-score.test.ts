// tests/content/personal-score.test.ts — Personal Score 引擎测试

import { describe, it, expect } from 'vitest';
import { computePersonalScore, computeFinalScore, type UserPreference } from '../../src/intelligence/personal-score.js';

function makePreference(overrides: Partial<UserPreference> = {}): UserPreference {
  return {
    followedBrandIds: [],
    wishlistCategories: [],
    wishlistTags: [],
    viewedCategories: [],
    searchedKeywords: [],
    ...overrides,
  };
}

describe('Personal Score', () => {
  describe('computePersonalScore', () => {
    it('returns 0 for empty preference', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_1', category: 'JK', tags: ['春季'] },
        makePreference(),
      );
      expect(result.personalScore).toBe(0);
      expect(result.matchReason).toBe('');
    });

    it('scores brand match at 30', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_rabbit', category: 'JK', tags: [] },
        makePreference({ followedBrandIds: ['br_rabbit'] }),
      );
      expect(result.breakdown.brandMatch).toBe(30);
      expect(result.personalScore).toBeGreaterThan(0);
    });

    it('scores category match at 30', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_1', category: 'LOLITA', tags: [] },
        makePreference({ wishlistCategories: ['LOLITA'] }),
      );
      expect(result.breakdown.categoryMatch).toBe(30);
      expect(result.personalScore).toBeGreaterThan(0);
    });

    it('scores tag match proportionally', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_1', category: 'JK', tags: ['春季', '甜系'] },
        makePreference({ wishlistTags: ['春季', '甜系', '蝴蝶结'] }),
      );
      expect(result.breakdown.tagMatch).toBeGreaterThan(0);
      expect(result.breakdown.tagMatch).toBeLessThanOrEqual(40);
    });

    it('combines all signals', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_rabbit', category: 'JK', tags: ['春季'] },
        makePreference({
          followedBrandIds: ['br_rabbit'],
          wishlistCategories: ['JK'],
          wishlistTags: ['春季'],
        }),
      );
      expect(result.personalScore).toBeGreaterThan(50);
      expect(result.breakdown.brandMatch).toBe(30);
      expect(result.breakdown.categoryMatch).toBe(30);
      expect(result.breakdown.tagMatch).toBeGreaterThan(0);
    });

    it('generates match reason for brand match', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_rabbit', category: 'JK', tags: [] },
        makePreference({ followedBrandIds: ['br_rabbit'] }),
      );
      expect(result.matchReason).toContain('关注');
    });

    it('generates match reason for category match', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_1', category: 'LOLITA', tags: [] },
        makePreference({ wishlistCategories: ['LOLITA'] }),
      );
      expect(result.matchReason).toContain('品类');
    });

    it('caps score at 100', () => {
      const result = computePersonalScore(
        { userId: 'u1', productId: 'p1', brandId: 'br_rabbit', category: 'JK', tags: ['春季', '甜系', '蝴蝶结', '蕾丝', '格纹'] },
        makePreference({
          followedBrandIds: ['br_rabbit'],
          wishlistCategories: ['JK', 'LOLITA'],
          wishlistTags: ['春季', '甜系', '蝴蝶结', '蕾丝', '格纹'],
        }),
      );
      expect(result.personalScore).toBeLessThanOrEqual(100);
    });
  });

  describe('computeFinalScore', () => {
    it('computes weighted average', () => {
      // feed=80, personal=60 → 80*0.7 + 60*0.3 = 56+18 = 74
      expect(computeFinalScore(80, 60)).toBe(74);
    });

    it('handles zero personal score', () => {
      expect(computeFinalScore(80, 0)).toBe(56);
    });

    it('handles zero feed score', () => {
      expect(computeFinalScore(0, 60)).toBe(18);
    });
  });
});
