// tests/content/style-api.test.ts — Phase 2.1 Style Entity API 测试
// 纯内存测试（MemoryRepository + seedStyle 注入），符合生产库保护约束（不碰 127.0.0.1:5433）

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryRepository } from '../../src/repositories/memory.js';
import type { StyleDetail } from '../../src/types.js';

let app: FastifyInstance | undefined;
let repository: MemoryRepository;

function makeStyle(overrides: Partial<StyleDetail> = {}): StyleDetail {
  return {
    id: 'sty_moonlight',
    brandId: 'br_starcat',
    brandName: '星辰猫',
    canonicalName: '月光曲 JSK',
    category: 'LOLITA',
    subCategory: 'JSK',
    styleTags: ['甜系'],
    description: '',
    productCount: 2,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    products: [
      {
        id: 'prd_lolita_moon', brandId: 'br_starcat', brandName: '星辰猫', title: '月光曲 JSK',
        category: 'LOLITA', subCategory: 'JSK', status: 'PRE_ORDER', coverUrl: 'https://images.example.invalid/moon-jsk-cover.jpg',
        images: [], priceCents: 36800, originalPriceCents: 39800, priceType: 'DEPOSIT', depositCents: 10000, balanceCents: 26800,
        colorTags: ['白色'], materialTags: ['棉'], featureTags: ['甜系'], variants: [],
        description: '', shopUrl: '',
        createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
        styleId: 'sty_moonlight', currentRelease: null,
      },
      {
        id: 'prd_lolita_moon_black', brandId: 'br_starcat', brandName: '星辰猫', title: '月光曲 JSK 绀色',
        category: 'LOLITA', subCategory: 'JSK', status: 'ON_SALE', coverUrl: 'https://images.example.invalid/moon-jsk-black.jpg',
        images: [], priceCents: 36800, originalPriceCents: 39800, priceType: 'FULL', depositCents: 0, balanceCents: 0,
        colorTags: ['绀色'], materialTags: ['棉'], featureTags: ['甜系'], variants: [],
        description: '', shopUrl: '',
        createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
        styleId: 'sty_moonlight', currentRelease: null,
      },
    ],
    ...overrides,
  };
}

async function createApp() {
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DRIVER: 'memory',
    JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
    PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-api-tests',
  });
  repository = new MemoryRepository();
  app = await buildApp({ config, repository, logger: false });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('Style Entity API（memory）', () => {
  it('GET /api/v1/styles/:id 返回款式基础信息 + 关联商品', async () => {
    const instance = await createApp();
    repository.seedStyle(makeStyle());
    const response = await instance.inject({ method: 'GET', url: '/api/v1/styles/sty_moonlight' });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.id).toBe('sty_moonlight');
    expect(data.brandName).toBe('星辰猫');
    expect(data.canonicalName).toBe('月光曲 JSK');
    expect(data.category).toBe('LOLITA');
    expect(data.productCount).toBe(2);
    // 一个 Style 关联多个 Product（黑/原色版本）
    expect(data.products.length).toBe(2);
    expect(data.products.map((p: { id: string }) => p.id)).toContain('prd_lolita_moon');
    expect(data.products.map((p: { id: string }) => p.id)).toContain('prd_lolita_moon_black');
    // 商品带 styleId 关联
    expect(data.products[0].styleId).toBe('sty_moonlight');
  });

  it('GET /api/v1/styles/:id 不存在返回 404', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/styles/sty_unknown' });
    expect(response.statusCode).toBe(404);
  });

  it('GET /api/v1/styles/:id/products 返回关联商品列表 + totalHint', async () => {
    const instance = await createApp();
    repository.seedStyle(makeStyle());
    const response = await instance.inject({ method: 'GET', url: '/api/v1/styles/sty_moonlight/products' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
    // success() 信封：分页 meta 在 page 字段
    expect(body.page.totalHint).toBe(2);
  });

  it('无 Style 数据时 getStyle 返回 null（商品未归并语义，UI 不显示同款式模块）', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/styles/whatever' });
    expect(response.statusCode).toBe(404);
    const style = await repository.getStyle('whatever');
    expect(style).toBeNull();
  });
});
