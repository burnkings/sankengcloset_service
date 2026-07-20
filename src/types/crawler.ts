// Phase D1: 商品数据模型类型定义
// 与 migrations/0002_scrapers.sql 对齐

// ============================================================
// 枚举 / 常量
// ============================================================

/** 坑向 */
export const PIT_JK = 'JK';
export const PIT_LOLITA = 'LOLITA';
export const PIT_HANFU = 'HANFU';
export const PIT_OTHER = 'OTHER';
export type PitType = typeof PIT_JK | typeof PIT_LOLITA | typeof PIT_HANFU | typeof PIT_OTHER;
export const PIT_TYPES: PitType[] = [PIT_JK, PIT_LOLITA, PIT_HANFU, PIT_OTHER];

/** 销售状态 */
export const SALE_UPCOMING = 'UPCOMING';
export const SALE_ON_SALE = 'ON_SALE';
export const SALE_PRE_ORDER = 'PRE_ORDER';
export const SALE_SOLD_OUT = 'SOLD_OUT';
export const SALE_ENDED = 'ENDED';
export type SaleStatus = typeof SALE_UPCOMING | typeof SALE_ON_SALE | typeof SALE_PRE_ORDER | typeof SALE_SOLD_OUT | typeof SALE_ENDED;
export const SALE_STATUSES: SaleStatus[] = [SALE_UPCOMING, SALE_ON_SALE, SALE_PRE_ORDER, SALE_SOLD_OUT, SALE_ENDED];

/** 数据来源平台 */
export const SRC_OFFICIAL = 'OFFICIAL';
export const SRC_TAOBAO = 'TAOBAO';
export const SRC_TMALL = 'TMALL';
export const SRC_WEIBO = 'WEIBO';
export const SRC_XIAOHONGSHU = 'XIAOHONGSHU';
export const SRC_WECHAT_MP = 'WECHAT_MP';
export const SRC_BILIBILI = 'BILIBILI';
export const SRC_USER_SUBMIT = 'USER_SUBMIT';
export const SRC_ADMIN = 'ADMIN';
export const SRC_AI_EXTRACT = 'AI_EXTRACT';
export type DataSource = typeof SRC_OFFICIAL | typeof SRC_TAOBAO | typeof SRC_TMALL | typeof SRC_WEIBO | typeof SRC_XIAOHONGSHU | typeof SRC_WECHAT_MP | typeof SRC_BILIBILI | typeof SRC_USER_SUBMIT | typeof SRC_ADMIN | typeof SRC_AI_EXTRACT;
export const DATA_SOURCES: DataSource[] = [SRC_OFFICIAL, SRC_TAOBAO, SRC_TMALL, SRC_WEIBO, SRC_XIAOHONGSHU, SRC_WECHAT_MP, SRC_BILIBILI, SRC_USER_SUBMIT, SRC_ADMIN, SRC_AI_EXTRACT];

/** 数据状态 */
export const DSTATUS_FRESH = 'FRESH';
export const DSTATUS_STALE = 'STALE';
export const DSTATUS_DELETED = 'DELETED';
export const DSTATUS_ARCHIVED = 'ARCHIVED';
export type DataStatus = typeof DSTATUS_FRESH | typeof DSTATUS_STALE | typeof DSTATUS_DELETED | typeof DSTATUS_ARCHIVED;

/** 审核状态 */
export const RVIEW_PENDING = 'PENDING';
export const RVIEW_APPROVED = 'APPROVED';
export const RVIEW_REJECTED = 'REJECTED';
export const RVIEW_CORRECTED = 'CORRECTED';
export type ReviewStatus = typeof RVIEW_PENDING | typeof RVIEW_APPROVED | typeof RVIEW_REJECTED | typeof RVIEW_CORRECTED;

/** 采集任务状态 */
export const CRAWL_PENDING = 'PENDING';
export const CRAWL_RUNNING = 'RUNNING';
export const CRAWL_SUCCESS = 'SUCCESS';
export const CRAWL_FAILED = 'FAILED';
export const CRAWL_SKIPPED = 'SKIPPED';
export type CrawlStatus = typeof CRAWL_PENDING | typeof CRAWL_RUNNING | typeof CRAWL_SUCCESS | typeof CRAWL_FAILED | typeof CRAWL_SKIPPED;

