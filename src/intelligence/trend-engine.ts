// intelligence/trend-engine.ts — 趋势数据引擎
// 基于 price_snapshots、brands、product_releases 聚合趋势数据

import type { BrandTrend, ProductTrend, TrendSummary } from '../types.js';

// ─── 品牌趋势 ────────────────────────────────────────────

export interface BrandTrendInput {
  brand_id: string;
  brand_name: string;
  heat_score: number;
  product_count: number;
  new_product_count_7d: number;
  new_product_count_30d: number;
  rerelease_count_7d: number;
  rerelease_count_30d: number;
  avg_price_current: number;
  avg_price_30d_ago: number;
  avg_price_90d_ago: number;
}

/**
 * 计算品牌趋势
 */
export function computeBrandTrends(inputs: BrandTrendInput[]): BrandTrend[] {
  const results: BrandTrend[] = [];

  for (const input of inputs) {
    // 7天趋势
    const priceChange7d = input.avg_price_30d_ago > 0
      ? Math.round(((input.avg_price_current - input.avg_price_30d_ago) / input.avg_price_30d_ago) * 100)
      : 0;

    results.push({
      brandId: input.brand_id,
      brandName: input.brand_name,
      period: '7d',
      newProductCount: input.new_product_count_7d,
      rereleaseCount: input.rerelease_count_7d,
      avgPriceCents: input.avg_price_current,
      priceChangePercent: priceChange7d,
      heatScore: input.heat_score,
      productCount: input.product_count,
    });

    // 30天趋势
    const priceChange30d = input.avg_price_90d_ago > 0
      ? Math.round(((input.avg_price_current - input.avg_price_90d_ago) / input.avg_price_90d_ago) * 100)
      : 0;

    results.push({
      brandId: input.brand_id,
      brandName: input.brand_name,
      period: '30d',
      newProductCount: input.new_product_count_30d,
      rereleaseCount: input.rerelease_count_30d,
      avgPriceCents: input.avg_price_current,
      priceChangePercent: priceChange30d,
      heatScore: input.heat_score,
      productCount: input.product_count,
    });
  }

  return results;
}

// ─── 商品趋势 ────────────────────────────────────────────

export interface ProductTrendInput {
  product_id: string;
  product_name: string;
  brand_name: string;
  category: string;
  current_price: number;
  previous_price: number;
  price_30d_ago: number;
  current_feed_score: number;
  previous_feed_score: number;
  current_sale_status: string;
  previous_sale_status: string;
}

/**
 * 计算商品趋势
 */
export function computeProductTrends(inputs: ProductTrendInput[], period: string = '30d'): ProductTrend[] {
  return inputs.map(input => {
    const priceChange = input.current_price - input.previous_price;
    const priceChangePercent = input.previous_price > 0
      ? Math.round(((input.current_price - input.previous_price) / input.previous_price) * 100)
      : 0;
    const feedScoreChange = input.current_feed_score - input.previous_feed_score;
    const saleStatusChanged = input.current_sale_status !== input.previous_sale_status;

    return {
      productId: input.product_id,
      productName: input.product_name,
      brandName: input.brand_name,
      category: input.category,
      period,
      priceChange,
      priceChangePercent,
      feedScoreChange,
      saleStatusChanged,
      currentSaleStatus: input.current_sale_status,
      previousSaleStatus: input.previous_sale_status,
    };
  });
}

/**
 * 生成趋势摘要
 */
export function buildTrendSummary(
  brandTrends: BrandTrend[],
  productTrends: ProductTrend[],
): TrendSummary {
  return {
    brandTrends,
    productTrends,
    generatedAt: new Date().toISOString(),
  };
}
