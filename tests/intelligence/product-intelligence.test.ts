// tests/intelligence/product-intelligence.test.ts — 商品智能标签测试

import { describe, it, expect } from 'vitest';
import { analyzeProduct, mergeIntelligence, recommendTags } from '../../src/intelligence/product-intelligence.js';

describe('Product Intelligence', () => {
  describe('analyzeProduct', () => {
    it('should extract style tags from JK product', () => {
      const result = analyzeProduct('经典绀色格裙 日常百搭 JK制服');
      expect(result.style_tags).toContain('学院');
      expect(result.style_tags).toContain('日常');
    });

    it('should extract color tags', () => {
      const result = analyzeProduct('深蓝格裙 绀色');
      expect(result.color_tags).toContain('蓝色系');
      expect(result.color_tags).toContain('黑色系');
    });

    it('should extract season tags', () => {
      const result = analyzeProduct('夏季薄款雪纺LO裙');
      expect(result.season_tags).toContain('夏季');
    });

    it('should extract scene tags', () => {
      const result = analyzeProduct('日常通勤 JK制服 基础款');
      expect(result.scene_tags).toContain('日常');
    });

    it('should extract material tags', () => {
      const result = analyzeProduct('涤纶面料 高密度 格裙');
      expect(result.material_tags).toContain('涤纶');
    });

    it('should extract element tags', () => {
      const result = analyzeProduct('蝴蝶结 格裙 褶皱 百褶');
      expect(result.element_tags).toContain('蝴蝶结');
      expect(result.element_tags).toContain('褶皱');
    });

    it('should handle empty text gracefully', () => {
      const result = analyzeProduct('');
      expect(result.style_tags).toHaveLength(0);
      expect(result.color_tags).toHaveLength(0);
    });

    it('should extract Lolita style tags', () => {
      const result = analyzeProduct('甜系 Lolita 田园碎花 OP 蕾丝边 茶会');
      expect(result.style_tags).toContain('甜美');
      expect(result.style_tags).toContain('清新');
      expect(result.scene_tags).toContain('茶会');
      expect(result.element_tags).toContain('蕾丝边');
    });

    it('should extract Gothic style tags', () => {
      const result = analyzeProduct('哥特暗黑 JSK 十字架 蕾丝');
      expect(result.style_tags).toContain('哥特');
      expect(result.element_tags).toContain('蕾丝边');
    });

    it('should extract Hanfu style tags', () => {
      const result = analyzeProduct('明制马面裙 织金 国风 汉元素');
      expect(result.style_tags).toContain('国风');
      expect(result.style_tags).toContain('华丽');
      expect(result.element_tags).toContain('织金');
    });
  });

  describe('mergeIntelligence', () => {
    it('should merge tags without duplicates', () => {
      const a = analyzeProduct('甜系 格裙');
      const b = analyzeProduct('哥特 暗黑');
      const merged = mergeIntelligence(a, b);
      expect(merged.style_tags).toContain('甜美');
      expect(merged.style_tags).toContain('哥特');
      expect(merged.style_tags.length).toBe(2);
    });

    it('should deduplicate overlapping tags', () => {
      const a = analyzeProduct('甜系 蝴蝶结');
      const b = analyzeProduct('甜系 蕾丝');
      const merged = mergeIntelligence(a, b);
      expect(merged.style_tags).toEqual(['甜美']);
      expect(merged.element_tags).toContain('蝴蝶结');
      expect(merged.element_tags).toContain('蕾丝边');
    });
  });

  describe('recommendTags', () => {
    it('should prioritize style over other tags', () => {
      const intel = analyzeProduct('甜系 Lolita 粉色 蝴蝶结 蕾丝 茶会');
      const tags = recommendTags(intel, 3);
      expect(tags[0]).toBe('甜美');
    });

    it('should limit to maxTags', () => {
      const intel = analyzeProduct('甜系 粉色 蝴蝶结 蕾丝 茶会 夏季');
      const tags = recommendTags(intel, 3);
      expect(tags.length).toBeLessThanOrEqual(3);
    });

    it('should return empty for empty input', () => {
      const tags = recommendTags(analyzeProduct(''), 5);
      expect(tags).toHaveLength(0);
    });
  });
});
