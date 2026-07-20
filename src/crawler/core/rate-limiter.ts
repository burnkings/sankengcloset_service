// crawler/core/rate-limiter.ts — 每来源独立限速

export class RateLimiter {
  private lastRequestTime = new Map<string, number>();

  constructor(private readonly defaultDelayMs: number = 1000) {}

  async wait(sourceId: string, delayMs?: number): Promise<void> {
    const delay = delayMs ?? this.defaultDelayMs;
    const last = this.lastRequestTime.get(sourceId) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < delay) {
      await new Promise(resolve => setTimeout(resolve, delay - elapsed));
    }
    this.lastRequestTime.set(sourceId, Date.now());
  }

  reset(sourceId: string): void {
    this.lastRequestTime.delete(sourceId);
  }
}
