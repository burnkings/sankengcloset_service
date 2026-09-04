export type Category = 'JK' | 'LOLITA' | 'HANFU' | 'OTHER';

export interface UserProfile {
  id: string;
  nickname: string;
  avatarUrl: string;
  status: 'active';
  createdAt: string;
}

export interface Product {
  id: string;
  brandId: string;
  brandName: string;
  title: string;
  category: Category;
  /** 细分类目（格裙/衬衫/JSK/OP/襦裙/马面…，DB products.category） */
  subCategory: string;
  status: string;
  coverUrl: string;
  images: string[];
  priceCents: number;
  originalPriceCents: number;
  /** 价格语义（Phase 2.5-D）：FULL/DEPOSIT/BALANCE/INTENTION/UNKNOWN，前端按此生成价格摘要，禁止猜测 */
  priceType: string;
  /** 定金（分，DB products.deposit_price） */
  depositCents: number;
  /** 尾款（分，DB products.balance_price） */
  balanceCents: number;
  /** 可选颜色（DB products.color_tags） */
  colorTags: string[];
  /** 材质标签（DB products.material_tags），前端汇总为 material_summary 展示 */
  materialTags: string[];
  /** 特点标签（season+scene+element+recommended 合并去重） */
  featureTags: string[];
  /** 规格变体（product_variants；未解析/无数据为空数组） */
  variants: ProductVariantDto[];
  description: string;
  shopUrl: string;
  createdAt: string;
  updatedAt: string;
  /** 所属款式（Phase 2.1：Brand → Style → Product → Release；未归并商品为 null） */
  styleId: string | null;
  /** 当前有效发售批次（product_releases 最新一条），详情页发售状态唯一事实源 */
  currentRelease: ProductRelease | null;
}

/** 规格变体 DTO（product_variants 行；空表/未解析时为 []，前端款式模块不显示） */
export interface ProductVariantDto {
  id: string;
  name: string;        // "粉色 S" / "蓝色 M"
  colorName: string;   // 粉色
  sizeName: string;    // S / M / L / 均码
  skuCode: string;
  priceCents: number;
  stockStatus: string; // IN_STOCK / LOW_STOCK / OUT_OF_STOCK / PRE_ORDER
}

/**
 * 三坑款式（Phase 2.1 Style Entity MVP）
 * Style ≠ Product：一个款式可对应多个商品（黑/酒红/再售版本），发售批次继续由 product_releases 负责。
 */
