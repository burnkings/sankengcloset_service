// Phase D1: Zod 校验规则
// 与 src/types/crawler.ts 和 migrations/0002_scrapers.sql 对齐

import { z } from 'zod';
import type {
  PitType, SaleStatus, DataSource, DataStatus, ReviewStatus,
  CrawlStatus, SaleEventType, SaleEventStatus, StockStatus, TagCategory,
} from '../types/crawler.js';

// ============================================================
// 枚举 Schema
// ============================================================

export const pitTypeSchema = z.enum(['JK', 'LOLITA', 'HANFU', 'OTHER']) as z.ZodType<PitType>;
export const saleStatusSchema = z.enum(['UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED']) as z.ZodType<SaleStatus>;
export const dataSourceSchema = z.enum([
  'OFFICIAL', 'TAOBAO', 'TMALL', 'WEIBO', 'XIAOHONGSHU',
  'WECHAT_MP', 'BILIBILI', 'USER_SUBMIT', 'ADMIN', 'AI_EXTRACT',
]) as z.ZodType<DataSource>;
export const dataStatusSchema = z.enum(['FRESH', 'STALE', 'DELETED', 'ARCHIVED']) as z.ZodType<DataStatus>;
export const reviewStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CORRECTED']) as z.ZodType<ReviewStatus>;
export const crawlStatusSchema = z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED']) as z.ZodType<CrawlStatus>;
export const saleEventTypeSchema = z.enum([
  'PREVIEW', 'RESERVATION', 'DEPOSIT', 'FINAL_PAYMENT',
  'RELEASE', 'RESTOCK', 'PRICE_DROP',
]) as z.ZodType<SaleEventType>;
export const saleEventStatusSchema = z.enum(['UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED']) as z.ZodType<SaleEventStatus>;
export const stockStatusSchema = z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'PRE_ORDER']) as z.ZodType<StockStatus>;
export const tagCategorySchema = z.enum(['style', 'color', 'material', 'occasion', 'custom']) as z.ZodType<TagCategory>;


// ============================================================
// 通用字段
// ============================================================

const idField = z.string().min(1).max(128);
const nameField = z.string().trim().min(1).max(200);
const urlField = z.string().url().max(2048).or(z.literal(''));
const priceCentsField = z.number().int().min(0).max(100_000_000);
const confidenceField = z.number().int().min(0).max(100);
const isoDateField = z.string().datetime().nullable();


// ============================================================
// Brand Schema
// ============================================================

export const brandInputSchema = z.object({
  name: nameField,
  nameEn: z.string().trim().max(200).default(''),
  category: pitTypeSchema,
  logoUrl: urlField.default(''),
  description: z.string().max(5000).default(''),
  officialUrl: urlField.default(''),
  sourceUrl: urlField.default(''),
  sourcePlatform: dataSourceSchema.default('ADMIN'),
  followerCount: z.number().int().min(0).default(0),
  confidence: confidenceField.default(100),
});

export type BrandInputValidated = z.infer<typeof brandInputSchema>;


// ============================================================
// Product Schema
// ============================================================

export const productInputSchema = z.object({
  canonicalName: z.string().trim().min(1).max(300),
  displayName: z.string().trim().min(1).max(300),
  brandId: idField,
  shopId: idField.nullable().optional(),
  pitType: pitTypeSchema,
  category: z.string().trim().max(100).default(''),
  subCategory: z.string().trim().max(100).default(''),
  styleTags: z.array(z.string().trim().max(50)).max(20).default([]),
  colorTags: z.array(z.string().trim().max(50)).max(20).default([]),
  materialTags: z.array(z.string().trim().max(50)).max(20).default([]),
  saleStatus: saleStatusSchema.default('UPCOMING'),
  currentPrice: priceCentsField,
  originalPrice: priceCentsField.default(0),
  depositPrice: priceCentsField.default(0),
  balancePrice: priceCentsField.default(0),
  currency: z.string().length(3).default('CNY'),
  preorderStartAt: isoDateField.optional(),
  preorderEndAt: isoDateField.optional(),
  balanceStartAt: isoDateField.optional(),
  balanceEndAt: isoDateField.optional(),
  releaseAt: isoDateField.optional(),
  sourceUrl: urlField.default(''),
  sourcePlatform: dataSourceSchema,
  externalId: z.string().max(256).default(''),
  coverUrl: urlField.default(''),
  images: z.array(urlField).max(50).default([]),
  description: z.string().max(10000).default(''),
  rawDescription: z.string().max(50000).default(''),
  sourcePublishedAt: isoDateField.optional(),
  confidence: confidenceField.default(100),
});

export type ProductInputValidated = z.infer<typeof productInputSchema>;


