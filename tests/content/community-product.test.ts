// tests/content/community-product.test.ts — Phase 2.3-A Community → Product 测试
// 纯内存测试（MemoryRepository + seedProduct 注入），符合生产库保护约束（不碰 127.0.0.1:5433）。
// 覆盖：productId null 发布 / 有效商品发布 / 不存在商品拒绝 / 商品社区列表 / 404 / 普通内容兼容。

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryRepository } from '../../src/repositories/memory.js';
import type { Category, Product } from '../../src/types.js';

let app: FastifyInstance | undefined;
let repository: MemoryRepository;

async function createApp() {
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DRIVER: 'memory',
    JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
    PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-community-tests',
  });
  repository = new MemoryRepository();
  app = await buildApp({ config, repository, logger: false });
  await app.ready();
  return app;
}

async function login(instance: FastifyInstance): Promise<{ token: string; headers: Record<string, string> }> {
  const response = await instance.inject({ method: 'POST', url: '/api/v1/sessions/dev', payload: { nickname: '社区测试用户' } });
  const token = response.json().data.accessToken as string;
  return { token, headers: { authorization: `Bearer ${token}` } };
}

/** 上传一张 outfit 图片并返回 mediaId */
async function uploadOutfit(instance: FastifyInstance, headers: Record<string, string>): Promise<string> {
  const prepared = await instance.inject({
    method: 'POST', url: '/api/v1/uploads:prepare', headers,
    payload: { purpose: 'outfit', contentType: 'image/jpeg' },
  });
  const { uploadId, mediaId } = prepared.json().data;
  const uploaded = await instance.inject({
    method: 'PUT', url: `/api/v1/uploads/${uploadId}/content`,
    headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from('image'),
  });
  expect(uploaded.statusCode).toBe(201);
  return mediaId as string;
}

/** 注入一个 published 商品（默认 seed 商品 visibility 均可见） */
function seedProduct(id: string, title: string, category: string): void {
  const now = '2026-08-20T00:00:00.000Z';
  const product: Product = {
    id, brandId: 'br_rabbit', brandName: '兔缝缝', title, category: category as Category, subCategory: '', status: 'ON_SALE',
    coverUrl: `https://img.example.invalid/${id}.jpg`, images: [], priceCents: 12800, originalPriceCents: 0,
    priceType: 'FULL', depositCents: 0, balanceCents: 0, colorTags: [], materialTags: [], featureTags: [], variants: [],
    description: '', shopUrl: '', createdAt: now, updatedAt: now, styleId: null, currentRelease: null,
  };
  repository.seedProduct(product);
}

describe('Phase 2.3-A Community → Product', () => {
  it('1. productId=null 发布成功（普通社区内容保留）', async () => {
    const instance = await createApp();
    const { headers } = await login(instance);
    const mediaId = await uploadOutfit(instance, headers);
    const created = await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId, category: 'JK', topic: '今日穿搭', caption: '普通闲聊帖' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.productId).toBeNull();
  });

  it('2. productId=有效商品 发布成功', async () => {
    const instance = await createApp();
    seedProduct('prd_cp_1', '深蓝格裙 45cm', 'JK');
    const { headers } = await login(instance);
    const mediaId = await uploadOutfit(instance, headers);
    const created = await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId, category: 'JK', topic: '今日穿搭', caption: '返图', productId: 'prd_cp_1' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.productId).toBe('prd_cp_1');
  });

  it('3. productId=不存在商品 明确拒绝（400，不静默创建）', async () => {
    const instance = await createApp();
    const { headers } = await login(instance);
    const mediaId = await uploadOutfit(instance, headers);
    const created = await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId, category: 'JK', topic: '今日穿搭', caption: '挂幽灵商品', productId: 'prd_not_exist' },
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error?.code).toBe('VALIDATION_FAILED');
  });

  it('4. GET /products/:id/community 返回该商品内容（不含其他商品）', async () => {
    const instance = await createApp();
    seedProduct('prd_cp_a', '月光曲 JSK', 'LOLITA');
    seedProduct('prd_cp_b', '宋制旋裙套装', 'HANFU');
    const { headers } = await login(instance);
    // 商品 A 两条返图
    for (const caption of ['返图A1', '返图A2']) {
      const mediaId = await uploadOutfit(instance, headers);
      await instance.inject({
        method: 'POST', url: '/api/v1/community/posts', headers,
        payload: { mediaId, category: 'LOLITA', topic: '今日穿搭', caption, productId: 'prd_cp_a' },
      });
    }
    // 商品 B 一条返图
    const mediaB = await uploadOutfit(instance, headers);
    await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId: mediaB, category: 'HANFU', topic: '今日穿搭', caption: '返图B1', productId: 'prd_cp_b' },
    });

    const response = await instance.inject({ method: 'GET', url: '/api/v1/products/prd_cp_a/community' });
    expect(response.statusCode).toBe(200);
    const items = response.json().data as Array<{ productId: string | null; caption: string }>;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.productId).toBe('prd_cp_a');
      expect(['返图A1', '返图A2']).toContain(item.caption);
    }
    const page = response.json().page;
    expect(page.totalHint).toBe(2);
  });

  it('5. 商品不存在时 GET /products/:id/community → 404', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/products/prd_ghost/community' });
    expect(response.statusCode).toBe(404);
  });

  it('6. 社区流仍正常：普通帖 + 商品帖共存，productId 透出', async () => {
    const instance = await createApp();
    seedProduct('prd_cp_x', '圆领袍 唐制', 'HANFU');
    const { headers } = await login(instance);
    const m1 = await uploadOutfit(instance, headers);
    await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId: m1, category: 'HANFU', topic: '今日穿搭', caption: '普通帖' },
    });
    const m2 = await uploadOutfit(instance, headers);
    await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId: m2, category: 'HANFU', topic: '今日穿搭', caption: '商品帖', productId: 'prd_cp_x' },
    });

    const response = await instance.inject({ method: 'GET', url: '/api/v1/community/posts' });
    expect(response.statusCode).toBe(200);
    const items = response.json().data as Array<{ caption: string; productId: string | null }>;
    expect(items).toHaveLength(2);
    const normal = items.find((i) => i.caption === '普通帖');
    const linked = items.find((i) => i.caption === '商品帖');
    expect(normal?.productId).toBeNull();
    expect(linked?.productId).toBe('prd_cp_x');
  });
});
