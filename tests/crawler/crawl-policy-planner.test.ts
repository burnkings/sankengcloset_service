// tests/crawler/crawl-policy-planner.test.ts — CrawlPolicyPlanner 测试

import { describe, it, expect } from 'vitest';
import { buildCrawlPlans, buildManualPlan } from '../../src/crawler/strategy/crawl-policy-planner.js';
import type { CrawlPolicy } from '../../src/crawler/strategy/types.js';
import { CRAWL_MODE_DEFAULTS, CRAWL_HARD_LIMITS } from '../../src/crawler/strategy/types.js';

function makePolicy(overrides: Partial<CrawlPolicy> = {}): CrawlPolicy {
  return {
    id: 'pol_001',
    brandId: 'br_001',
    brandName: '兔缝缝',
    sourceType: 'OFFICIAL',
    sourceUrl: 'fixture://test.json',
    crawlEnabled: true,
    incrementalIntervalHours: 24,
    fullIntervalDays: 30,
    backfillEnabled: false,
    priority: 10,
    lastIncrementalCrawledAt: null,
    lastFullCrawledAt: null,
    lastBackfillCrawledAt: null,
    ...overrides,
  };
}

describe('CrawlPolicyPlanner', () => {
  const now = new Date('2026-07-22T12:00:00Z');

  // Case 1: disabled policy 不生成 plan
  it('disabled policy 不生成 plan', () => {
    const policy = makePolicy({ crawlEnabled: false });
    const plans = buildCrawlPlans([policy], { now });
    expect(plans).toHaveLength(0);
  });

  // Case 2: incremental 到期生成 plan
  it('incremental 到期生成 plan', () => {
    const policy = makePolicy({
      lastIncrementalCrawledAt: '2026-07-20T00:00:00Z', // 60h ago > 24h
    });
    const plans = buildCrawlPlans([policy], { now });
    const incPlans = plans.filter(p => p.crawlMode === 'incremental');
    expect(incPlans).toHaveLength(1);
    expect(incPlans[0]!.brandId).toBe('br_001');
  });

  // Case 3: incremental 未到期不生成
  it('incremental 未到期不生成 plan', () => {
    const policy = makePolicy({
      lastIncrementalCrawledAt: '2026-07-22T00:00:00Z', // 12h ago < 24h
    });
    const plans = buildCrawlPlans([policy], { now });
    expect(plans.filter(p => p.crawlMode === 'incremental')).toHaveLength(0);
  });

  // Case 4: full 到期生成 plan
  it('full 到期生成 plan', () => {
    const policy = makePolicy({
      lastFullCrawledAt: '2026-06-01T00:00:00Z', // 51d ago > 30d
    });
    const plans = buildCrawlPlans([policy], { now });
    const fullPlans = plans.filter(p => p.crawlMode === 'full');
    expect(fullPlans).toHaveLength(1);
  });

  // Case 5: backfill_enabled 生成 backfill plan
  it('backfill_enabled 且未执行过生成 backfill plan', () => {
    const policy = makePolicy({ backfillEnabled: true });
    const plans = buildCrawlPlans([policy], { now });
    const backPlans = plans.filter(p => p.crawlMode === 'backfill');
    expect(backPlans).toHaveLength(1);
  });

  // Case 6: backfill 已执行过不生成
  it('backfill 已执行过不生成 plan', () => {
    const policy = makePolicy({
      backfillEnabled: true,
      lastBackfillCrawledAt: '2026-07-01T00:00:00Z',
    });
    const plans = buildCrawlPlans([policy], { now });
    expect(plans.filter(p => p.crawlMode === 'backfill')).toHaveLength(0);
  });

  // Case 7: priority 高的排前面
  it('priority 高的排前面', () => {
    const policies = [
      makePolicy({ id: 'pol_low', brandId: 'br_low', priority: 1 }),
      makePolicy({ id: 'pol_high', brandId: 'br_high', priority: 100 }),
      makePolicy({ id: 'pol_mid', brandId: 'br_mid', priority: 50 }),
    ];
    const plans = buildCrawlPlans(policies, { now });
    // 每个 policy 可能生成多个 plan（incremental + full），但高 priority 的 brand 应排在前面
    const highIdx = plans.findIndex(p => p.brandId === 'br_high');
    const midIdx = plans.findIndex(p => p.brandId === 'br_mid');
    const lowIdx = plans.findIndex(p => p.brandId === 'br_low');
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  // Case 8: max plan 数量限制
  it('max plan 数量限制', () => {
    const policies = Array.from({ length: 20 }, (_, i) =>
      makePolicy({ id: `pol_${i}`, brandId: `br_${i}`, priority: i }),
    );
    const plans = buildCrawlPlans(policies, { now, maxPlans: 5 });
    expect(plans).toHaveLength(5);
  });

  // Case 9: 首次采集（无 lastXxxAt）生成 plan
  it('首次采集（无 lastXxxAt）生成 plan', () => {
    const policy = makePolicy(); // 所有 lastXxxAt = null
    const plans = buildCrawlPlans([policy], { now });
    expect(plans.length).toBeGreaterThanOrEqual(1); // 至少 incremental
  });

  // Case 10: 手动计划
  it('手动计划最高优先级', () => {
    const policy = makePolicy();
    const plan = buildManualPlan(policy, 100);
    expect(plan.crawlMode).toBe('manual');
    expect(plan.priority).toBe(100);
    expect(plan.maxItems).toBe(100);
  });

  // Case 11: 手动计划受硬上限限制
  it('手动计划受硬上限限制', () => {
    const policy = makePolicy();
    const plan = buildManualPlan(policy, 9999);
    expect(plan.maxItems).toBe(CRAWL_HARD_LIMITS.manual);
  });
});
