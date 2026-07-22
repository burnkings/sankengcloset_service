// tests/intelligence/release-intelligence.test.ts — Release Intelligence 测试

import { describe, it, expect } from 'vitest';
import {
  analyzeRelease, parseReleaseNo, detectReleaseType,
  detectRerelease, detectSaleStage,
} from '../../src/intelligence/release-intelligence.js';

describe('Release Intelligence', () => {
  describe('parseReleaseNo', () => {
    it('should parse 一期', () => expect(parseReleaseNo('一期预约')).toBe(1));
    it('should parse 二期', () => expect(parseReleaseNo('二期再贩')).toBe(2));
    it('should parse 三期', () => expect(parseReleaseNo('三期现货')).toBe(3));
    it('should parse 第1批', () => expect(parseReleaseNo('第1批')).toBe(1));
    it('should parse 第2批', () => expect(parseReleaseNo('第2批')).toBe(2));
    it('should parse 第5期', () => expect(parseReleaseNo('第5期')).toBe(5));
    it('should return 0 for unknown', () => expect(parseReleaseNo('格裙')).toBe(0));
  });

  describe('detectReleaseType', () => {
    it('should detect rerelease', () => expect(detectReleaseType('再贩格裙')).toBe('rerelease'));
    it('should detect reservation', () => expect(detectReleaseType('预约开始')).toBe('reservation'));
    it('should detect spot', () => expect(detectReleaseType('现货即发')).toBe('spot'));
    it('should detect lottery', () => expect(detectReleaseType('抽选开始')).toBe('lottery'));
    it('should detect first_release', () => expect(detectReleaseType('首发')).toBe('first_release'));
    it('should return unknown for plain text', () => expect(detectReleaseType('格裙')).toBe('unknown'));
  });

  describe('detectRerelease', () => {
    it('should detect 再贩', () => expect(detectRerelease('再贩')).toBe(true));
    it('should detect 返场', () => expect(detectRerelease('返场')).toBe(true));
    it('should detect 复刻', () => expect(detectRerelease('复刻')).toBe(true));
    it('should return false for normal text', () => expect(detectRerelease('格裙')).toBe(false));
  });

  describe('detectSaleStage', () => {
    it('should detect sold_out', () => {
      expect(detectSaleStage('售罄')).toEqual({ lifecycle_status: 'sold_out', sale_status: 'SOLD_OUT' });
    });
    it('should detect ended', () => {
      expect(detectSaleStage('预约已结束')).toEqual({ lifecycle_status: 'ended', sale_status: 'ENDED' });
    });
    it('should detect reservation active', () => {
      expect(detectSaleStage('预约中')).toEqual({ lifecycle_status: 'active', sale_status: 'PRE_ORDER' });
    });
    it('should detect spot active', () => {
      expect(detectSaleStage('现货即发')).toEqual({ lifecycle_status: 'active', sale_status: 'ON_SALE' });
    });
    it('should detect upcoming', () => {
      expect(detectSaleStage('即将开售')).toEqual({ lifecycle_status: 'upcoming', sale_status: 'UPCOMING' });
    });
  });

  describe('analyzeRelease', () => {
    it('should parse 一期商品', () => {
      const result = analyzeRelease('兔缝缝 一期 格裙 预约');
      expect(result.release_no).toBe(1);
      expect(result.release_name).toContain('1期');
      expect(result.release_type).toBe('reservation');
      expect(result.sale_status).toBe('PRE_ORDER');
      expect(result.is_rerelease).toBe(false);
    });

    it('should parse 二期再贩', () => {
      const result = analyzeRelease('兔缝缝 二期再贩 格裙');
      expect(result.release_no).toBe(2);
      expect(result.release_type).toBe('rerelease');
      expect(result.is_rerelease).toBe(true);
    });

    it('should parse 现货售罄', () => {
      const result = analyzeRelease('格裙 现货 售罄');
      expect(result.release_type).toBe('spot');
      expect(result.is_sold_out).toBe(true);
      expect(result.sale_status).toBe('SOLD_OUT');
    });

    it('should parse 尾款阶段', () => {
      const result = analyzeRelease('一期 格裙 尾款支付中');
      expect(result.sale_status).toBe('ON_SALE');
      expect(result.lifecycle_status).toBe('active');
    });

    it('should handle no release info', () => {
      const result = analyzeRelease('经典格裙');
      expect(result.release_no).toBe(0);
      expect(result.release_type).toBe('unknown');
      expect(result.confidence).toBeLessThanOrEqual(60);
    });

    it('should give high confidence for clear signals', () => {
      const result = analyzeRelease('二期再贩 预约 定金100');
      expect(result.confidence).toBeGreaterThanOrEqual(80);
    });
  });
});