export interface Style {
  id: string;
  brandId: string;
  brandName: string;
  canonicalName: string;
  category: string;
  subCategory: string;
  styleTags: string[];
  description: string;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 款式详情：基础信息 + 关联商品（GET /api/v1/styles/:id） */
export interface StyleDetail extends Style {
  products: Product[];
}

/**
 * 发售批次（product_releases 行，仅详情展示所需字段）
 * 前端映射到已有 ReleaseEvent Domain，禁止复制数据模型。
 */
export interface ProductRelease {
  id: string;
  releaseName: string;            // 批次名（"一期首发"等）
  releaseType: string;            // first_release / rerelease / reservation / spot / lottery / unknown
  saleStatus: string;             // UPCOMING / ON_SALE / PRE_ORDER / SOLD_OUT / ENDED
  lifecycleStatus: string;        // upcoming / active / ended / sold_out / unknown
  isRerelease: boolean;
  depositCents: number;           // 定金（分）
  balanceCents: number;           // 尾款（分）
  fullPriceCents: number;         // 全价（分）
  startAt: string;                // 开售/预约开始（ISO）
  endAt: string;                  // 结束时间（ISO）
  balanceDueAt: string;           // 尾款截止（ISO）
  shipAt: string;                 // 预计发货（ISO）
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
  orderDate: string;        // YYYY-MM-DD
  totalCents: number;
  depositCents: number;
  paidCents: number;
  balanceDueDate: string;   // YYYY-MM-DD
  arrivalDate: string;      // YYYY-MM-DD
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
  taskType: string;          // purchase_order
  sourcePlatform: string;    // taobao | weidian | tuanzhang | other | ''
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
  targetType: 'purchase' | 'wardrobe' | 'wishlist' | null;
  targetId: string | null;
}

export interface AiConfirmationInput {
  opId?: string;
  targetType: 'purchase';
  targetId: string;          // 前端已创建的 purchase id（仅审计关联，不建单）
  confirmed: AiSuggestion;   // 用户最终确认后的订单字段
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
  /** 细分类目（格裙/衬衫/JSK/OP/襦裙/马面…，DB products.category；与 pitType 不同维度） */
  subCategory: string;
  /** 价格语义（Product V2）：FULL/DEPOSIT/BALANCE/INTENTION/UNKNOWN，前端按此生成价格摘要，禁止猜测 */
  priceType: string;
  /** 定金（分，DB products.deposit_price） */
  depositCents: number;
  /** 尾款（分，DB products.balance_price） */
  balanceCents: number;
  /** 全款/现货价（分，来源 product_releases.full_price_cents；DEPOSIT 摘要「定金 ¥X · 全款 ¥Y」用） */
  fullPriceCents: number;
  /** 可选颜色（Product V2 colors） */
  colorTags: string[];
  /** 材质标签（Product V2 material_tags，前端汇总为 material_summary 展示） */
  materialTags: string[];
  price: number;              // 当前价格（分）
  originalPrice: number;
  priceSummary: string;       // 价格摘要 e.g. "¥368.00"
  saleStatus: string;         // UPCOMING / ON_SALE / PRE_ORDER / SOLD_OUT / ENDED
  releaseType: string;        // first_release / rerelease / reservation / spot / lottery / unknown
  releaseTypeName: string;    // 首发 / 再贩 / 预约 / 现货 / 抽选 / 未知
  tags: string[];             // season + scene + element + recommended
  feedScore: number;          // 0-100
  rankingScore: number;       // 排序分数，等同 feedScore（前端 FeedItem 协议）
  feedReason: string;         // 推荐理由 e.g. "热门品牌新品"
  badgeText: string;          // 角标文字 '新品' / '预约' / '降价' / ''（前端 FeedItem 协议）
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

// ─── 发售日历（Calendar）──────────────────────────────────

/** 日历事件来源：product_releases 或 sale_events */
export interface CalendarEvent {
  id: string;
  title: string;
  brandName: string;
  brandId: string;
  category: string;          // JK / LOLITA / HANFU / OTHER
  eventType: string;         // release_type（first_release/rerelease/reservation/spot/lottery）或 sale_events.event_type
  startAt: string;           // ISO
  endAt: string | null;
  priceCents: number;
  depositCents: number;
  balanceCents: number;
  productId: string;
  status: string;            // sale_status / lifecycle_status
  source: 'release' | 'sale_event';
}

// ─── Phase D8: User Interaction & Personalization ──────────

/**
 * 用户行为事件
 */
export type UserEventType =
  | 'VIEW_PRODUCT' | 'VIEW_RELEASE' | 'LIKE_PRODUCT' | 'SAVE_PRODUCT'
  | 'FOLLOW_BRAND' | 'SEARCH' | 'SHARE' | 'CLICK_PRICE_ALERT' | 'CLICK_BUY';

export interface UserEvent {
  id: string;
  userId: string | null;     // null = 匿名
  eventType: UserEventType;
  targetType: string;        // product / release / brand / search
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateUserEventInput {
  eventType: UserEventType;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * 收藏项（升级版）
 */
export type WishlistStatus = 'WISH' | 'WANT' | 'WATCHING' | 'WAIT_RELEASE' | 'WAIT_PRICE' | 'PURCHASED';

export interface WishlistItem {
  id: string;
  userId: string;
  title: string;
  status: WishlistStatus;
  productId: string | null;
  releaseId: string | null;
  note: string;
  payloadJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWishlistInput {
  title: string;
  status: WishlistStatus;
  productId?: string | null;
  releaseId?: string | null;
  note?: string;
}

/**
 * 品牌关注
 */
export interface BrandFollower {
  userId: string;
  brandId: string;
  createdAt: string;
}

/**
 * 品牌信息（Phase 2.6 品牌目录：/api/v1/brands 列表 + /api/v1/brands/:id 详情）
 */
export interface BrandInfo {
  id: string;
  name: string;
  nameEn: string;
  logo: string;
  description: string;
  category: string;           // JK / LOLITA / HANFU / OTHER
  officialUrl: string;
  followerCount: number;
  isFollowed: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 品牌商品列表项（/api/v1/brands/:id/products；复用 ContentFeedItem 展示字段，前端 FeedItem 协议兼容）
 */
export interface BrandProductItem {
  id: string;
  title: string;
  description: string;
  brandId: string;
  brandName: string;
  category: string;
  priceCents: number;
  originalPriceCents: number;
  badgeText: string;
  coverUrl: string;
  createdAt: string;
}

/**
 * 三坑榜单条目（/api/v1/ranking；hot/new 两榜共用）
 */
export interface RankingItem {
  rank: number;
  entityId: string;           // 商品 id（点击跳详情）
  title: string;
  brandName: string;
  coverUrl: string;
  priceCents: number;
  category: string;           // JK / Lolita / 汉服
  // 热榜
  favoriteCount: number;
  // 上新榜
  releaseTypeName: string;    // 首发 / 再贩 / 现货
  daysAgo: number;            // 「X 天前上新」
  reservationCount: number;   // 「X 人蹲预约」
}

export type RankingTab = 'hot' | 'new';

/**
 * 个性化评分
 */
export interface PersonalScoreInput {
  userId: string;
  productId: string;
  brandId: string;
  category: string;          // JK / LOLITA / HANFU / OTHER
  tags: string[];
}

export interface PersonalScoreResult {
  personalScore: number;     // 0-100
  matchReason: string;       // e.g. "因为你收藏过甜系Lolita"
  breakdown: {
    tagMatch: number;        // 标签匹配 0-40
    brandMatch: number;      // 品牌匹配 0-30
    categoryMatch: number;   // 品类匹配 0-30
  };
}

/**
 * 个性化 Feed 查询（扩展 FeedQuery）
 */
export interface PersonalizedFeedQuery {
  channel: string;
  category: string;
  cursor: string;
  limit: number;
  userId: string | null;     // null = 公共 Feed
}
