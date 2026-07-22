// tests/content/feed-aggregation.test.ts — Feed 聚合层测试
// 测试 ContentFeedItem 的正确聚合、draft 过滤、published 展示

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryRepository } from '../../src/repositories/memory.js';

let app: FastifyInstance | undefined;

async function createApp() {
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DRIVER: 'memory',
    JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
    PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-api-tests',
  });
  app = await buildApp({ config, repository: new MemoryRepository(), logger: false });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('Feed Aggregation', () => {
  it('returns ContentFeedItem with all required fields', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=1' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const item = body.data[0];
    // ContentFeedItem 必须字段
    expect(item.id).toBeDefined();
    expect(item.feedType).toBe('product');
    expect(item.entityId).toBeDefined();
    expect(item.title).toBeDefined();
    expect(item.subtitle).toBeDefined(); // 品牌名
    expect(item.coverUrl).toBeDefined();
    expect(item.brandId).toBeDefined();
    expect(item.brandName).toBeDefined();
    expect(item.category).toBeDefined();
    expect(item.price).toBeDefined();
    expect(item.priceSummary).toBeDefined(); // e.g. "¥128.00"
    expect(item.saleStatus).toBeDefined();
    expect(item.feedScore).toBeDefined();
    expect(item.feedReason).toBeDefined(); // 推荐理由
    expect(item.publishedAt).toBeDefined();
    expect(item.sourceLabel).toBeDefined();
  });

  it('includes feedReason as human-readable string', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=5' });
    const body = response.json();
    for (const item of body.data) {
      expect(typeof item.feedReason).toBe('string');
      expect(item.feedReason.length).toBeGreaterThan(0);
    }
  });

  it('sorts by feedScore descending', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=10' });
    const body = response.json();
    const scores = body.data.map((item: { feedScore: number }) => item.feedScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('filters by category', async () => {
    const instance = await createApp();
    const jkFeed = await instance.inject({ method: 'GET', url: '/api/v1/feed?category=JK&limit=10' });
    const lolitaFeed = await instance.inject({ method: 'GET', url: '/api/v1/feed?category=LOLITA&limit=10' });
    for (const item of jkFeed.json().data) {
      expect(item.category).toBe('JK');
    }
    for (const item of lolitaFeed.json().data) {
      expect(item.category).toBe('LOLITA');
    }
  });

  it('returns empty data for non-existent category', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/feed?category=OTHER&limit=10' });
    expect(response.json().data).toEqual([]);
  });

  it('supports pagination via cursor', async () => {
    const instance = await createApp();
    const page1 = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=2' });
    const body1 = page1.json();
    expect(body1.data).toHaveLength(2);
    expect(body1.page.hasMore).toBe(true);

    const page2 = await instance.inject({ method: 'GET', url: `/api/v1/feed?limit=2&cursor=${body1.page.nextCursor}` });
    const body2 = page2.json();
    expect(body2.data.length).toBeGreaterThan(0);
    // 确保分页不重复
    const ids1 = body1.data.map((i: { entityId: string }) => i.entityId);
    const ids2 = body2.data.map((i: { entityId: string }) => i.entityId);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });
});
