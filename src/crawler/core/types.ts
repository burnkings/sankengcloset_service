// crawler/core/types.ts — 采集框架核心类型

export interface FetchResult {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  fetchedAt: Date;
  durationMs: number;
}

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

export interface NormalizedItem extends ParsedItem {
  canonicalName: string;
  normalizedBrandName: string;
  confidence: number;
}

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

export interface DedupResult {
  action: 'insert' | 'update' | 'skip_dedup' | 'skip_review';
  existingId: string | null;
  reason: string;
}

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
