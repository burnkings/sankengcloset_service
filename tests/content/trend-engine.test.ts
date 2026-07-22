// tests/content/trend-engine.test.ts — 趋势引擎测试

import { describe, it, expect } from 'vitest';
import {
  computeBrandTrends,
  computeProductTrends,
  buildTrendSummary,
} from '../../src/intelligence/trend-engine.js';

describe('Trend Engine', () => {
  describe('computeBrandTrends', () => {
    it('computes 7d and 30d trends for each brand', () => {
      const trends = computeBrandTrends([{
        brand_id: 'br_1',
        brand_name: '测试品牌',
        heat_score: 70,
        product_count: 10,
        new_product_count_7d: 2,
        new_product_count_30d: 5,
        rerelease_count_7d: 1,
        rerelease_count_30d: 3,
        avg_price_current: 20000,
        avg_price_30d_ago: 18000,
        avg_price_90d_ago: 15000,
      }]);

      expect(trends).toHaveLength(2);
      expect(trends[0]?.period).toBe('7d');
      expect(trends[0]?.newProductCount).toBe(2);
      expect(trends[0]?.rereleaseCount).toBe(1);
      expect(trends[0]?.brandName).toBe('测试品牌');
      expect(trends[1]?.period).toBe('30d');
      expect(trends[1]?.newProductCount).toBe(5);
    });

    it('calculates price change percentage correctly', () => {
      const trends = computeBrandTrends([{
        brand_id: 'br_1',
        brand_name: '涨价品牌',
        heat_score: 50,
        product_count: 5,
        new_product_count_7d: 1,
        new_product_count_30d: 2,
        rerelease_count_7d: 0,
        rerelease_count_30d: 1,
        avg_price_current: 22000,
        avg_price_30d_ago: 20000,
        avg_price_90d_ago: 18000,
      }]);

      // 7d: (22000 - 20000) / 20000 * 100 = 10%
      expect(trends[0]?.priceChangePercent).toBe(10);
      // 30d: (22000 - 18000) / 18000 * 100 ≈ 22%
      expect(trends[1]?.priceChangePercent).toBe(22);
    });

    it('handles zero previous price', () => {
      const trends = computeBrandTrends([{
        brand_id: 'br_1',
        brand_name: '新品牌',
        heat_score: 30,
        product_count: 2,
        new_product_count_7d: 2,
        new_product_count_30d: 2,
        rerelease_count_7d: 0,
        rerelease_count_30d: 0,
        avg_price_current: 15000,
        avg_price_30d_ago: 0,
        avg_price_90d_ago: 0,
      }]);

      expect(trends[0]?.priceChangePercent).toBe(0);
      expect(trends[1]?.priceChangePercent).toBe(0);
    });

    it('handles multiple brands', () => {
      const trends = computeBrandTrends([
        {
          brand_id: 'br_1', brand_name: '品牌A', heat_score: 80,
          product_count: 10, new_product_count_7d: 3, new_product_count_30d: 8,
          rerelease_count_7d: 1, rerelease_count_30d: 4,
          avg_price_current: 25000, avg_price_30d_ago: 22000, avg_price_90d_ago: 20000,
        },
        {
          brand_id: 'br_2', brand_name: '品牌B', heat_score: 50,
          product_count: 5, new_product_count_7d: 1, new_product_count_30d: 3,
          rerelease_count_7d: 0, rerelease_count_30d: 1,
          avg_price_current: 18000, avg_price_30d_ago: 18000, avg_price_90d_ago: 16000,
        },
      ]);

      // 2 brands * 2 periods = 4 trends
      expect(trends).toHaveLength(4);
    });
  });

  describe('computeProductTrends', () => {
    it('computes price change correctly', () => {
      const trends = computeProductTrends([{
        product_id: 'prd_1',
        product_name: '测试商品',
        brand_name: '测试品牌',
        category: 'JK',
        current_price: 15000,
        previous_price: 12000,
        price_30d_ago: 10000,
        current_feed_score: 70,
        previous_feed_score: 60,
        current_sale_status: 'ON_SALE',
        previous_sale_status: 'ON_SALE',
      }]);

      expect(trends).toHaveLength(1);
      expect(trends[0]?.priceChange).toBe(3000);
      expect(trends[0]?.priceChangePercent).toBe(25);
      expect(trends[0]?.feedScoreChange).toBe(10);
      expect(trends[0]?.saleStatusChanged).toBe(false);
    });

    it('detects sale status change', () => {
      const trends = computeProductTrends([{
        product_id: 'prd_1',
        product_name: '售罄商品',
        brand_name: '测试品牌',
        category: 'LOLITA',
        current_price: 30000,
        previous_price: 30000,
        price_30d_ago: 30000,
        current_feed_score: 80,
        previous_feed_score: 75,
        current_sale_status: 'SOLD_OUT',
        previous_sale_status: 'ON_SALE',
      }]);

      expect(trends[0]?.saleStatusChanged).toBe(true);
      expect(trends[0]?.currentSaleStatus).toBe('SOLD_OUT');
      expect(trends[0]?.previousSaleStatus).toBe('ON_SALE');
    });

    it('handles zero previous price', () => {
      const trends = computeProductTrends([{
        product_id: 'prd_1',
        product_name: '新商品',
        brand_name: '测试品牌',
        category: 'HANFU',
        current_price: 20000,
        previous_price: 0,
        price_30d_ago: 0,
        current_feed_score: 50,
        previous_feed_score: 50,
        current_sale_status: 'UPCOMING',
        previous_sale_status: 'UPCOMING',
      }]);

      expect(trends[0]?.priceChangePercent).toBe(0);
    });
  });

  describe('buildTrendSummary', () => {
    it('builds summary with timestamp', () => {
      const summary = buildTrendSummary([], []);
      expect(summary.brandTrends).toEqual([]);
      expect(summary.productTrends).toEqual([]);
      expect(summary.generatedAt).toBeDefined();
      expect(new Date(summary.generatedAt).getTime()).toBeGreaterThan(0);
    });

    it('includes all provided trends', () => {
      const summary = buildTrendSummary(
        [{ brandId: 'br_1', brandName: 'A', period: '7d', newProductCount: 1, rereleaseCount: 0, avgPriceCents: 10000, priceChangePercent: 5, heatScore: 60, productCount: 5 }],
        [{ productId: 'prd_1', productName: 'B', brandName: 'A', category: 'JK', period: '30d', priceChange: 1000, priceChangePercent: 10, feedScoreChange: 5, saleStatusChanged: false, currentSaleStatus: 'ON_SALE', previousSaleStatus: 'ON_SALE' }],
      );
      expect(summary.brandTrends).toHaveLength(1);
      expect(summary.productTrends).toHaveLength(1);
    });
  });
});
