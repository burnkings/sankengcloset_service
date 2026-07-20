// Phase D1: 采集系统 Repository 接口
// 与 src/types/crawler.ts 对齐

import type {
  Brand, BrandInput,
  Product, ProductInput,
  ProductVariant, ProductVariantInput,
  ProductImage,
  SourceRecord, SourceRecordInput,
  RawData, RawDataInput,
  PriceSnapshot, PriceSnapshotInput,
  SaleEvent, SaleEventInput,
  Tag, TagInput, ProductTag,
  CrawlJob, CrawlJobInput,
  CrawlRecord, CrawlRecordInput,
  ReviewRecord,
  DataSource, PitType, ReviewStatus, CrawlStatus,
} from '../types/crawler.js';


// ============================================================
// Brand 操作
// ============================================================

export interface BrandRepository {
  getById(id: string): Promise<Brand | null>;
  getByName(name: string): Promise<Brand | null>;
  list(filter: { pitType?: PitType; reviewStatus?: ReviewStatus; limit?: number; offset?: number }): Promise<Brand[]>;
  create(input: BrandInput): Promise<Brand>;
  update(id: string, patch: Partial<BrandInput>): Promise<Brand>;
  softDelete(id: string): Promise<void>;
  count(): Promise<number>;
}


// ============================================================
// Product 操作
// ============================================================

export interface ProductRepository {
  getById(id: string): Promise<Product | null>;
  getByDedupKey(brandId: string, canonicalName: string): Promise<Product | null>;
  getByPlatformExternal(platform: DataSource, externalId: string): Promise<Product | null>;
  list(filter: {
    pitType?: PitType;
    saleStatus?: string;
    reviewStatus?: ReviewStatus;
    brandId?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'created_at' | 'updated_at' | 'current_price' | 'first_seen_at';
    orderDir?: 'asc' | 'desc';
  }): Promise<Product[]>;
  create(input: ProductInput): Promise<Product>;
  update(id: string, patch: Partial<ProductInput>): Promise<Product>;
  softDelete(id: string): Promise<void>;
  count(filter?: { pitType?: PitType; reviewStatus?: ReviewStatus }): Promise<number>;
  touch(id: string): Promise<void>;  // 更新 last_seen_at
}


// ============================================================
// ProductVariant 操作
// ============================================================

export interface ProductVariantRepository {
  getByProductId(productId: string): Promise<ProductVariant[]>;
  create(input: ProductVariantInput): Promise<ProductVariant>;
  update(id: string, patch: Partial<ProductVariantInput>): Promise<ProductVariant>;
  deleteByProductId(productId: string): Promise<void>;
}


// ============================================================
// ProductImage 操作
// ============================================================

export interface ProductImageRepository {
  getByProductId(productId: string): Promise<ProductImage[]>;
  create(input: Omit<ProductImage, 'id' | 'createdAt'>): Promise<ProductImage>;
  deleteByProductId(productId: string): Promise<void>;
}


// ============================================================
// SourceRecord 操作
// ============================================================

export interface SourceRecordRepository {
  getById(id: string): Promise<SourceRecord | null>;
  getByEntity(entityType: string, entityId: string): Promise<SourceRecord[]>;
  getBySourceUrl(sourceUrl: string): Promise<SourceRecord | null>;
  create(input: SourceRecordInput): Promise<SourceRecord>;
  updateReview(id: string, reviewStatus: ReviewStatus, reviewerId?: string): Promise<void>;
}


// ============================================================
// RawData 操作
// ============================================================

export interface RawDataRepository {
  getById(id: string): Promise<RawData | null>;
  create(input: RawDataInput): Promise<RawData>;
  deleteBySourceRecord(sourceRecordId: string): Promise<void>;
}


// ============================================================
// PriceSnapshot 操作
// ============================================================

