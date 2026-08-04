// tests/content/search-api.test.ts — 搜索 API 测试
// 测试关键词搜索、分类过滤、价格范围、发售状态过滤

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

describe('Search API', () => {
  it('returns results for keyword search', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=格裙' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBeGreaterThan(0);
    // 标题包含关键词
    for (const item of body.data) {
      expect(item.title.toLowerCase()).toContain('格裙');
    }
  });

  it('searches by brand name', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=兔缝缝' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const item of body.data) {
      expect(item.brandName).toContain('兔缝缝');
    }
  });

  it('returns empty for non-matching keyword', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=不存在的商品XYZ' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it('filters by category', async () => {
    const instance = await createApp();
    const jkSearch = await instance.inject({ method: 'GET', url: '/api/v1/search?category=JK' });
    for (const item of jkSearch.json().data) {
      expect(item.category).toBe('JK');
    }

    const lolitaSearch = await instance.inject({ method: 'GET', url: '/api/v1/search?category=LOLITA' });
    for (const item of lolitaSearch.json().data) {
      expect(item.category).toBe('LOLITA');
    }
  });

  it('filters by sale status', async () => {
    const instance = await createApp();
    const preOrder = await instance.inject({ method: 'GET', url: '/api/v1/search?saleStatus=PRE_ORDER' });
    for (const item of preOrder.json().data) {
      expect(item.saleStatus).toBe('PRE_ORDER');
    }
  });

  it('filters by price range', async () => {
    const instance = await createApp();
    // 价格 > 20000 分
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?minPrice=20000' });
    for (const item of response.json().data) {
      expect(item.price).toBeGreaterThanOrEqual(20000);
    }
    // 价格 < 20000 分
    const cheap = await instance.inject({ method: 'GET', url: '/api/v1/search?maxPrice=20000' });
    for (const item of cheap.json().data) {
      expect(item.price).toBeLessThanOrEqual(20000);
    }
  });

  it('returns ContentFeedItem format', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=月光' });
    const body = response.json();
    for (const item of body.data) {
      expect(item.feedReason).toBeDefined();
      expect(item.priceSummary).toBeDefined();
      expect(item.feedScore).toBeDefined();
      expect(item.sourceLabel).toBe('搜索结果');
    }
  });

  it('supports pagination', async () => {
    const instance = await createApp();
    const page1 = await instance.inject({ method: 'GET', url: '/api/v1/search?limit=1' });
    const body1 = page1.json();
    expect(body1.data).toHaveLength(1);
    if (body1.page.hasMore) {
      const page2 = await instance.inject({ method: 'GET', url: `/api/v1/search?limit=1&cursor=${body1.page.nextCursor}` });
      expect(page2.json().data.length).toBeGreaterThan(0);
    }
  });

  it('combines keyword + category filter', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=月光&category=LOLITA' });
    const body = response.json();
    for (const item of body.data) {
      expect(item.category).toBe('LOLITA');
      expect(item.title.toLowerCase()).toContain('月光');
    }
  });

  it('supports pit aliases: 洛丽塔 / Lolita / LOLITA hit LOLITA category', async () => {
    const instance = await createApp();
    for (const q of ['洛丽塔', 'Lolita', 'LOLITA']) {
      const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const hasLolita = body.data.some((item: { category: string }) => item.category === 'LOLITA');
      expect(hasLolita).toBe(true);
    }
  });

  it('supports pit aliases: 汉服 / HANFU hit HANFU category', async () => {
    const instance = await createApp();
    for (const q of ['汉服', 'HANFU']) {
      const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const hasHanfu = body.data.some((item: { category: string }) => item.category === 'HANFU');
      expect(hasHanfu).toBe(true);
    }
  });

  it('supports pit aliases: JK / 制服 / JK制服 hit JK category', async () => {
    const instance = await createApp();
    for (const q of ['JK', '制服', 'JK制服']) {
      const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const hasJk = body.data.some((item: { category: string }) => item.category === 'JK');
      expect(hasJk).toBe(true);
    }
  });

  it('handles malicious quote input safely (parameterized, no injection)', async () => {
    const instance = await createApp();
    const malicious = ["foo' OR '1'='1", '" OR 1=1 --', "' OR '1'='1' --", "'; DROP TABLE products;--"];
    for (const q of malicious) {
      const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      // 恶意输入不应命中任何商品，也不应抛错/返回非 200
      expect(body.data.length).toBe(0);
    }
  });
});