/** 发售事件类型 */
export const EVT_PREVIEW = 'PREVIEW';
export const EVT_RESERVATION = 'RESERVATION';
export const EVT_DEPOSIT = 'DEPOSIT';
export const EVT_FINAL_PAYMENT = 'FINAL_PAYMENT';
export const EVT_RELEASE = 'RELEASE';
export const EVT_RESTOCK = 'RESTOCK';
export const EVT_PRICE_DROP = 'PRICE_DROP';
export type SaleEventType = typeof EVT_PREVIEW | typeof EVT_RESERVATION | typeof EVT_DEPOSIT | typeof EVT_FINAL_PAYMENT | typeof EVT_RELEASE | typeof EVT_RESTOCK | typeof EVT_PRICE_DROP;

/** 发售事件状态 */
export const EVT_UPCOMING = 'UPCOMING';
export const EVT_ACTIVE = 'ACTIVE';
export const EVT_ENDED = 'ENDED';
export const EVT_CANCELLED = 'CANCELLED';
export type SaleEventStatus = typeof EVT_UPCOMING | typeof EVT_ACTIVE | typeof EVT_ENDED | typeof EVT_CANCELLED;

/** 变体库存状态 */
export const STOCK_IN = 'IN_STOCK';
export const STOCK_LOW = 'LOW_STOCK';
export const STOCK_OUT = 'OUT_OF_STOCK';
export const STOCK_PRE = 'PRE_ORDER';
export type StockStatus = typeof STOCK_IN | typeof STOCK_LOW | typeof STOCK_OUT | typeof STOCK_PRE;

/** 标签类别 */
export const TAG_STYLE = 'style';
export const TAG_COLOR = 'color';
export const TAG_MATERIAL = 'material';
export const TAG_OCCASION = 'occasion';
export const TAG_CUSTOM = 'custom';
export type TagCategory = typeof TAG_STYLE | typeof TAG_COLOR | typeof TAG_MATERIAL | typeof TAG_OCCASION | typeof TAG_CUSTOM;

/** 内容类型 */
export const RAW_HTML = 'text/html';
export const RAW_JSON = 'application/json';
export const RAW_XML = 'text/xml';
export type RawContentType = typeof RAW_HTML | typeof RAW_JSON | typeof RAW_XML;


// ============================================================
// 实体类型
// ============================================================

