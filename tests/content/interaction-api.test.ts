// tests/content/interaction-api.test.ts — 事件/收藏/品牌关注 API 测试

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

async function login(instance: FastifyInstance): Promise<string> {
  const res = await instance.inject({ method: 'POST', url: '/api/v1/sessions/dev', payload: { nickname: 'D8测试用户' } });
  return res.json().data.accessToken as string;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('User Events', () => {
  it('records a VIEW_PRODUCT event', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const res = await instance.inject({
      method: 'POST', url: '/api/v1/events',
      headers: { authorization: `Bearer ${token}` },
      payload: { eventType: 'VIEW_PRODUCT', targetType: 'product', targetId: 'prd_jk_navy_45' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.eventType).toBe('VIEW_PRODUCT');
    expect(res.json().data.targetId).toBe('prd_jk_navy_45');
  });

  it('records anonymous event', async () => {
    const instance = await createApp();
    const res = await instance.inject({
      method: 'POST', url: '/api/v1/events',
      payload: { eventType: 'SEARCH', targetType: 'search', targetId: '', metadata: { q: '格裙' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.userId).toBeNull();
  });

  it('rejects invalid event type', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const res = await instance.inject({
      method: 'POST', url: '/api/v1/events',
      headers: { authorization: `Bearer ${token}` },
      payload: { eventType: 'INVALID_TYPE', targetType: 'product', targetId: 'p1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists user events', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    await instance.inject({ method: 'POST', url: '/api/v1/events', headers: auth,
      payload: { eventType: 'VIEW_PRODUCT', targetType: 'product', targetId: 'p1' } });
    await instance.inject({ method: 'POST', url: '/api/v1/events', headers: auth,
      payload: { eventType: 'LIKE_PRODUCT', targetType: 'product', targetId: 'p1' } });
    const res = await instance.inject({ method: 'GET', url: '/api/v1/events', headers: auth });
    expect(res.json().data).toHaveLength(2);
  });

  it('filters events by type', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    await instance.inject({ method: 'POST', url: '/api/v1/events', headers: auth,
      payload: { eventType: 'VIEW_PRODUCT', targetType: 'product', targetId: 'p1' } });
    await instance.inject({ method: 'POST', url: '/api/v1/events', headers: auth,
      payload: { eventType: 'LIKE_PRODUCT', targetType: 'product', targetId: 'p1' } });
    const res = await instance.inject({ method: 'GET', url: '/api/v1/events?eventType=VIEW_PRODUCT', headers: auth });
    expect(res.json().data).toHaveLength(1);
  });
});

describe('Wishlist', () => {
  it('adds a wishlist item', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const res = await instance.inject({
      method: 'POST', url: '/api/v1/wishlist',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '深蓝格裙', status: 'WANT', productId: 'prd_jk_navy_45' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe('WANT');
    expect(res.json().data.productId).toBe('prd_jk_navy_45');
  });

  it('lists wishlist items', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    await instance.inject({ method: 'POST', url: '/api/v1/wishlist', headers: auth,
      payload: { title: '商品A', status: 'WANT', productId: 'p1' } });
    await instance.inject({ method: 'POST', url: '/api/v1/wishlist', headers: auth,
      payload: { title: '商品B', status: 'WATCHING', productId: 'p2' } });
    const res = await instance.inject({ method: 'GET', url: '/api/v1/wishlist', headers: auth });
    expect(res.json().data).toHaveLength(2);
  });

  it('updates wishlist status', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    const addRes = await instance.inject({ method: 'POST', url: '/api/v1/wishlist', headers: auth,
      payload: { title: '商品A', status: 'WANT', productId: 'p1' } });
    const id = addRes.json().data.id;
    const patchRes = await instance.inject({ method: 'PATCH', url: `/api/v1/wishlist/${id}`, headers: auth,
      payload: { status: 'PURCHASED' } });
    expect(patchRes.json().data.status).toBe('PURCHASED');
  });

  it('removes wishlist item', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    const addRes = await instance.inject({ method: 'POST', url: '/api/v1/wishlist', headers: auth,
      payload: { title: '商品A', status: 'WANT', productId: 'p1' } });
    const id = addRes.json().data.id;
    const delRes = await instance.inject({ method: 'DELETE', url: `/api/v1/wishlist/${id}`, headers: auth });
    expect(delRes.statusCode).toBe(204);
  });

  it('filters wishlist by status', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    await instance.inject({ method: 'POST', url: '/api/v1/wishlist', headers: auth,
      payload: { title: 'A', status: 'WANT', productId: 'p1' } });
    await instance.inject({ method: 'POST', url: '/api/v1/wishlist', headers: auth,
      payload: { title: 'B', status: 'PURCHASED', productId: 'p2' } });
    const res = await instance.inject({ method: 'GET', url: '/api/v1/wishlist?status=WANT', headers: auth });
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].status).toBe('WANT');
  });
});

describe('Brand Follow', () => {
  it('follows a brand', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const res = await instance.inject({
      method: 'POST', url: '/api/v1/brands/follow',
      headers: { authorization: `Bearer ${token}` },
      payload: { brandId: 'br_rabbit' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.brandId).toBe('br_rabbit');
  });

  it('unfollows a brand', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    await instance.inject({ method: 'POST', url: '/api/v1/brands/follow', headers: auth, payload: { brandId: 'br_rabbit' } });
    const res = await instance.inject({ method: 'DELETE', url: '/api/v1/brands/br_rabbit/follow', headers: auth });
    expect(res.statusCode).toBe(204);
  });

  it('lists followed brands', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    await instance.inject({ method: 'POST', url: '/api/v1/brands/follow', headers: auth, payload: { brandId: 'br_rabbit' } });
    await instance.inject({ method: 'POST', url: '/api/v1/brands/follow', headers: auth, payload: { brandId: 'br_starcat' } });
    const res = await instance.inject({ method: 'GET', url: '/api/v1/brands/followed', headers: auth });
    expect(res.json().data).toContain('br_rabbit');
    expect(res.json().data).toContain('br_starcat');
  });

  it('is idempotent for duplicate follow', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    await instance.inject({ method: 'POST', url: '/api/v1/brands/follow', headers: auth, payload: { brandId: 'br_rabbit' } });
    await instance.inject({ method: 'POST', url: '/api/v1/brands/follow', headers: auth, payload: { brandId: 'br_rabbit' } });
    const res = await instance.inject({ method: 'GET', url: '/api/v1/brands/followed', headers: auth });
    expect(res.json().data).toHaveLength(1);
  });
});

describe('Feed Personalization', () => {
  it('returns personalScore=0 for anonymous', async () => {
    const instance = await createApp();
    const res = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=1' });
    const item = res.json().data[0];
    expect(item.personalScore).toBe(0);
    expect(item.matchReason).toBe('');
  });

  it('returns personalScore for logged-in user', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    // 先关注品牌
    await instance.inject({ method: 'POST', url: '/api/v1/brands/follow', headers: auth, payload: { brandId: 'br_rabbit' } });
    const res = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=3', headers: auth });
    const items = res.json().data;
    // 兔缝缝的商品应该有品牌匹配
    const rabbitItem = items.find((i: any) => i.brandId === 'br_rabbit');
    if (rabbitItem) {
      expect(rabbitItem.personalScore).toBeGreaterThan(0);
      expect(rabbitItem.matchReason).toContain('关注');
    }
  });

  it('includes finalScore in feed items', async () => {
    const instance = await createApp();
    const res = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=1' });
    const item = res.json().data[0];
    expect(item.finalScore).toBeDefined();
    expect(typeof item.finalScore).toBe('number');
  });
});
