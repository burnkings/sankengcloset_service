// crawler/core/job.ts — 采集任务追踪

import type { CrawlJobConfig, CrawlJobStats } from './types.js';

let jobCounter = 0;

export function createJobId(): string {
  return `job_${Date.now()}_${++jobCounter}`;
}

export function createJobStats(config: CrawlJobConfig, jobId: string): CrawlJobStats {
  return {
    jobId,
    sourceType: config.sourceType,
    sourceUrl: config.sourceUrl,
    crawlMode: config.crawlMode || 'incremental',
    startedAt: new Date(),
    finishedAt: null,
    status: 'running',
    fetchedCount: 0,
    parsedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    errors: [],
  };
}

export function finishJob(stats: CrawlJobStats, status: 'success' | 'failed'): CrawlJobStats {
  return { ...stats, status, finishedAt: new Date() };
}

export function recordError(stats: CrawlJobStats, error: string): CrawlJobStats {
  return {
    ...stats,
    errorCount: stats.errorCount + 1,
    errors: [...stats.errors, error].slice(-10), // 保留最近10条
  };
}
