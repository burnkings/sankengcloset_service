export type Category = 'JK' | 'LOLITA' | 'HANFU' | 'OTHER';

export interface UserProfile {
  id: string;
  nickname: string;
  avatarUrl: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

/** Product image object embedded in products.images JSONB */
export interface ProductImage {
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  objectKey: string | null;
}

/** Product variant object embedded in products.variants JSONB */
export interface ProductVariant {
  id: string;
  name: string;
  styleName: string;
  colorName: string;
  sizeName: string;
}

export interface Product {
  id: string;
  brandId: string;
  brandName: string;
  title: string;
  category: Category;
  subCategory: string;
  saleStatus: string;
  coverUrl: string;
  images: ProductImage[];
  priceCents: number | null;
  originalPriceCents: number | null;
  priceType: string;
  colorTags: string[];
  materialTags: string[];
  featureTags: string[];
  variants: ProductVariant[];
  description: string;
  shopName: string;
  canonicalUrl: string;
  sourcePlatform: string;
  externalId: string | null;
  groupKey: string | null;
  viewCount: number;
  feedScore: number;
  visibilityStatus: string;
  createdAt: string;
  updatedAt: string;
  /** 当前有效发售批次（product_releases 最新一条），详情页发售状态唯一事实源 */
  currentRelease: ProductRelease | null;
}

/**
 * 发售批次（product_releases 行）
 * 前端映射到已有 ReleaseEvent Domain，禁止复制数据模型。
 */
export interface ProductRelease {
  id: string;
  productId: string;
  releaseName: string;
  releaseNo: number;
  releaseType: string;
  saleStatus: string;
  depositCents: number | null;
  balanceCents: number | null;
  fullPriceCents: number | null;
  startAt: string | null;
  endAt: string | null;
  balanceDueAt: string | null;
  shipAt: string | null;
  shippingNote: string;
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
  price: number | null;
  originalPrice: number | null;
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

/**
 * 订单截图识别草稿（尾款一键入库）。
 * 仅作为可编辑草稿；低置信字段保持空，由用户确认页手动补全。
 * 金额一律整数分（xxxCents）。
 */
export interface AiSuggestion {
  name: string;
  brand: string;
  shopName: string;
  category: Category;
  orderNumber: string;
  orderDate: string;
  totalCents: number;
  depositCents: number;
  paidCents: number;
  balanceDueDate: string;
  arrivalDate: string;
  note: string;
}

export function emptyAiSuggestion(): AiSuggestion {
  return {
    name: '', brand: '', shopName: '', category: 'OTHER', orderNumber: '',
    orderDate: '', totalCents: 0, depositCents: 0, paidCents: 0,
    balanceDueDate: '', arrivalDate: '', note: '',
  };
}

export type AiTaskState = 'pending' | 'processing' | 'ready' | 'failed' | 'confirmed';

export interface AiImportTask {
  taskId: string;
  userId: string;
  objectKey: string;
  mediaId: string;
  taskType: string;
  sourcePlatform: string;
  sourceLink: string;
  state: AiTaskState;
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
  targetType: 'purchase' | null;
  targetId: string | null;
}

export interface AiConfirmationInput {
  opId?: string;
  targetType: 'purchase';
  targetId: string;
  confirmed: AiSuggestion;
}

// ─── Content Data Platform ────────────────────────────────

/**
 * 智能 Feed 项 — 聚合 product + brand + release + price + score
 */
export interface ContentFeedItem {
  id: string;
  feedType: string;
  entityId: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  secondaryCoverUrl: string;
  brandId: string;
  brandName: string;
  category: string;
  pitType: string;
  subCategory: string;
  priceType: string;
  depositCents: number | null;
  balanceCents: number | null;
  fullPriceCents: number | null;
  colorTags: string[];
  materialTags: string[];
  price: number | null;
  originalPrice: number | null;
  priceSummary: string;
  saleStatus: string;
  releaseType: string;
  releaseTypeName: string;
  tags: string[];
  feedScore: number;
  rankingScore: number;
  feedReason: string;
  badgeText: string;
  eventStartAt: string;
  eventEndAt: string;
  liked: boolean;
  saved: boolean;
  sourceLabel: string;
  publishedAt: string;
  createdAt: string;
}

/**
 * 搜索查询
 */
export interface SearchQuery {
  q: string;
  category: string;
  saleStatus: string;
  releaseStatus: string;
  brandId: string;
  minPrice: number;
  maxPrice: number;
  cursor: string;
  limit: number;
}

export interface SearchResult {
  items: ContentFeedItem[];
  nextCursor: string;
  hasMore: boolean;
  totalHint: number;
}

// ─── 发售日历（Calendar）──────────────────────────────────

/** 日历事件来源：product_releases only */
export interface CalendarEvent {
  id: string;
  title: string;
  brandName: string;
  brandId: string;
  category: string;
  eventType: string;
  startAt: string;
  endAt: string | null;
  priceCents: number | null;
  depositCents: number | null;
  balanceCents: number | null;
  productId: string;
  releaseId: string;
  status: string;
}

/**
 * 品牌信息（品牌目录）
 */
export interface BrandInfo {
  id: string;
  name: string;
  nameEn: string;
  logo: string;
  description: string;
  category: string;
  officialUrl: string;
  followerCount: number;
  isFollowed: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 品牌商品列表项
 */
export interface BrandProductItem {
  id: string;
  title: string;
  description: string;
  brandId: string;
  brandName: string;
  category: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  badgeText: string;
  coverUrl: string;
  createdAt: string;
}

/**
 * 三坑榜单条目
 */
export interface RankingItem {
  rank: number;
  entityId: string;
  title: string;
  brandName: string;
  coverUrl: string;
  priceCents: number | null;
  category: string;
  viewCount: number;
  favoriteCount: number;
  releaseTypeName: string;
  daysAgo: number;
  reservationCount: number;
}

export type RankingTab = 'hot' | 'new' | 'favorite';

/**
 * 个性化评分
 */
export interface PersonalScoreInput {
  userId: string;
  productId: string;
  brandId: string;
  category: string;
  tags: string[];
}

export interface PersonalScoreResult {
  personalScore: number;
  matchReason: string;
  breakdown: {
    tagMatch: number;
    brandMatch: number;
    categoryMatch: number;
  };
}

/**
 * 个性化 Feed 查询
 */
export interface PersonalizedFeedQuery {
  channel: string;
  category: string;
  cursor: string;
  limit: number;
  userId: string | null;
}

/** User interaction kind */
export type UserInteractionKind = 'PRODUCT_FAVORITE' | 'BRAND_FOLLOW' | 'POST_LIKE';

/** Intent status for product favorites */
export type IntentStatus = 'WANT' | 'WATCHING' | 'WAIT_RELEASE' | 'WAIT_BALANCE' | 'PURCHASED';


