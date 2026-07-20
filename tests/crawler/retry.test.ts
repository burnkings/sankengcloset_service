// tests/crawler/retry.test.ts — 重试机制单元测试

import { describe, it, expect } from 'vitest';
import { withRetry, isTransientError } from '../../src/crawler/core/retry.js';

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return 'ok'; }, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('should retry on failure and succeed', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => { calls++; if (calls < 3) throw new Error('fail'); return 'ok'; },
      { maxRetries: 3, baseDelayMs: 10 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('should throw after max retries', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => { calls++; throw new Error('always fail'); }, { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow('always fail');
    expect(calls).toBe(3); // 1 initial + 2 retries
  });
});

describe('isTransientError', () => {
  it('should detect transient errors', () => {
    expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
    expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
    expect(isTransientError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('should not detect non-transient errors', () => {
    expect(isTransientError(new Error('invalid input'))).toBe(false);
    expect(isTransientError(new Error('not found'))).toBe(false);
  });

  it('should handle non-Error values', () => {
    expect(isTransientError('string error')).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});
