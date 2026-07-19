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
const productParamsSchema = z.object({ id: z.string().min(1).max(128) });

export async function registerContentRoutes(app: FastifyInstance, repository: AppRepository) {
  app.get('/api/v1/feed', async (request) => {
    const query = feedQuerySchema.parse(request.query);
    const result = await repository.listFeed(null, query);
    return success(request, result.items, {
      nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint,
    });
  });

  app.get('/api/v1/products/:id', async (request) => {
    const { id } = productParamsSchema.parse(request.params);
    const product = await repository.getProduct(null, id);
    if (!product) throw notFound('商品不存在');
    return success(request, product);
  });
}
