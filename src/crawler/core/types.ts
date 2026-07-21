// crawler/core/types.ts — 采集框架核心类型

// ============================================================
// 1. 网络层
// ============================================================

export interface FetchResult {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  fetchedAt: Date;
  durationMs: number;
}

// ============================================================
// 2. 领域层 — 原始采集项（RawCrawlItem）
//    描述从外部数据源获取的原始数据，未解析
// ============================================================

export interface RawCrawlItem {
  /** 数据来源平台标识，如 OFFICIAL / WEIBO / WECHAT_MP */
  sourcePlatform: string;
  /** 原始 URL */
  sourceUrl: string;
  /** 外部平台唯一 ID */
  externalId: string;
  /** 原始标题（未清洗） */
  rawTitle: string;
  /** 原始描述（未清洗） */
  rawDescription: string;
  /** 原始价格文本（如 "¥128-168" / "定金100尾款268"） */
  rawPriceText: string;
  /** 原始日期文本（如 "2025年1月15日" / "3天后"） */
  rawDateText: string;
  /** 原始图片 URL 列表 */
  rawImageUrls: string[];
  /** 原始数据负载（HTML/JSON 片段） */
  rawPayload: unknown;
  /** 采集时间 */
  fetchedAt: Date;
  /** 解析器版本 */
  parserVersion: string;
}

// ============================================================
// 3. 领域层 — 标准化商品候选（NormalizedProductCandidate）
//    经过解析、清洗、标准化后的商品数据，等待验证和入库
// ============================================================

export interface NormalizedProductCandidate {
  /** 商品标准化名称 */
  name: string;
  /** 品牌名称 */
  brand: string;
  /** 坑向：JK / LOLITA / HANFU / OTHER */
  pitType: 'JK' | 'LOLITA' | 'HANFU' | 'OTHER';
  /** 细分类目 */
  category: string;
  /** 销售状态 */
  saleStatus: 'UPCOMING' | 'ON_SALE' | 'PRE_ORDER' | 'SOLD_OUT' | 'ENDED';
  /** 当前价格（分） */
  currentPrice: number;
  /** 原价（分） */
  originalPrice: number;
  /** 定金（分） */
  depositPrice: number;
  /** 尾款（分） */
  balancePrice: number;
  /** 预售开始时间 */
  preorderStartAt: Date | null;
  /** 预售结束时间 */
  preorderEndAt: Date | null;
  /** 图片 URL 列表 */
  imageUrls: string[];
  /** 来源 URL */
  sourceUrl: string;
  /** 置信度 0-100 */
  confidence: number;
  /** 校验错误列表（空 = 通过校验） */
  validationErrors: ValidationError[];
}

// ============================================================
// 4. 解析层 — ParsedItem（兼容旧接口）
// ============================================================

export interface ParsedItem {
  sourceUrl: string;
  externalId: string;
  canonicalName: string;
  displayName: string;
  brandName: string;
  category: string;
  subCategory: string;
  pitType: 'JK' | 'LOLITA' | 'HANFU' | 'OTHER';
  currentPrice: number;
  originalPrice: number;
  depositPrice: number;
  balancePrice: number;
  currency: string;
  saleStatus: string;
  description: string;
  rawDescription: string;
  coverUrl: string;
  images: string[];
  sourcePublishedAt: string | null;
  shopUrl: string;
  tags: string[];
}

// ============================================================
// 5. 标准化层 — NormalizedItem（兼容旧接口）
// ============================================================

export interface NormalizedItem extends ParsedItem {
  canonicalName: string;
  normalizedBrandName: string;
  confidence: number;
}

// ============================================================
// 6. 校验层
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

// ============================================================
// 7. 去重层
// ============================================================

export interface DedupResult {
  action: 'insert' | 'update' | 'skip_dedup' | 'skip_review';
  existingId: string | null;
  reason: string;
}

// ============================================================
// 8. 采集管道配置与统计
// ============================================================

export interface CrawlJobConfig {
  sourceType: string;
  sourceUrl: string;
  parserVersion: string;
  trigger: 'manual' | 'scheduled' | 'retry';
  maxRetries: number;
  retryDelayMs: number;
  requestTimeoutMs: number;
  rateLimitMs: number;
  userAgent: string;
  dryRun: boolean;
}

export interface CrawlJobStats {
  jobId: string;
  sourceType: string;
  sourceUrl: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'pending' | 'running' | 'success' | 'failed';
  fetchedCount: number;
  parsedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: string[];
}

// ============================================================
// 9. 接口契约
// ============================================================

export interface SourceAdapter {
  readonly sourceType: string;
  readonly name: string;
  fetchList(url: string): Promise<FetchResult[]>;
  fetchDetail(url: string): Promise<FetchResult>;
  canHandle(url: string): boolean;
}

export interface Parser {
  parseList(result: FetchResult): ParsedItem[];
  parseDetail(result: FetchResult): ParsedItem | null;
}

export interface Normalizer {
  normalize(item: ParsedItem): NormalizedItem;
}

export interface Validator {
  validate(item: NormalizedItem): ValidationResult;
}

export interface Deduplicator {
  load(products: { id: string; brandId: string; canonicalName: string; sourceUrl: string }[]): void;
  check(item: NormalizedItem): Promise<DedupResult>;
}
