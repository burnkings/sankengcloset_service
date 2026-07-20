// crawler/cleaning/cleaning-pipeline.ts — 清洗管道编排

import type { ParsedItem, NormalizedItem } from '../core/types.js';
import { TextCleaner } from './text-cleaner.js';
import { PriceCleaner } from './price-cleaner.js';
import { TimeCleaner } from './time-cleaner.js';
import { CategoryStandardizer } from './category-standardizer.js';
import { QualityScorer } from './quality-scorer.js';
import type { CleanedPrice } from './price-cleaner.js';
import type { CleanedTime } from './time-cleaner.js';
import type { QualityScore } from './quality-scorer.js';

export interface CleanedItem {
  // 清洗后的字段
  canonicalName: string;
  displayName: string;
  brandName: string;
  normalizedBrandName: string;
  pitType: string;
  category: string;
  subCategory: string;
  saleStatus: string;
  currentPrice: number;
  originalPrice: number;
  depositPrice: number;
  balancePrice: number;
  currency: string;
  description: string;
  rawDescription: string;
  coverUrl: string;
  images: string[];
  sourceUrl: string;
  externalId: string;
  shopUrl: string;
  sourcePublishedAt: string | null;
  tags: string[];

  // 清洗元数据
  needsReview: boolean;
  reviewReasons: string[];
  qualityScore: QualityScore;
  cleanPrice: CleanedPrice;
  cleanTime: CleanedTime;
}

export class CleaningPipeline {
  private textCleaner = new TextCleaner();
  private priceCleaner = new PriceCleaner();
  private timeCleaner = new TimeCleaner();
  private categoryStandardizer = new CategoryStandardizer();
  private qualityScorer = new QualityScorer();

  clean(item: ParsedItem): CleanedItem {
    // 1. 文本清洗
    const cleanName = this.textCleaner.cleanTitle(item.canonicalName);
    const cleanDesc = this.textCleaner.cleanDescription(item.description);
    const cleanRawDesc = this.textCleaner.cleanDescription(item.rawDescription);

    // 2. 品牌标准化
    const brandName = item.brandName.trim();

    // 3. 分类标准化
    const pitType = this.categoryStandardizer.standardizePitType(item.pitType);
    const category = this.categoryStandardizer.standardizeProductType(item.category);

    // 4. 价格清洗
    const cleanPrice = this.priceCleaner.clean(item.currentPrice / 100);
    const cleanOriginal = this.priceCleaner.clean(item.originalPrice / 100);

    // 5. 时间清洗
    const cleanTime = this.timeCleaner.clean(item.sourcePublishedAt);

    // 6. 销售状态标准化
    const saleStatus = this.categoryStandardizer.standardizeSaleStatus(item.saleStatus);

    // 7. 判断是否需要人工审核
    const reviewReasons: string[] = [];
    if (pitType === 'OTHER') reviewReasons.push('坑向无法确认');
    if (!category || !this.categoryStandardizer.standardizeProductType(item.category)) reviewReasons.push('商品类型无法确认');
    if (cleanPrice.currentPrice <= 0) reviewReasons.push('价格无效');
    if (!brandName) reviewReasons.push('品牌为空');
    const needsReview = reviewReasons.length > 0;

    // 8. 质量评分
    const qualityScore = this.qualityScorer.score({
      sourceType: 'OFFICIAL',
      canonicalName: cleanName,
      brandName,
      category,
      currentPrice: cleanPrice.currentPrice,
      description: cleanDesc,
      coverUrl: item.coverUrl,
      images: item.images,
      sourcePublishedAt: cleanTime.iso,
      confidence: 100,
      reviewStatus: needsReview ? 'PENDING' : 'APPROVED',
    });

    return {
      canonicalName: cleanName,
      displayName: cleanName,
      brandName,
      normalizedBrandName: brandName,
      pitType,
      category,
      subCategory: item.subCategory,
      saleStatus,
      currentPrice: cleanPrice.currentPrice,
      originalPrice: cleanOriginal.currentPrice || item.originalPrice,
      depositPrice: cleanPrice.depositPrice,
      balancePrice: cleanPrice.balancePrice,
      currency: cleanPrice.currency,
      description: cleanDesc,
      rawDescription: cleanRawDesc,
      coverUrl: item.coverUrl,
      images: item.images,
      sourceUrl: item.sourceUrl,
      externalId: item.externalId,
      shopUrl: item.shopUrl,
      sourcePublishedAt: cleanTime.iso,
      tags: item.tags,
      needsReview,
      reviewReasons,
      qualityScore,
      cleanPrice,
      cleanTime,
    };
  }
}