// ============================================================
// ProductVariant Schema
// ============================================================

export const productVariantInputSchema = z.object({
  productId: idField,
  name: nameField,
  sku: z.string().max(128).default(''),
  color: z.string().trim().max(100).default(''),
  size: z.string().trim().max(100).default(''),
  priceCents: priceCentsField,
  stockStatus: stockStatusSchema.default('IN_STOCK'),
  stockCount: z.number().int().min(0).nullable().optional(),
});

export type ProductVariantInputValidated = z.infer<typeof productVariantInputSchema>;


// ============================================================
// PriceSnapshot Schema
// ============================================================

export const priceSnapshotInputSchema = z.object({
  productId: idField,
  priceCents: priceCentsField,
  originalPriceCents: priceCentsField.default(0),
  depositCents: priceCentsField.default(0),
  balanceCents: priceCentsField.default(0),
  source: z.string().max(200).default(''),
  sourceUrl: urlField.default(''),
});

export type PriceSnapshotInputValidated = z.infer<typeof priceSnapshotInputSchema>;


// ============================================================
// SaleEvent Schema
// ============================================================

export const saleEventInputSchema = z.object({
  productId: idField,
  eventType: saleEventTypeSchema,
  title: z.string().trim().max(300).default(''),
  description: z.string().max(5000).default(''),
  startAt: isoDateField.optional(),
  endAt: isoDateField.optional(),
  depositAmount: priceCentsField.default(0),
  balanceAmount: priceCentsField.default(0),
  sourceId: idField.nullable().optional(),
  confidence: confidenceField.default(100),
});

export type SaleEventInputValidated = z.infer<typeof saleEventInputSchema>;


// ============================================================
// SourceRecord Schema
// ============================================================

export const sourceRecordInputSchema = z.object({
  sourceType: dataSourceSchema,
  sourceName: z.string().trim().max(200).default(''),
  sourceUrl: z.string().min(1).max(2048),
  originalId: z.string().max(256).default(''),
  entityType: z.string().min(1).max(50),
  entityId: z.string().min(1).max(128),
  parserVersion: z.string().max(50).default('v1'),
  confidence: confidenceField.default(100),
});

export type SourceRecordInputValidated = z.infer<typeof sourceRecordInputSchema>;


// ============================================================
// RawData Schema
// ============================================================

export const rawDataInputSchema = z.object({
  sourceType: dataSourceSchema,
  sourceUrl: z.string().min(1).max(2048),
  contentType: z.enum(['text/html', 'application/json', 'text/xml']).default('text/html'),
  rawContent: z.string().max(10_000_000),  // 10MB max
  parsedJson: z.record(z.string(), z.unknown()).default({}),
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  httpHeaders: z.record(z.string(), z.unknown()).default({}),
});

export type RawDataInputValidated = z.infer<typeof rawDataInputSchema>;


// ============================================================
// CrawlJob Schema
// ============================================================

export const crawlJobInputSchema = z.object({
  sourceType: dataSourceSchema,
  sourceUrl: urlField.default(''),
  parserVersion: z.string().max(50).default('v1'),
  trigger: z.enum(['manual', 'scheduled', 'retry']).default('manual'),
});

export type CrawlJobInputValidated = z.infer<typeof crawlJobInputSchema>;


// ============================================================
// CrawlRecord Schema
// ============================================================

export const crawlRecordInputSchema = z.object({
  jobId: idField,
  sourceType: dataSourceSchema,
  sourceUrl: z.string().min(1).max(2048),
  externalId: z.string().max(256).default(''),
  entityType: z.string().max(50).optional(),
  entityId: idField.optional(),
  dedupAction: z.enum(['insert', 'update', 'skip_dedup', 'skip_review']).default('insert'),
  errorMessage: z.string().max(5000).nullable().optional(),
});

export type CrawlRecordInputValidated = z.infer<typeof crawlRecordInputSchema>;


// ============================================================
// Tag Schema
// ============================================================

export const tagInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: tagCategorySchema,
});

export type TagInputValidated = z.infer<typeof tagInputSchema>;


// ============================================================
// 工具函数
// ============================================================

/**
 * 标准化商品名称：去首尾空格、多余空格合并
 * 用于 canonicalName 生成
 */
export function normalizeProductName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * 生成品牌+名称的去重键
 */
export function productDedupKey(brandId: string, canonicalName: string): string {
  return `${brandId}::${canonicalName.toLowerCase()}`;
}

/**
 * 生成平台+外部ID的去重键
 */
export function platformDedupKey(platform: DataSource, externalId: string): string {
  if (externalId === '') return '';
  return `${platform}::${externalId}`;
}
