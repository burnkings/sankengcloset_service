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

export const trendQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
});

export const productParamsSchema = z.object({ id: z.string().min(1).max(128) });

/** Phase 2.3-A：商品关联社区内容分页（商品详情「真实买家」模块） */
export const productCommunityQuerySchema = z.object({
  cursor: z.string().max(512).default(''),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(20).default(4)),
});

/**
 * 为 Feed 项附加个性化评分
 */
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
      userId,
      productId: item.entityId,
      brandId: item.brandId,
      category: item.category,
      tags: item.tags,
    });
    const finalScore = Math.round(item.feedScore * 0.7 + result.personalScore * 0.3);
    return { ...item, personalScore: result.personalScore, matchReason: result.matchReason, finalScore };
  }));
}

export async function registerContentRoutes(app: FastifyInstance, repository: AppRepository) {
  // 智能 Feed（支持个性化）
  app.get('/api/v1/feed', async (request) => {
    const query = feedQuerySchema.parse(request.query);
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    const result = await repository.listFeed(userId, query);
    const enriched = await enrichWithPersonalScore(result.items, userId, repository);
    // 仓库已按稳定 keyset 顺序分页；不得在单页内二次排序破坏游标语义。
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

  // 趋势数据
  app.get('/api/v1/trends', async (request) => {
    const query = trendQuerySchema.parse(request.query);
    const result = await repository.getTrendSummary(query.period);
    return success(request, result);
  });

  // 商品详情
  app.get('/api/v1/products/:id', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    // 可选 releaseId：收藏条目锚定的具体批次（未传则取最新一条 currentRelease）
    const q = request.query as Record<string, unknown>;
    const releaseId = typeof q.releaseId === 'string' && q.releaseId !== '' ? q.releaseId : undefined;
    const product = await repository.getProduct(null, id, releaseId);
    if (!product) throw notFound('商品不存在');
    return success(request, product);
  });

  // Phase 2.3-A：商品关联社区内容（「真实买家」模块数据源；游客可读）
  app.get('/api/v1/products/:id/community', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    const product = await repository.getProduct(null, id);
    if (!product) throw notFound('商品不存在');
    const query = productCommunityQuerySchema.parse(request.query);
    const result = await repository.listProductCommunityPosts(id, query);
    return success(request, result.items, { nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint });
  });

  // 款式详情（Phase 2.1 Style Entity MVP）：基础信息 + 关联商品
  app.get('/api/v1/styles/:id', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    const style = await repository.getStyle(id);
    if (!style) throw notFound('款式不存在');
    return success(request, style);
  });

  // 款式关联商品（与 /styles/:id 共用数据，独立端点便于只取商品列表）
  app.get('/api/v1/styles/:id/products', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    const style = await repository.getStyle(id);
    if (!style) throw notFound('款式不存在');
    return success(request, style.products, { totalHint: style.productCount });
  });

  // Phase 2.6: 品牌目录
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

  // Phase 2.6: 三坑榜单（hot 热榜 / new 上新榜）
  app.get('/api/v1/ranking', async (request) => {
    const q = request.query as Record<string, unknown>;
    const tab = q.tab === 'new' ? 'new' : 'hot';
    const rawLimit = typeof q.limit === 'string' && q.limit !== '' ? Number(q.limit) : 50;
    const items = await repository.getRanking(tab, Number.isFinite(rawLimit) ? rawLimit : 50);
    return success(request, items, { totalHint: items.length });
  });
}
