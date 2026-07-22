import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, requireUser } from '../http.js';
import { notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';
import type { UserEventType, WishlistStatus } from '../types.js';

// ─── 事件 API ──────────────────────────────────────────────

const VALID_EVENT_TYPES = new Set<UserEventType>([
  'VIEW_PRODUCT', 'VIEW_RELEASE', 'LIKE_PRODUCT', 'SAVE_PRODUCT',
  'FOLLOW_BRAND', 'SEARCH', 'SHARE', 'CLICK_PRICE_ALERT', 'CLICK_BUY',
]);

const createEventSchema = z.object({
  eventType: z.string().refine(t => VALID_EVENT_TYPES.has(t as UserEventType), { message: '无效的事件类型' }),
  targetType: z.string().min(1).max(32),
  targetId: z.string().max(128).default(''),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).refine(
  data => JSON.stringify(data.metadata).length <= 2048,
  { message: 'metadata 不能超过 2KB' },
);

const getEventsSchema = z.object({
  eventType: z.string().max(32).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ─── 收藏 API ──────────────────────────────────────────────

const VALID_WISH_STATUSES = new Set<WishlistStatus>([
  'WISH', 'WANT', 'WATCHING', 'WAIT_RELEASE', 'WAIT_PRICE', 'PURCHASED',
]);

const addWishlistSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(['WISH', 'WANT', 'WATCHING', 'WAIT_RELEASE', 'WAIT_PRICE', 'PURCHASED']),
  productId: z.string().max(128).nullable().default(null),
  releaseId: z.string().max(128).nullable().default(null),
  note: z.string().max(500).default(''),
});

const updateWishlistSchema = z.object({
  status: z.string().refine(s => VALID_WISH_STATUSES.has(s as WishlistStatus), '无效的收藏状态'),
});

const wishlistQuerySchema = z.object({
  status: z.string().max(32).default(''),
});

// ─── 品牌关注 API ──────────────────────────────────────────

const followBrandSchema = z.object({
  brandId: z.string().min(1).max(128),
});

// ─── 注册路由 ──────────────────────────────────────────────

export async function registerInteractionRoutes(app: FastifyInstance, repository: AppRepository) {

  // ── 事件 ──

  app.post('/api/v1/events', async (request, reply) => {
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿容 */ }
    const body = createEventSchema.parse(request.body);
    const event = await repository.recordEvent(userId, {
      eventType: body.eventType as UserEventType,
      targetType: body.targetType,
      targetId: body.targetId,
      metadata: body.metadata,
    });
    return reply.code(201).send({ data: event });
  });

  app.get('/api/v1/events', async (request) => {
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    if (!userId) return success(request, []);
    const query = getEventsSchema.parse(request.query);
    const events = await repository.getUserEvents(userId, query.eventType || undefined, query.limit);
    return success(request, events);
  });

  // ── 收藏 ──

  app.post('/api/v1/wishlist', async (request, reply) => {
    const userId = await requireUser(request);
    const body = addWishlistSchema.parse(request.body);
    const item = await repository.addWishlist(userId, body);
    return reply.code(201).send({ data: item });
  });

  app.get('/api/v1/wishlist', async (request) => {
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    if (!userId) return success(request, []);
    const query = wishlistQuerySchema.parse(request.query);
    const items = await repository.listWishlist(userId, query.status || undefined);
    return success(request, items);
  });

  app.patch('/api/v1/wishlist/:id', async (request) => {
    const userId = await requireUser(request);
    const { id } = request.params as { id: string };
    const body = updateWishlistSchema.parse(request.body);
    const item = await repository.updateWishlistStatus(id, userId, body.status);
    return success(request, item);
  });

  app.delete('/api/v1/wishlist/:id', async (request, reply) => {
    const userId = await requireUser(request);
    const { id } = request.params as { id: string };
    const removed = await repository.removeWishlist(id, userId);
    if (!removed) throw notFound('收藏项不存在');
    return reply.code(204).send();
  });

  // ── 品牌关注 ──

  app.post('/api/v1/brands/follow', async (request, reply) => {
    const userId = await requireUser(request);
    const body = followBrandSchema.parse(request.body);
    const follower = await repository.followBrand(userId, body.brandId);
    return reply.code(201).send({ data: follower });
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
}
