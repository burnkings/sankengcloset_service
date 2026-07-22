export type Category = 'JK' | 'LOLITA' | 'HANFU' | 'OTHER';

export interface UserProfile {
  id: string;
  nickname: string;
  status: 'active';
  createdAt: string;
}

export interface Product {
  id: string;
  brandId: string;
  brandName: string;
  title: string;
  category: Category;
  status: string;
  coverUrl: string;
  images: string[];
  priceCents: number;
  originalPriceCents: number;
  description: string;
  shopUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedItem {
  id: string;
  feedType: string;
  entityId: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  secondaryCoverUrl: string;
  brandId: string;
  brandName: string;
  price: number;
  originalPrice: number;
  badgeText: string;
  eventStartAt: string;
  eventEndAt: string;
  liked: boolean;
  saved: boolean;
  sourceLabel: string;
  rankingScore: number;
  category: string;
  createdAt: string;
}

export interface SyncOperationInput {
  opId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: string;
  createdAt: string;
}

export interface SyncReceipt {
  opId: string;
  result: 'accepted' | 'rejected' | 'conflict';
  serverVersion: number;
  error?: { code: string; message: string; retryable: boolean };
}

export interface MediaObject {
  id: string;
  ownerUserId: string;
  objectKey: string;
  uploadId: string;
  purpose: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface AiSuggestion {
  name: string;
  category: Category;
  brand: string;
  priceCents: number;
  color: string;
  size: string;
  note: string;
}

export interface AiImportTask {
  taskId: string;
  userId: string;
  objectKey: string;
  state: 'ready' | 'confirmed' | 'failed';
  requestId: string;
  model: { provider: string; name: string; version: string };
  suggestion: AiSuggestion;
  confidence: number;
  fieldConfidence: Record<string, number>;
  evidence: string[];
  warnings: string[];
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  targetType: 'wardrobe' | 'wishlist' | null;
  targetId: string | null;
}

export interface AiConfirmationInput {
  opId: string;
  targetType: 'wardrobe' | 'wishlist';
  confirmed: AiSuggestion;
}

// ─── Phase D7: Content Data Platform ────────────────────────

/**
 * 智能 Feed 项 — 聚合 product + brand + release + price + score
 */
export interface ContentFeedItem {
  id: string;
  feedType: string;           // 'product' | 'release'
  entityId: string;           // product_id
  title: string;              // 商品名
  subtitle: string;           // 品牌名
  coverUrl: string;
  secondaryCoverUrl: string;
  brandId: string;
  brandName: string;
  category: string;           // JK | LOLITA | HANFU | OTHER
  pitType: string;            // 主要品类标签
  price: number;              // 当前价格（分）
  originalPrice: number;
  priceSummary: string;       // 价格摘要 e.g. "¥368.00"
  saleStatus: string;         // UPCOMING / ON_SALE / PRE_ORDER / SOLD_OUT / ENDED
  releaseType: string;        // first_release / rerelease / reservation / spot / lottery / unknown
  releaseTypeName: string;    // 首发 / 再贩 / 预约 / 现货 / 抽选 / 未知
  tags: string[];             // season + scene + element + recommended
  feedScore: number;          // 0-100
  feedReason: string;         // 推荐理由 e.g. "热门品牌新品"
  eventStartAt: string;
  eventEndAt: string;
  liked: boolean;
  saved: boolean;
  sourceLabel: string;
  publishedAt: string;        // product created_at 或 release start_at
  createdAt: string;
}

/**
 * 搜索查询
 */
export interface SearchQuery {
  q: string;                  // 关键词
  category: string;           // JK | LOLITA | HANFU | OTHER | ''
  saleStatus: string;         // UPCOMING / ON_SALE / PRE_ORDER / SOLD_OUT / ENDED | ''
  releaseStatus: string;      // first_release / rerelease | ''
  brandId: string;            // 品牌ID过滤
  minPrice: number;           // 最低价格（分），0=不限
  maxPrice: number;           // 最高价格（分），0=不限
  cursor: string;
  limit: number;
}

export interface SearchResult {
  items: ContentFeedItem[];
  nextCursor: string;
  hasMore: boolean;
  totalHint: number;
}

/**
 * 趋势数据
 */
export interface BrandTrend {
  brandId: string;
  brandName: string;
  period: string;             // '7d' | '30d' | '90d'
  newProductCount: number;
  rereleaseCount: number;
  avgPriceCents: number;
  priceChangePercent: number; // 价格变化百分比
  heatScore: number;
  productCount: number;
}

export interface ProductTrend {
  productId: string;
  productName: string;
  brandName: string;
  category: string;
  period: string;
  priceChange: number;        // 价格变化（分）
  priceChangePercent: number;
  feedScoreChange: number;    // 热度变化
  saleStatusChanged: boolean;
  currentSaleStatus: string;
  previousSaleStatus: string;
}

export interface TrendSummary {
  brandTrends: BrandTrend[];
  productTrends: ProductTrend[];
  generatedAt: string;
}
