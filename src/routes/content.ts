import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../http.js';
import { notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';

const feedQuerySchema = z.object({
  channel: z.enum(['', 'recommend', 'new', 'reservation', 'price_drop', 'outfit']).default(''),
  category: z.enum(['', 'JK', 'LOLITA', 'HANFU', 'OTHER']).default(''),
  cursor: z.string().max(64).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const searchQuerySchema = z.object({
  q: z.string().max(100).default(''),
  category: z.enum(['', 'JK', 'LOLITA', 'HANFU', 'OTHER']).default(''),
  saleStatus: z.enum(['', 'UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED']).default(''),
  releaseStatus: z.enum(['', 'first_release', 'rerelease', 'reservation', 'spot', 'lottery']).default(''),
  brandId: z.string().max(128).default(''),
  minPrice: z.coerce.number().int().min(0).default(0),
  maxPrice: z.coerce.number().int().min(0).default(0),
  cursor: z.string().max(64).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const trendQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
});

const productParamsSchema = z.object({ id: z.string().min(1).max(128) });

export async function registerContentRoutes(app: FastifyInstance, repository: AppRepository) {
  // 智能 Feed
  app.get('/api/v1/feed', async (request) => {
    const query = feedQuerySchema.parse(request.query);
    const result = await repository.listFeed(null, query);
    return success(request, result.items, {
      nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint,
    });
  });

  // 商品搜索
  app.get('/api/v1/search', async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const result = await repository.searchProducts(query);
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
