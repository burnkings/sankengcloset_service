// tests/content/brand-ranking-api.test.ts — Phase 2.6 品牌目录 + 三坑榜单 API 测试
// 覆盖：品牌列表/详情/品牌商品、榜单三 tab、feed spot 频道

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

describe('Phase 2.6 品牌目录 API', () => {
  it('GET /api/v1/brands 返回品牌列表', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/brands' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const brand = body.data[0];
    expect(brand.id).toBeTruthy();
    expect(brand.name).toBeTruthy();
    expect(typeof brand.followerCount).toBe('number');
    expect(typeof brand.isFollowed).toBe('boolean');
  });

  it('GET /api/v1/brands/:id 返回品牌详情', async () => {
    const instance = await createApp();
    const list = await instance.inject({ method: 'GET', url: '/api/v1/brands' });
    const brandId = list.json().data[0].id;
    const response = await instance.inject({ method: 'GET', url: `/api/v1/brands/${brandId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe(brandId);
  });

  it('GET /api/v1/brands/:id 不存在返回 404', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/brands/nonexistent' });
    expect(response.statusCode).toBe(404);
  });

  it('GET /api/v1/brands/:id/products 返回品牌商品', async () => {
    const instance = await createApp();
    const list = await instance.inject({ method: 'GET', url: '/api/v1/brands' });
    const brandId = list.json().data[0].id;
    const response = await instance.inject({ method: 'GET', url: `/api/v1/brands/${brandId}/products` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const item = body.data[0];
    expect(item.brandId).toBe(brandId);
    expect(typeof item.priceCents).toBe('number');
  });
});

describe('Phase 2.6 三坑榜单 API', () => {
  it('GET /api/v1/ranking 默认 hot 榜', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/ranking' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].rank).toBe(1);
    expect(body.data[0].entityId).toBeTruthy();
    expect(typeof body.data[0].favoriteCount).toBe('number');
  });

  it('GET /api/v1/ranking?tab=new 上新榜字段齐全', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/ranking?tab=new' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(typeof body.data[0].daysAgo).toBe('number');
    expect(typeof body.data[0].reservationCount).toBe('number');
  });

  it('GET /api/v1/ranking?tab=invalid 回退 hot', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/ranking?tab=invalid' });
    expect(response.statusCode).toBe(200);
  });
});

describe('Phase 2.6 feed spot 频道', () => {
  it('GET /api/v1/feed?channel=spot 只返回现货商品', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/feed?channel=spot' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data)).toBe(true);
    // 内存种子仅 1 个 ON_SALE 商品
    for (const item of body.data) {
      expect(item.saleStatus).toBe('ON_SALE');
    }
  });

  it('GET /api/v1/feed?channel=spot 状态码 200（枚举合法）', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/feed?channel=spot&limit=5' });
    expect(response.statusCode).toBe(200);
  });
});
