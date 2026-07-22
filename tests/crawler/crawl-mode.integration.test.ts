// tests/crawler/crawl-mode.integration.test.ts — Crawl Mode 集成测试

import { describe, it, expect } from 'vitest';
import { CRAWL_MODE_DEFAULTS, CRAWL_HARD_LIMITS } from '../../src/crawler/strategy/types.js';

describe('Crawl Mode 集成', () => {
  // Case 12: crawler 脚本写入 crawl_mode
  it('crawl_mode 枚举值正确', () => {
    expect(CRAWL_MODE_DEFAULTS.incremental).toBeDefined();
    expect(CRAWL_MODE_DEFAULTS.full).toBeDefined();
    expect(CRAWL_MODE_DEFAULTS.backfill).toBeDefined();
    expect(CRAWL_MODE_DEFAULTS.manual).toBeDefined();
  });

  // Case 13: full crawl 默认 draft
  it('full crawl 默认 draft', () => {
    expect(CRAWL_MODE_DEFAULTS.full.visibilityStatus).toBe('draft');
  });

  // Case 14: backfill 默认 draft
  it('backfill 默认 draft', () => {
    expect(CRAWL_MODE_DEFAULTS.backfill.visibilityStatus).toBe('draft');
  });

  // Case 15: full crawl 有硬上限
  it('full crawl 硬上限', () => {
    expect(CRAWL_HARD_LIMITS.full).toBeLessThanOrEqual(1000);
    expect(CRAWL_HARD_LIMITS.full).toBeGreaterThan(0);
  });

  // Case 16: backfill 有硬上限
  it('backfill 硬上限', () => {
    expect(CRAWL_HARD_LIMITS.backfill).toBeLessThanOrEqual(500);
  });

  // Case 17: 硬上限阻止无限抓取
  it('hard limits 阻止无限抓取', () => {
    for (const [mode, limit] of Object.entries(CRAWL_HARD_LIMITS)) {
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(1000);
    }
  });

  // Case 18: incremental maxItems 合理
  it('incremental maxItems 合理', () => {
    expect(CRAWL_MODE_DEFAULTS.incremental.maxItems).toBeGreaterThan(0);
    expect(CRAWL_MODE_DEFAULTS.incremental.maxItems).toBeLessThanOrEqual(100);
  });

  // Case 19: full 不影响 published Feed
  it('full crawl 结果为 draft', () => {
    // 模拟：full crawl 写入的产品应该是 draft
    const product = { visibility_status: CRAWL_MODE_DEFAULTS.full.visibilityStatus };
    expect(product.visibility_status).toBe('draft');
  });

  // Case 20: backfill 不影响 published Feed
  it('backfill 结果为 draft', () => {
    const product = { visibility_status: CRAWL_MODE_DEFAULTS.backfill.visibilityStatus };
    expect(product.visibility_status).toBe('draft');
  });
});
