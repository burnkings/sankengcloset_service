// crawler/strategy/crawl-policy-planner.ts — 采集策略计划器
// 根据 brand_crawl_policies 生成需要执行的 CrawlPlan
// Planner 只负责计划，不执行采集

import type { CrawlPolicy, CrawlPlan, CrawlMode } from './types.js';
import { CRAWL_MODE_DEFAULTS, CRAWL_HARD_LIMITS } from './types.js';

export interface PlannerOptions {
  now: Date;
  maxPlans?: number;          // 最多生成多少个 plan（默认 10）
  defaultIncrementalHours?: number;
  defaultFullDays?: number;
}

// ────────────────────────────────────────────────
// 时间判断
// ────────────────────────────────────────────────

function hoursSince(dateStr: string | null, now: Date): number {
  if (!dateStr) return Infinity;
  return (now.getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function daysSince(dateStr: string | null, now: Date): number {
  if (!dateStr) return Infinity;
  return (now.getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

// ────────────────────────────────────────────────
// 主函数
// ────────────────────────────────────────────────

/**
 * 根据采集策略生成采集计划
 * @param policies - 所有品牌的采集策略
 * @param options - 配置选项
 * @returns 按优先级排序的 CrawlPlan 列表
 */
export function buildCrawlPlans(
  policies: CrawlPolicy[],
  options: PlannerOptions,
): CrawlPlan[] {
  const { now, maxPlans = 10 } = options;
  const plans: CrawlPlan[] = [];

  for (const policy of policies) {
    // 未启用的策略跳过
    if (!policy.crawlEnabled) continue;

    // 检查 incremental
    const incPlan = checkIncremental(policy, now, options);
    if (incPlan) plans.push(incPlan);

    // 检查 full
    const fullPlan = checkFull(policy, now, options);
    if (fullPlan) plans.push(fullPlan);

    // 检查 backfill
    const backPlan = checkBackfill(policy, now);
    if (backPlan) plans.push(backPlan);
  }

  // 按 priority 降序排序
  plans.sort((a, b) => b.priority - a.priority);

  // 限制数量
  return plans.slice(0, maxPlans);
}

// ────────────────────────────────────────────────
// 检查函数
// ────────────────────────────────────────────────

function checkIncremental(
  policy: CrawlPolicy,
  now: Date,
  options: PlannerOptions,
): CrawlPlan | null {
  const intervalHours = policy.incrementalIntervalHours || options.defaultIncrementalHours || 24;
  const hours = hoursSince(policy.lastIncrementalCrawledAt, now);

  if (hours < intervalHours) return null;

  return {
    brandId: policy.brandId,
    brandName: policy.brandName || policy.brandId,
    sourceType: policy.sourceType,
    sourceUrl: policy.sourceUrl,
    crawlMode: 'incremental',
    priority: policy.priority,
    reason: hours === Infinity
      ? '首次采集'
      : `增量采集到期（${Math.round(hours)}h > ${intervalHours}h）`,
    maxItems: CRAWL_MODE_DEFAULTS.incremental.maxItems,
    scheduledAt: now.toISOString(),
  };
}

function checkFull(
  policy: CrawlPolicy,
  now: Date,
  options: PlannerOptions,
): CrawlPlan | null {
  const intervalDays = policy.fullIntervalDays || options.defaultFullDays || 30;
  const days = daysSince(policy.lastFullCrawledAt, now);

  if (days < intervalDays) return null;

  return {
    brandId: policy.brandId,
    brandName: policy.brandName || policy.brandId,
    sourceType: policy.sourceType,
    sourceUrl: policy.sourceUrl,
    crawlMode: 'full',
    priority: policy.priority - 1, // full 优先级略低于 incremental
    reason: days === Infinity
      ? '首次全量采集'
      : `全量采集到期（${Math.round(days)}d > ${intervalDays}d）`,
    maxItems: CRAWL_MODE_DEFAULTS.full.maxItems,
    scheduledAt: now.toISOString(),
  };
}

function checkBackfill(
  policy: CrawlPolicy,
  now: Date,
): CrawlPlan | null {
  if (!policy.backfillEnabled) return null;

  // backfill 只在从未执行过时触发（或 lastBackfillCrawledAt 为空）
  // 后续可通过手动触发
  if (policy.lastBackfillCrawledAt) return null;

  return {
    brandId: policy.brandId,
    brandName: policy.brandName || policy.brandId,
    sourceType: policy.sourceType,
    sourceUrl: policy.sourceUrl,
    crawlMode: 'backfill',
    priority: policy.priority - 2, // backfill 优先级最低
    reason: '首次历史回填',
    maxItems: CRAWL_MODE_DEFAULTS.backfill.maxItems,
    scheduledAt: now.toISOString(),
  };
}

// ────────────────────────────────────────────────
// 辅助：生成手动采集计划
// ────────────────────────────────────────────────

/**
 * 生成手动采集计划（人工触发）
 */
export function buildManualPlan(
  policy: CrawlPolicy,
  maxItems: number = CRAWL_MODE_DEFAULTS.manual.maxItems,
): CrawlPlan {
  const capped = Math.min(maxItems, CRAWL_HARD_LIMITS.manual);
  return {
    brandId: policy.brandId,
    brandName: policy.brandName || policy.brandId,
    sourceType: policy.sourceType,
    sourceUrl: policy.sourceUrl,
    crawlMode: 'manual',
    priority: 100, // 手动最高优先级
    reason: '人工触发',
    maxItems: capped,
    scheduledAt: new Date().toISOString(),
  };
}