export interface PriceSnapshotRepository {
  getLatest(productId: string): Promise<PriceSnapshot | null>;
  getHistory(productId: string, limit?: number): Promise<PriceSnapshot[]>;
  create(input: PriceSnapshotInput): Promise<PriceSnapshot>;
}


// ============================================================
// SaleEvent 操作
// ============================================================

export interface SaleEventRepository {
  getById(id: string): Promise<SaleEvent | null>;
  getByProductId(productId: string): Promise<SaleEvent[]>;
  listUpcoming(filter?: { pitType?: PitType; limit?: number }): Promise<SaleEvent[]>;
  create(input: SaleEventInput): Promise<SaleEvent>;
  update(id: string, patch: Partial<SaleEventInput>): Promise<SaleEvent>;
}


// ============================================================
// Tag 操作
// ============================================================

export interface TagRepository {
  getById(id: string): Promise<Tag | null>;
  getByName(name: string): Promise<Tag | null>;
  list(): Promise<Tag[]>;
  create(input: TagInput): Promise<Tag>;
  attachToProduct(productId: string, tagId: string): Promise<void>;
  detachFromProduct(productId: string, tagId: string): Promise<void>;
  getTagsByProductId(productId: string): Promise<Tag[]>;
}


// ============================================================
// CrawlJob 操作
// ============================================================

export interface CrawlJobRepository {
  getById(id: string): Promise<CrawlJob | null>;
  create(input: CrawlJobInput): Promise<CrawlJob>;
  startJob(id: string): Promise<void>;
  finishJob(id: string, stats: { total: number; success: number; failed: number; skipped: number }): Promise<void>;
  failJob(id: string, errorMessage: string): Promise<void>;
  listRecent(limit?: number): Promise<CrawlJob[]>;
}


// ============================================================
// CrawlRecord 操作
// ============================================================

export interface CrawlRecordRepository {
  getById(id: string): Promise<CrawlRecord | null>;
  create(input: CrawlRecordInput): Promise<CrawlRecord>;
  updateStatus(id: string, status: CrawlStatus, entityId?: string, errorMessage?: string): Promise<void>;
  listByJob(jobId: string): Promise<CrawlRecord[]>;
}


// ============================================================
// ReviewRecord 操作
// ============================================================

export interface ReviewRecordRepository {
  getByEntity(entityType: string, entityId: string): Promise<ReviewRecord[]>;
  create(input: Omit<ReviewRecord, 'id' | 'createdAt'>): Promise<ReviewRecord>;
}


// ============================================================
// 聚合 Repository（组合以上接口）
// ============================================================

/**
 * 聚合 Repository — 组合所有子 Repository 的方法签名
 * 不使用 extends 避免方法名冲突
 */
export interface CrawlerRepository {
  close(): Promise<void>;
  ready(): Promise<boolean>;

  // Brand
  getBrandById(id: string): Promise<Brand | null>;
  getBrandByName(name: string): Promise<Brand | null>;
  listBrands(filter: { pitType?: PitType; reviewStatus?: ReviewStatus; limit?: number; offset?: number }): Promise<Brand[]>;
  createBrand(input: BrandInput): Promise<Brand>;
  updateBrand(id: string, patch: Partial<BrandInput>): Promise<Brand>;
  deleteBrand(id: string): Promise<void>;
  countBrands(): Promise<number>;

  // Product
  getProductById(id: string): Promise<Product | null>;
  getProductByDedupKey(brandId: string, canonicalName: string): Promise<Product | null>;
  getProductByPlatformExternal(platform: DataSource, externalId: string): Promise<Product | null>;
  listProducts(filter: {
    pitType?: PitType; saleStatus?: string; reviewStatus?: ReviewStatus;
    brandId?: string; limit?: number; offset?: number;
    orderBy?: 'created_at' | 'updated_at' | 'current_price' | 'first_seen_at';
    orderDir?: 'asc' | 'desc';
  }): Promise<Product[]>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(id: string, patch: Partial<ProductInput>): Promise<Product>;
  deleteProduct(id: string): Promise<void>;
  countProducts(filter?: { pitType?: PitType; reviewStatus?: ReviewStatus }): Promise<number>;
  touchProduct(id: string): Promise<void>;

