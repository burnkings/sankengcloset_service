import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, requireUser } from '../http.js';
import { notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';

// ─── 收藏 API ──────────────────────────────────────────────

export const addFavoriteSchema = z.object({
  productId: z.string().min(1).max(128),
  releaseId: z.string().max(128).nullable().default(null),
  intentStatus: z.enum(['WANT', 'WATCHING', 'WAIT_RELEASE', 'WAIT_BALANCE', 'PURCHASED']).nullable().default(null),
  note: z.string().max(500).default(''),
});

export const updateFavoriteSchema = z.object({
  intentStatus: z.enum(['WANT', 'WATCHING', 'WAIT_RELEASE', 'WAIT_BALANCE', 'PURCHASED']).nullable().optional(),
  releaseId: z.string().max(128).nullable().optional(),
  note: z.string().max(500).optional(),
});

// ─── 品牌关注 API ──────────────────────────────────────────

export const followBrandSchema = z.object({
  brandId: z.string().min(1).max(128),
});

// ─── 注册路由 ──────────────────────────────────────────────

export async function registerInteractionRoutes(app: FastifyInstance, repository: AppRepository) {

  // ── 收藏（PRODUCT_FAVORITE） ──

  app.post('/api/v1/wishlist', async (request, reply) => {
    const userId = await requireUser(request);
    const body = addFavoriteSchema.parse(request.body);
    const interaction = await repository.addFavorite(userId, body.productId, body.releaseId, body.intentStatus, body.note);
    return reply.code(201).send({ data: interaction });
  });

  app.get('/api/v1/wishlist', async (request) => {
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    if (!userId) return success(request, []);
    const items = await repository.listFavorites(userId);
    return success(request, items);
  });

  app.patch('/api/v1/wishlist/:id', async (request) => {
    const userId = await requireUser(request);
    const { id } = request.params as { id: string };
    const body = updateFavoriteSchema.parse(request.body);
    const patch: { intentStatus?: string | null; releaseId?: string | null; note?: string } = {};
    if (body.intentStatus !== undefined) patch.intentStatus = body.intentStatus;
    if (body.releaseId !== undefined) patch.releaseId = body.releaseId;
    if (body.note !== undefined) patch.note = body.note;
    const result = await repository.updateFavorite(userId, id, patch);
    if (!result) throw notFound('收藏项不存在');
    return success(request, result);
  });

  app.delete('/api/v1/wishlist/:id', async (request, reply) => {
    const userId = await requireUser(request);
    const { id } = request.params as { id: string };
    const removed = await repository.removeFavorite(userId, id);
    if (!removed) throw notFound('收藏项不存在');
    return reply.code(204).send();
  });

  // ── 品牌关注 ──

  app.post('/api/v1/brands/follow', async (request, reply) => {
    const userId = await requireUser(request);
    const body = followBrandSchema.parse(request.body);
    const interaction = await repository.followBrand(userId, body.brandId);
    return reply.code(201).send({ data: interaction });
  });

  app.delete('/api/v1/brands/:brandId/follow', async (request, reply) => {
    const userId = await requireUser(request);
    const { brandId } = request.params as { brandId: string };
    const removed = await repository.unfollowBrand(userId, brandId);
    if (!removed) throw notFound('未关注该品牌');
    return reply.code(204).send();
  });

  app.get('/api/v1/brands/followed', async (request) => {
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    if (!userId) return success(request, []);
    const brandIds = await repository.getFollowedBrandIds(userId);
    return success(request, brandIds);
  });

  // ── 事件 API (no-op for backwards compat) ──

  app.post('/api/v1/events', async (request, reply) => {
    return reply.code(201).send({ data: { id: 'noop', createdAt: new Date().toISOString() } });
  });

  app.get('/api/v1/events', async (request) => {
    return success(request, []);
  });
}
