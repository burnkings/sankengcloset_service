// intelligence/brand-intelligence.ts — 品牌智能画像引擎
// 从数据库聚合品牌维度数据，生成品牌画像

export interface BrandProfile {
  brand_id: string;
  brand_name: string;
  heat_score: number;           // 品牌热度 0-100
  update_frequency_days: number; // 平均更新间隔（天）
  avg_price_cents: number;       // 平均售价（分）
  popular_series: string[];      // 热门系列（从 category 聚合）
  release_cycle_days: number;    // 发售周期（天）
  brand_status: 'active' | 'quiet' | 'inactive'; // 品牌状态
  product_count: number;         // 商品总数
  follower_count: number;        // 粉丝数
}

interface ProductRow {
  id: string;
  category: string;
  current_price: number;
  created_at: string;
}

interface BrandRow {
  id: string;
  name: string;
  follower_count: number;
}

// ────────────────────────────────────────────────
// 计算引擎
// ────────────────────────────────────────────────

/**
 * 计算品牌热度评分（0-100）
 * 基于：商品数量(30%) + 粉丝数(25%) + 更新频率(25%) + 价格区间(20%)
 */
function computeHeatScore(
  productCount: number,
  followerCount: number,
  avgUpdateDays: number,
  avgPrice: number,
): number {
  // 商品数量评分（0-30）：10个商品得满分
  const productScore = Math.min(30, (productCount / 10) * 30);

  // 粉丝数评分（0-25）：10万粉丝得满分
  const followerScore = Math.min(25, (followerCount / 100000) * 25);

  // 更新频率评分（0-25）：每周更新得满分，超过90天为0
  const freqScore = avgUpdateDays <= 0 ? 0
    : avgUpdateDays <= 7 ? 25
    : avgUpdateDays <= 30 ? 20
    : avgUpdateDays <= 60 ? 12
    : avgUpdateDays <= 90 ? 5
    : 0;

  // 价格区间评分（0-20）：100-300元区间最优
  const priceScore = avgPrice > 0
    ? avgPrice >= 10000 && avgPrice <= 30000 ? 20
    : avgPrice >= 5000 && avgPrice <= 50000 ? 15
    : 8
    : 5;

  return Math.round(productScore + followerScore + freqScore + priceScore);
}

/**
 * 计算品牌状态
 */
function computeBrandStatus(avgUpdateDays: number, productCount: number): 'active' | 'quiet' | 'inactive' {
  if (productCount === 0) return 'inactive';
  if (avgUpdateDays <= 30) return 'active';
  if (avgUpdateDays <= 90) return 'quiet';
  return 'inactive';
}

/**
 * 计算发售周期（天）：相邻商品创建时间的平均间隔
 */
function computeReleaseCycle(products: ProductRow[]): number {
  if (products.length < 2) return 0;
  const sorted = products
    .map(p => new Date(p.created_at).getTime())
    .sort((a, b) => a - b);
  let totalDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalDays += (sorted[i]! - sorted[i - 1]!) / (1000 * 60 * 60 * 24);
  }
  return Math.round(totalDays / (sorted.length - 1));
}

/**
 * 提取热门系列（按 category 频率排序，取 top 3）
 */
function computePopularSeries(products: ProductRow[]): string[] {
  const freq = new Map<string, number>();
  for (const p of products) {
    const cat = p.category || '其他';
    freq.set(cat, (freq.get(cat) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);
}

/**
 * 计算平均更新间隔（天）
 */
function computeAvgUpdateDays(products: ProductRow[]): number {
  if (products.length < 2) return 0;
  const timestamps = products
    .map(p => new Date(p.created_at).getTime())
    .sort((a, b) => a - b);
  let totalDays = 0;
  for (let i = 1; i < timestamps.length; i++) {
    totalDays += (timestamps[i]! - timestamps[i - 1]!) / (1000 * 60 * 60 * 24);
  }
  return Math.round(totalDays / (timestamps.length - 1));
}

/**
 * 生成品牌画像
 */
export function buildBrandProfile(
  brand: BrandRow,
  products: ProductRow[],
): BrandProfile {
  const productCount = products.length;
  const followerCount = brand.follower_count;
  const avgPrice = productCount > 0
    ? Math.round(products.reduce((s, p) => s + p.current_price, 0) / productCount)
    : 0;
  const avgUpdateDays = computeAvgUpdateDays(products);
  const releaseCycle = computeReleaseCycle(products);
  const popularSeries = computePopularSeries(products);
  const heatScore = computeHeatScore(productCount, followerCount, avgUpdateDays, avgPrice);
  const brandStatus = computeBrandStatus(avgUpdateDays, productCount);

  return {
    brand_id: brand.id,
    brand_name: brand.name,
    heat_score: heatScore,
    update_frequency_days: avgUpdateDays,
    avg_price_cents: avgPrice,
    popular_series: popularSeries,
    release_cycle_days: releaseCycle,
    brand_status: brandStatus,
    product_count: productCount,
    follower_count: followerCount,
  };
}
