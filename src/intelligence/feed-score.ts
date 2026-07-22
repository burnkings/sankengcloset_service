// intelligence/feed-score.ts — Feed 评分引擎
// 基于多维度信号计算商品的 Feed 排序分数（0-100）
// 第一版：不用 AI，纯规则

export interface FeedScoreInput {
  // 时间维度
  created_at: string;            // 商品创建时间
  source_published_at?: string;  // 原始发布时间
  last_seen_at?: string;         // 最后采集时间

  // 品牌维度
  brand_heat_score: number;      // 品牌热度 0-100

  // 新品维度
  is_new: boolean;               // 是否新品（7天内）
  sale_status: string;           // UPCOMING / ON_SALE / PRE_ORDER / SOLD_OUT / ENDED

  // 价格维度
  price_trend: 'stable' | 'down' | 'up' | 'volatile';
  has_price_drop: boolean;       // 最近是否有降价

  // 审核维度
  review_status: string;         // PENDING / APPROVED / REJECTED / CORRECTED
  visibility_status: string;     // draft / reviewing / published / hidden
  confidence: number;            // 置信度 0-100

  // 互动维度（预留）
  view_count: number;
  favorite_count: number;
}

export interface FeedScoreResult {
  feed_score: number;            // 综合分数 0-100
  breakdown: {
    time_score: number;          // 时间新鲜度
    brand_score: number;         // 品牌热度贡献
    newness_score: number;       // 新品加分
    price_score: number;         // 价格信号
    quality_score: number;       // 质量/审核信号
  };
}

// ────────────────────────────────────────────────
// 评分权重
// ────────────────────────────────────────────────

const WEIGHTS = {
  time: 0.25,      // 时间新鲜度
  brand: 0.20,     // 品牌热度
  newness: 0.20,   // 新品
  price: 0.15,     // 价格信号
  quality: 0.20,   // 质量/审核
};

// ────────────────────────────────────────────────
// 评分子函数
// ────────────────────────────────────────────────

/**
 * 时间新鲜度评分（0-100）
 * 7天内满分，30天后递减，90天后为0
 */
function timeScore(createdAt: string, publishedAt?: string): number {
  const refTime = publishedAt || createdAt;
  const ageDays = (Date.now() - new Date(refTime).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return 100;
  if (ageDays <= 14) return 80;
  if (ageDays <= 30) return 60;
  if (ageDays <= 60) return 30;
  if (ageDays <= 90) return 10;
  return 0;
}

/**
 * 品牌热度贡献（0-100）
 * 直接使用品牌热度分数
 */
function brandScore(heatScore: number): number {
  return Math.min(100, Math.max(0, heatScore));
}

/**
 * 新品加分（0-100）
 * UPCOMING/PRE_ORDER +100，ON_SALE +60，其他 +20
 * 7天内额外 +30
 */
function newnessScore(isNew: boolean, saleStatus: string): number {
  let base = 20;
  if (saleStatus === 'UPCOMING' || saleStatus === 'PRE_ORDER') base = 100;
  else if (saleStatus === 'ON_SALE') base = 60;

  if (isNew) base = Math.min(100, base + 30);
  return base;
}

/**
 * 价格信号评分（0-100）
 * 降价 +80，稳定 +50，涨价 +30，波动 +40
 */
function priceScore(trend: string, hasPriceDrop: boolean): number {
  if (hasPriceDrop) return 80;
  switch (trend) {
    case 'down': return 70;
    case 'stable': return 50;
    case 'volatile': return 40;
    case 'up': return 30;
    default: return 40;
  }
}

/**
 * 质量/审核信号评分（0-100）
 * approved + published + 高置信度 = 满分
 */
function qualityScore(
  reviewStatus: string,
  visibilityStatus: string,
  confidence: number,
): number {
  let base = 0;

  // 审核状态
  if (reviewStatus === 'APPROVED') base += 40;
  else if (reviewStatus === 'PENDING') base += 20;
  else base += 0;

  // 发布状态
  if (visibilityStatus === 'published') base += 30;
  else if (visibilityStatus === 'reviewing') base += 15;
  else base += 0;

  // 置信度
  base += Math.round((confidence / 100) * 30);

  return Math.min(100, base);
}

// ────────────────────────────────────────────────
// 主评分函数
// ────────────────────────────────────────────────

/**
 * 计算 Feed Score
 */
export function computeFeedScore(input: FeedScoreInput): FeedScoreResult {
  const ts = timeScore(input.created_at, input.source_published_at);
  const bs = brandScore(input.brand_heat_score);
  const ns = newnessScore(input.is_new, input.sale_status);
  const ps = priceScore(input.price_trend, input.has_price_drop);
  const qs = qualityScore(input.review_status, input.visibility_status, input.confidence);

  const feedScore = Math.round(
    ts * WEIGHTS.time +
    bs * WEIGHTS.brand +
    ns * WEIGHTS.newness +
    ps * WEIGHTS.price +
    qs * WEIGHTS.quality,
  );

  return {
    feed_score: Math.min(100, Math.max(0, feedScore)),
    breakdown: {
      time_score: ts,
      brand_score: bs,
      newness_score: ns,
      price_score: ps,
      quality_score: qs,
    },
  };
}

/**
 * 批量计算 Feed Score
 */
export function computeBatchFeedScore(inputs: FeedScoreInput[]): FeedScoreResult[] {
  return inputs.map(computeFeedScore);
}
