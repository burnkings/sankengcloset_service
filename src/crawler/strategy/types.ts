// crawler/strategy/types.ts — 采集策略类型定义

// ============================================================
// 采集模式
// ============================================================

export type CrawlMode = 'incremental' | 'full' | 'backfill' | 'manual';

// ============================================================
// 品牌采集策略（对应 brand_crawl_policies 表）
// ============================================================

export interface CrawlPolicy {
  id: string;
  brandId: string;
  sourceType: string;
  sourceUrl: string;
  crawlEnabled: boolean;
  incrementalIntervalHours: number;
  fullIntervalDays: number;
  backfillEnabled: boolean;
  priority: number;
  lastIncrementalCrawledAt: string | null;
  lastFullCrawledAt: string | null;
  lastBackfillCrawledAt: string | null;
  // 关联品牌信息
  brandName?: string;
}

// ============================================================
// 采集计划（Planner 输出）
// ============================================================

export interface CrawlPlan {
  brandId: string;
  brandName: string;
  sourceType: string;
  sourceUrl: string;
  crawlMode: CrawlMode;
  priority: number;
  reason: string;
  maxItems: number;
  scheduledAt: string;
  // Backfill 专用参数
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  seriesName?: string;
}

// ============================================================
// 采集执行上下文
// ============================================================

export interface CrawlExecutionContext {
  crawlJobId: string;
  crawlMode: CrawlMode;
  brandId: string;
  sourceType: string;
  parserVersion: string;
  maxItems: number;
  // Backfill 参数
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  seriesName?: string;
}

// ============================================================
// 策略常量
// ============================================================

export const CRAWL_MODE_DEFAULTS: Record<CrawlMode, { maxItems: number; visibilityStatus: string }> = {
  incremental: { maxItems: 50, visibilityStatus: 'draft' },
  full:        { maxItems: 200, visibilityStatus: 'draft' },
  backfill:    { maxItems: 100, visibilityStatus: 'draft' },
  manual:      { maxItems: 200, visibilityStatus: 'draft' },
};

/** Full/Backfill 硬上限，防止无限抓取 */
export const CRAWL_HARD_LIMITS: Record<CrawlMode, number> = {
  incremental: 500,
  full: 1000,
  backfill: 500,
  manual: 1000,
};
