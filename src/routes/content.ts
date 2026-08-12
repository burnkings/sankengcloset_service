import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, requireUser } from '../http.js';
import { notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';

export const feedQuerySchema = z.object({
  channel: z.enum(['', 'recommend', 'new', 'reservation', 'price_drop', 'outfit']).default(''),
  category: z.enum(['', 'JK', 'LOLITA', 'HANFU', 'OTHER']).default(''),
  categories: z.string().max(200).default(''),
  cursor: z.string().max(64).default(''),
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
  cursor: z.string().max(64).default(''),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(50).default(20)),
});

export const trendQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
});

export const productParamsSchema = z.object({ id: z.string().min(1).max(128) });

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
    const product = await repository.getProduct(null, id);
    if (!product) throw notFound('商品不存在');
    return success(request, product);
  });
}