  // ProductVariant
  listVariantsByProductId(productId: string): Promise<ProductVariant[]>;
  createVariant(input: ProductVariantInput): Promise<ProductVariant>;
  updateVariant(id: string, patch: Partial<ProductVariantInput>): Promise<ProductVariant>;
  deleteVariantsByProductId(productId: string): Promise<void>;

  // ProductImage
  listImagesByProductId(productId: string): Promise<ProductImage[]>;
  createImage(input: Omit<ProductImage, 'id' | 'createdAt'>): Promise<ProductImage>;
  deleteImagesByProductId(productId: string): Promise<void>;

  // SourceRecord
  getSourceRecordById(id: string): Promise<SourceRecord | null>;
  getSourceRecordsByEntity(entityType: string, entityId: string): Promise<SourceRecord[]>;
  getSourceRecordByUrl(sourceUrl: string): Promise<SourceRecord | null>;
  createSourceRecord(input: SourceRecordInput): Promise<SourceRecord>;
  updateSourceRecordReview(id: string, reviewStatus: ReviewStatus, reviewerId?: string): Promise<void>;

  // RawData
  getRawDataById(id: string): Promise<RawData | null>;
  createRawData(input: RawDataInput): Promise<RawData>;
  deleteRawDataBySourceRecord(sourceRecordId: string): Promise<void>;

  // PriceSnapshot
  getLatestPrice(productId: string): Promise<PriceSnapshot | null>;
  getPriceHistory(productId: string, limit?: number): Promise<PriceSnapshot[]>;
  createPriceSnapshot(input: PriceSnapshotInput): Promise<PriceSnapshot>;

  // SaleEvent
  getSaleEventById(id: string): Promise<SaleEvent | null>;
  getSaleEventsByProductId(productId: string): Promise<SaleEvent[]>;
  listUpcomingEvents(filter?: { pitType?: PitType; limit?: number }): Promise<SaleEvent[]>;
  createSaleEvent(input: SaleEventInput): Promise<SaleEvent>;
  updateSaleEvent(id: string, patch: Partial<SaleEventInput>): Promise<SaleEvent>;

  // Tag
  getTagById(id: string): Promise<Tag | null>;
  getTagByName(name: string): Promise<Tag | null>;
  listTags(): Promise<Tag[]>;
  createTag(input: TagInput): Promise<Tag>;
  attachTagToProduct(productId: string, tagId: string): Promise<void>;
  detachTagFromProduct(productId: string, tagId: string): Promise<void>;
  getTagsByProductId(productId: string): Promise<Tag[]>;

  // CrawlJob
  getCrawlJobById(id: string): Promise<CrawlJob | null>;
  createCrawlJob(input: CrawlJobInput): Promise<CrawlJob>;
  startCrawlJob(id: string): Promise<void>;
  finishCrawlJob(id: string, stats: { total: number; success: number; failed: number; skipped: number }): Promise<void>;
  failCrawlJob(id: string, errorMessage: string): Promise<void>;
  listRecentCrawlJobs(limit?: number): Promise<CrawlJob[]>;

  // CrawlRecord
  getCrawlRecordById(id: string): Promise<CrawlRecord | null>;
  createCrawlRecord(input: CrawlRecordInput): Promise<CrawlRecord>;
  updateCrawlRecordStatus(id: string, status: CrawlStatus, entityId?: string, errorMessage?: string): Promise<void>;
  listCrawlRecordsByJob(jobId: string): Promise<CrawlRecord[]>;

  // ReviewRecord
  getReviewRecordsByEntity(entityType: string, entityId: string): Promise<ReviewRecord[]>;
  createReviewRecord(input: Omit<ReviewRecord, 'id' | 'createdAt'>): Promise<ReviewRecord>;
}
