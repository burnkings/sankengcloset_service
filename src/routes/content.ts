import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, requireUser } from '../http.js';
import { notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';

export const feedQuerySchema = z.object({
  channel: z.enum(['', 'recommend', 'new', 'reservation', 'spot', 'price_drop', 'outfit']).default(''),
  category: z.enum(['', 'JK', 'LOLITA', 'HANFU', 'OTHER']).default(''),
  categories: z.string().max(200).default(''),
  cursor: z.string().max(512).default(''),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(50).default(20)),
});

export const searchQuerySchema = z.object({
  q: z.string().max(100).default(''),
  category: z.enum(['', 'JK', 'LOLITA', 'HANFU', 'OTHER']).default(''),
  saleStatus: z.enum(['', 'UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED']).default(''),
  releaseStatus: z.enum(['', 'first_release', 'rerelease', 'reservation', 'spot', 'lottery']).default(''),
  brandId: z.string().max(128).default(''),
  minPrice: z.coerce.number().int().min(0).default(0),
  maxPrice: z.coerce.number().int().min(0).default(0),
  cursor: z.string().max(512).default(''),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(50).default(20)),
});

export const productParamsSchema = z.object({ id: z.string().min(1).max(128) });

export const productCommunityQuerySchema = z.object({
  cursor: z.string().max(512).default(''),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(20).default(4)),
});

async function enrichWithPersonalScore(
  items: Awaited<ReturnType<AppRepository['listFeed']>>['items'],
  userId: string | null,
  repository: AppRepository,
) {
  if (!userId) {
    return items.map(item => ({ ...item, personalScore: 0, matchReason: '', finalScore: item.feedScore }));
  }
  return Promise.all(items.map(async (item) => {
    const result = await repository.computePersonalScore({
      userId, productId: item.entityId, brandId: item.brandId, category: item.category, tags: item.tags,
    });
    const finalScore = Math.round(item.feedScore * 0.7 + result.personalScore * 0.3);
    return { ...item, personalScore: result.personalScore, matchReason: result.matchReason, finalScore };
  }));
}

export async function registerContentRoutes(app: FastifyInstance, repository: AppRepository) {
  // 智能 Feed
  app.get('/api/v1/feed', async (request) => {
    const query = feedQuerySchema.parse(request.query);
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    const result = await repository.listFeed(userId, query);
    const enriched = await enrichWithPersonalScore(result.items, userId, repository);
    return success(request, enriched, {
      nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint,
    });
  });

  // 商品搜索
  app.get('/api/v1/search', async (request) => {
    const query = searchQuerySchema.parse(request.query);
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    const result = await repository.searchProducts(query, userId);
    return success(request, result.items, {
      nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint,
    });
  });

  // 商品详情
  app.get('/api/v1/products/:id', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    const q = request.query as Record<string, unknown>;
    const releaseId = typeof q.releaseId === 'string' && q.releaseId !== '' ? q.releaseId : undefined;
    const product = await repository.getProduct(null, id, releaseId, true);
    if (!product) throw notFound('商品不存在');
    return success(request, product);
  });

  // 商品关联社区内容
  app.get('/api/v1/products/:id/community', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    const product = await repository.getProduct(null, id);
    if (!product) throw notFound('商品不存在');
    const query = productCommunityQuerySchema.parse(request.query);
    const result = await repository.listProductCommunityPosts(id, query);
    return success(request, result.items, { nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint });
  });

  // 品牌目录
  app.get('/api/v1/brands', async (request) => {
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    const brands = await repository.listBrands(userId);
    return success(request, brands, { totalHint: brands.length });
  });

  app.get('/api/v1/brands/:id', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    const brand = await repository.getBrandById(id, userId);
    if (!brand) throw notFound('品牌不存在');
    return success(request, brand);
  });

  app.get('/api/v1/brands/:id/products', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    const brand = await repository.getBrandById(id);
    if (!brand) throw notFound('品牌不存在');
    const q = request.query as Record<string, unknown>;
    const limit = typeof q.limit === 'string' && q.limit !== '' ? Number(q.limit) : 50;
    const products = await repository.listBrandProducts(id, Number.isFinite(limit) ? limit : 50);
    return success(request, products, { totalHint: products.length });
  });

  // 三坑榜单
  app.get('/api/v1/ranking', async (request) => {
    const q = request.query as Record<string, unknown>;
    const tab = q.tab === 'new' ? 'new' : q.tab === 'favorite' ? 'favorite' : 'hot';
    const rawLimit = typeof q.limit === 'string' && q.limit !== '' ? Number(q.limit) : 50;
    const items = await repository.getRanking(tab, Number.isFinite(rawLimit) ? rawLimit : 50);
    return success(request, items, { totalHint: items.length });
  });

  // 趋势数据 - removed (no trend tables)
  app.get('/api/v1/trends', async (request) => {
    return success(request, { brandTrends: [], productTrends: [], generatedAt: new Date().toISOString() });
  });

  // 款式 - removed (no styles table), return 404 for backwards compat
  app.get('/api/v1/styles/:id', async (_request, _reply) => {
    throw notFound('款式功能已移除');
  });

  app.get('/api/v1/styles/:id/products', async (_request, _reply) => {
    throw notFound('款式功能已移除');
  });
}

