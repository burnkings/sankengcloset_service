// crawler/sources/base.ts — Source Adapter 基类

import type { FetchResult, SourceAdapter } from '../core/types.js';
import { withRetry, isTransientError } from '../core/retry.js';
import { RateLimiter } from '../core/rate-limiter.js';

export abstract class BaseSourceAdapter implements SourceAdapter {
  abstract readonly sourceType: string;
  abstract readonly name: string;

  protected rateLimiter: RateLimiter;
  protected userAgent: string;
  protected timeoutMs: number;

  constructor(opts: { rateLimitMs?: number; userAgent?: string; timeoutMs?: number } = {}) {
    this.rateLimiter = new RateLimiter(opts.rateLimitMs ?? 2000);
    this.userAgent = opts.userAgent ?? 'SankengBot/1.0 (+https://sankengcloset.com)';
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  abstract canHandle(url: string): boolean;
  protected abstract doFetch(url: string): Promise<FetchResult>;

  async fetchWithRetry(url: string): Promise<FetchResult> {
    await this.rateLimiter.wait(this.sourceType);
    return withRetry(
      () => this.doFetch(url),
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        backoffMultiplier: 2,
      },
    );
  }

  async fetchList(url: string): Promise<FetchResult[]> {
    return [await this.fetchWithRetry(url)];
  }

  async fetchDetail(url: string): Promise<FetchResult> {
    return this.fetchWithRetry(url);
  }
}