export interface Brand {
  id: string;
  name: string;
  nameEn: string;
  category: PitType;
  logoUrl: string;
  description: string;
  officialUrl: string;
  sourceUrl: string;
  sourcePlatform: DataSource;
  followerCount: number;
  dataStatus: DataStatus;
  reviewStatus: ReviewStatus;
  confidence: number;
  fetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Product {
  id: string;
  canonicalName: string;
  displayName: string;
  brandId: string;
  shopId: string | null;
  pitType: PitType;
  category: string;
  subCategory: string;
  styleTags: string[];
  colorTags: string[];
  materialTags: string[];
  saleStatus: SaleStatus;
  currentPrice: number;      // 分
  originalPrice: number;     // 分
  depositPrice: number;      // 分
  balancePrice: number;      // 分
  currency: string;

  // 发售时间
  preorderStartAt: string | null;
  preorderEndAt: string | null;
  balanceStartAt: string | null;
  balanceEndAt: string | null;
  releaseAt: string | null;

  // 来源
  sourceUrl: string;
  sourcePlatform: DataSource;
  externalId: string;
  coverUrl: string;
  images: string[];
  description: string;
  rawDescription: string;
  sourcePublishedAt: string | null;

  // 采集元数据
  firstSeenAt: string;
  lastSeenAt: string;
  collectedAt: string;
  dataStatus: DataStatus;
  reviewStatus: ReviewStatus;
  confidence: number;

  // 统计
  viewCount: number;
  favoriteCount: number;

  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string;
  color: string;
  size: string;
  priceCents: number;
  stockStatus: StockStatus;
  stockCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  objectKey: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  sortOrder: number;
  isCover: boolean;
  sourceUrl: string;
  phash: string;
  createdAt: string;
}

export interface SourceRecord {
  id: string;
  sourceType: DataSource;
  sourceName: string;
  sourceUrl: string;
  originalId: string;
  rawDataId: string | null;
  entityType: string;
  entityId: string;
  fetchedAt: string;
  publishedAt: string | null;
  parserVersion: string;
  reviewStatus: ReviewStatus;
  confidence: number;
  humanModified: boolean;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface RawData {
  id: string;
  sourceRecordId: string | null;
  sourceType: DataSource;
  sourceUrl: string;
  contentType: RawContentType;
  rawContent: string;
  parsedJson: Record<string, unknown>;
  httpStatus: number | null;
  httpHeaders: Record<string, unknown>;
  fetchedAt: string;
  createdAt: string;
}

export interface PriceSnapshot {
  id: string;
  productId: string;
  priceCents: number;
  originalPriceCents: number;
  depositCents: number;
  balanceCents: number;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  createdAt: string;
}

export interface SaleEvent {
  id: string;
  productId: string;
  eventType: SaleEventType;
  title: string;
  description: string;
  startAt: string | null;
  endAt: string | null;
  depositAmount: number;
  balanceAmount: number;
  status: SaleEventStatus;
  sourceId: string | null;
  dataStatus: DataStatus;
  reviewStatus: ReviewStatus;
  confidence: number;
  fetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  category: TagCategory;
  createdAt: string;
}

export interface ProductTag {
  productId: string;
  tagId: string;
}

export interface CrawlJob {
  id: string;
  sourceType: DataSource;
  sourceUrl: string;
  status: CrawlStatus;
  startedAt: string | null;
  finishedAt: string | null;
  itemsTotal: number;
  itemsSuccess: number;
  itemsFailed: number;
  itemsSkipped: number;
  errorMessage: string | null;
  parserVersion: string;
  trigger: string;
  createdAt: string;
}

export interface CrawlRecord {
  id: string;
  jobId: string;
  sourceType: DataSource;
  sourceUrl: string;
  externalId: string;
  status: CrawlStatus;
  entityType: string | null;
  entityId: string | null;
  dedupAction: string;
  errorMessage: string | null;
  fetchedAt: string | null;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  fieldChanges: Record<string, unknown>;
  reviewerId: string | null;
  reason: string;
  createdAt: string;
}


// ============================================================
// 输入类型
// ============================================================

export interface BrandInput {
  name: string;
  nameEn?: string;
  category: PitType;
  logoUrl?: string;
  description?: string;
  officialUrl?: string;
  sourceUrl?: string;
  sourcePlatform?: DataSource;
}

export interface ProductInput {
  canonicalName: string;
  displayName: string;
  brandId: string;
  shopId?: string | null;
  pitType: PitType;
  category?: string;
  subCategory?: string;
  styleTags?: string[];
  colorTags?: string[];
  materialTags?: string[];
  saleStatus?: SaleStatus;
  currentPrice: number;
  originalPrice?: number;
  depositPrice?: number;
  balancePrice?: number;
  currency?: string;
  preorderStartAt?: string | null;
  preorderEndAt?: string | null;
  balanceStartAt?: string | null;
  balanceEndAt?: string | null;
  releaseAt?: string | null;
  sourceUrl: string;
  sourcePlatform: DataSource;
  externalId?: string;
  coverUrl?: string;
  images?: string[];
  description?: string;
  rawDescription?: string;
  sourcePublishedAt?: string | null;
  confidence?: number;
}

export interface PriceSnapshotInput {
  productId: string;
  priceCents: number;
  originalPriceCents?: number;
  depositCents?: number;
  balanceCents?: number;
  source?: string;
  sourceUrl?: string;
}

export interface SaleEventInput {
  productId: string;
  eventType: SaleEventType;
  title?: string;
  description?: string;
  startAt?: string | null;
  endAt?: string | null;
  depositAmount?: number;
  balanceAmount?: number;
  sourceId?: string | null;
  confidence?: number;
}

export interface CrawlJobInput {
  sourceType: DataSource;
  sourceUrl?: string;
  parserVersion?: string;
  trigger?: string;
}

export interface CrawlRecordInput {
  jobId: string;
  sourceType: DataSource;
  sourceUrl: string;
  externalId?: string;
  entityType?: string;
  entityId?: string;
  dedupAction?: string;
  errorMessage?: string | null;
}


// ============================================================
// 输入类型（Repository 接口用，与 validators.ts 的 Zod schema 对齐）
// ============================================================

export interface ProductVariantInput {
  productId: string;
  name: string;
  sku?: string;
  color?: string;
  size?: string;
  priceCents: number;
  stockStatus?: StockStatus;
  stockCount?: number | null;
}

export interface SourceRecordInput {
  sourceType: DataSource;
  sourceName?: string;
  sourceUrl: string;
  originalId?: string;
  entityType: string;
  entityId: string;
  parserVersion?: string;
  confidence?: number;
}

export interface RawDataInput {
  sourceType: DataSource;
  sourceUrl: string;
  contentType?: RawContentType;
  rawContent: string;
  parsedJson?: Record<string, unknown>;
  httpStatus?: number | null;
  httpHeaders?: Record<string, unknown>;
}

export interface TagInput {
  name: string;
  category: TagCategory;
}
