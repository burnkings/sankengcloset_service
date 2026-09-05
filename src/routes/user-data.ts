import type { FastifyInstance } from 'fastify';
import { z, type ZodType } from 'zod';
import type { AppConfig } from '../config.js';
import { requireUser, success } from '../http.js';
import { newId } from '../lib/id.js';
import { AppProblem, conflict, notFound } from '../lib/problem.js';
import type { AppRepository, CommunityPostQuery, UserAssetKind } from '../repositories/contracts.js';

export const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'id 格式不正确');
export const assetParamsSchema = z.object({ id: idSchema });
export const pageSchema = z.object({
  cursor: z.string().max(64).default(''),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(50).default(20)),
});

export const wardrobeSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  category: z.enum(['JK', 'LOLITA', 'HANFU', 'OTHER']),
  style: z.string().max(100).default(''),
  brand: z.string().max(120).default(''),
  color: z.string().max(80).default(''),
  size: z.string().max(80).default(''),
  wearStatus: z.enum(['UNWORN', 'WORN', 'IDLE']).default('UNWORN'),
  seasons: z.array(z.string().max(40)).max(12).default([]),
  images: z.array(z.string().max(512)).max(12).default([]),
  tags: z.array(z.string().max(40)).max(30).default([]),
  purchaseDate: z.string().max(32).default(''),
  purchasePrice: z.number().int().min(0).max(100_000_000).default(0),
  purchaseSource: z.string().max(120).default(''),
  purchaseId: idSchema.or(z.literal('')).default(''),
  wishId: idSchema.or(z.literal('')).default(''),
  note: z.string().max(2_000).default(''),
  isFavorite: z.boolean().default(false),
});

export const purchaseSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  brand: z.string().max(120).default(''),
  shopName: z.string().max(120).default(''),
  category: z.enum(['JK', 'LOLITA', 'HANFU', 'OTHER']).default('OTHER'),
  // 规格字段（金额一律整数分）：orderNumber/totalCents/depositCents/paidCents/balanceDueDate/arrivalDate/status
  orderNumber: z.string().max(64).default(''),
  totalCents: z.number().int().min(0).max(100_000_000).default(0),
  depositCents: z.number().int().min(0).max(100_000_000).default(0),
  paidCents: z.number().int().min(0).max(100_000_000).default(0),
  remainingCents: z.number().int().min(0).max(100_000_000).default(0),
  balanceDueDate: z.string().max(32).default(''),
  arrivalDate: z.string().max(32).default(''),
  status: z.string().max(32).default(''),
  // 图片/媒体关联（订单截图 mediaId 或公开 imageUrl）
  mediaId: idSchema.optional(),
  image: z.string().max(512).default(''),
  // 兼容旧前端字段
  totalAmount: z.number().int().min(0).max(100_000_000).default(0),
  depositAmount: z.number().int().min(0).max(100_000_000).default(0),
  paidAmount: z.number().int().min(0).max(100_000_000).default(0),
  remainingAmount: z.number().int().min(0).max(100_000_000).default(0),
  paymentStatus: z.enum(['PRE_ORDER', 'DEPOSIT_PAID', 'BALANCE_PENDING', 'COMPLETED', 'CANCELLED']).default('PRE_ORDER'),
  purchaseDate: z.string().max(32).default(''),
  deadline: z.string().max(32).default(''),
  wishId: idSchema.or(z.literal('')).default(''),
  wardrobeId: idSchema.or(z.literal('')).default(''),
  productId: idSchema.or(z.literal('')).default(''),
  releaseId: idSchema.or(z.literal('')).default(''),
  note: z.string().max(2_000).default(''),
  isFavorite: z.boolean().default(false),
});

export const reminderSchema = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(1).max(160),
  type: z.enum(['ARRIVAL', 'BALANCE', 'RELEASE', 'OUTFIT', 'PHOTO', 'ORGANIZE', 'WISH', 'CHECKIN', 'CUSTOM']).default('CUSTOM'),
  remindDate: z.string().min(1).max(32),
  remindTime: z.string().max(16).default(''),
  isAllDay: z.boolean().default(false),
  relatedPurchaseId: idSchema.or(z.literal('')).default(''),
  relatedWishId: idSchema.or(z.literal('')).default(''),
  // Phase 1.1-C：商品锚 + 批次锚（user_assets jsonb 透传，零 migration；旧数据缺省为空串兼容）
  productId: idSchema.or(z.literal('')).default(''),
  relatedReleaseId: idSchema.or(z.literal('')).default(''),
  wardrobeBindings: z.array(idSchema).max(50).default([]),
  note: z.string().max(2_000).default(''),
  status: z.enum(['PENDING', 'DONE', 'MISSED']).default('PENDING'),
});

export const wishSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  coverImage: z.string().max(512).default(''),
  brand: z.string().max(120).default(''),
  estimatedPrice: z.number().int().min(0).max(100_000_000).default(0),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  status: z.enum(['WISH', 'WATCHING', 'DECIDED', 'PURCHASED', 'PAUSED', 'CANCELED']).default('WISH'),
  source: z.enum(['MANUAL', 'AI_IMPORT', 'DISCOVERY']).default('MANUAL'),
  wardrobeId: idSchema.or(z.literal('')).default(''),
  purchaseId: idSchema.or(z.literal('')).default(''),
  convertedAt: z.string().max(40).default(''),
  note: z.string().max(2_000).default(''),
  url: z.string().max(1_000).default(''),
  isFavorite: z.boolean().default(false),
});

export const notificationSchema = z.object({
  id: idSchema.optional(),
  type: z.string().min(1).max(40),
  title: z.string().min(1).max(160),
  body: z.string().max(2_000).default(''),
  actionTarget: z.string().max(512).default(''),
  read: z.boolean().default(false),
});

export const preferenceSchema = z.object({
  pitTypes: z.array(z.enum(['JK', 'LOLITA', 'HANFU'])).max(3).default([]),
  followedBrands: z.array(z.string().max(128)).max(200).default([]),
  priceRange: z.string().max(40).default('all'),
  themeMode: z.enum(['system', 'light', 'dark']).default('system'),
});

export const budgetSchema = z.object({
  monthlyLimit: z.number().int().min(0).max(100_000_000),
  alertPercent: z.number().int().min(1).max(100),
});

export const postCreateSchema = z.object({
  mediaId: idSchema,
  caption: z.string().trim().max(600).default(''),
  category: z.enum(['JK', 'LOLITA', 'HANFU', 'MIXED']),
  topic: z.string().trim().max(80).default(''),
  // Phase 2.3-A：可选商品关联（可空）；非空时服务端校验商品存在且已发布
  productId: z.string().trim().min(1).max(128).nullable().optional(),
});
export const postParamsSchema = z.object({ id: idSchema });
export const postLikeSchema = z.object({ liked: z.boolean() });
export const postQuerySchema = pageSchema.extend({
  category: z.enum(['', 'JK', 'LOLITA', 'HANFU', 'MIXED']).default(''),
  topic: z.string().trim().max(80).default(''),
});

type AssetDefinition = {
  path: string;
  kind: UserAssetKind;
  prefix: string;
  createSchema: ZodType;
  updateSchema: ZodType;
};

function assetResponse(asset: { id: string; payload: Record<string, unknown>; version: number; createdAt: string; updatedAt: string }) {
  return { ...asset.payload, id: asset.id, version: asset.version, createdAt: asset.createdAt, updatedAt: asset.updatedAt };
}

function registerAssetRoutes(app: FastifyInstance, repository: AppRepository, definition: AssetDefinition) {
  app.get(`/api/v1/me/${definition.path}`, async (request) => {
    const userId = await requireUser(request);
    const assets = await repository.listUserAssets(userId, definition.kind);
    return success(request, assets.map(assetResponse));
  });

  app.get(`/api/v1/me/${definition.path}/:id`, async (request) => {
    const userId = await requireUser(request);
    const { id } = assetParamsSchema.parse(request.params);
    const asset = await repository.getUserAsset(userId, definition.kind, id);
    if (!asset) throw notFound('记录不存在');
    return success(request, assetResponse(asset));
  });

  app.post(`/api/v1/me/${definition.path}`, async (request, reply) => {
    const userId = await requireUser(request);
    const parsed = definition.createSchema.parse(request.body) as Record<string, unknown>;
    const requestedId = typeof parsed.id === 'string' ? parsed.id : newId(definition.prefix);
    delete parsed.id;
    if (await repository.getUserAsset(userId, definition.kind, requestedId)) throw conflict('记录已经存在');
    const asset = await repository.createUserAsset(userId, definition.kind, requestedId, parsed);
    return reply.code(201).send(success(request, assetResponse(asset)));
  });

  app.patch(`/api/v1/me/${definition.path}/:id`, async (request) => {
    const userId = await requireUser(request);
    const { id } = assetParamsSchema.parse(request.params);
    const patch = definition.updateSchema.parse(request.body) as Record<string, unknown>;
    delete patch.id;
    const asset = await repository.updateUserAsset(userId, definition.kind, id, patch);
    if (!asset) throw notFound('记录不存在');
    return success(request, assetResponse(asset));
  });

  app.delete(`/api/v1/me/${definition.path}/:id`, async (request, reply) => {
    const userId = await requireUser(request);
    const { id } = assetParamsSchema.parse(request.params);
    if (!(await repository.deleteUserAsset(userId, definition.kind, id))) throw notFound('记录不存在');
    return reply.code(204).send();
  });
}

export async function registerUserDataRoutes(app: FastifyInstance, config: AppConfig, repository: AppRepository) {
  const assets: AssetDefinition[] = [
    { path: 'wardrobe', kind: 'wardrobe', prefix: 'wd', createSchema: wardrobeSchema, updateSchema: wardrobeSchema.partial() },
    { path: 'purchases', kind: 'purchase', prefix: 'pur', createSchema: purchaseSchema, updateSchema: purchaseSchema.partial() },
    { path: 'reminders', kind: 'reminder', prefix: 'rem', createSchema: reminderSchema, updateSchema: reminderSchema.partial() },
    { path: 'wishes', kind: 'wish', prefix: 'wish', createSchema: wishSchema, updateSchema: wishSchema.partial() },
    { path: 'notifications', kind: 'notification', prefix: 'not', createSchema: notificationSchema, updateSchema: notificationSchema.partial() },
  ];
  for (const asset of assets) registerAssetRoutes(app, repository, asset);

  // 通知生成：基于用户 reminders/purchases/关注品牌 生成真实通知（幂等，可重复调用）
  app.post('/api/v1/me/notifications:generate', async (request) => {
    const userId = await requireUser(request);
    const items = await repository.generateNotifications(userId);
    return success(request, items);
  });

  app.get('/api/v1/me/budget', async (request) => {
    const userId = await requireUser(request);
    return success(request, await repository.getUserSetting(userId, 'budget'));
  });
  app.put('/api/v1/me/budget', async (request) => {
    const userId = await requireUser(request);
    const payload = budgetSchema.parse(request.body);
    return success(request, await repository.putUserSetting(userId, 'budget', payload));
  });

  app.get('/api/v1/me/preferences', async (request) => {
    const userId = await requireUser(request);
    return success(request, await repository.getUserSetting(userId, 'preferences'));
  });
  app.put('/api/v1/me/preferences', async (request) => {
    const userId = await requireUser(request);
    const payload = preferenceSchema.parse(request.body);
    return success(request, await repository.putUserSetting(userId, 'preferences', payload));
  });

  app.get('/api/v1/community/posts', async (request) => {
    let viewerUserId: string | null = null;
    try { viewerUserId = await requireUser(request); } catch { /* public read */ }
    const query = postQuerySchema.parse(request.query);
    const result = await repository.listCommunityPosts(viewerUserId, query);
    return success(request, result.items, { nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint });
  });

  app.get('/api/v1/me/community/posts', async (request) => {
    const userId = await requireUser(request);
    const query = pageSchema.parse(request.query);
    const result = await repository.listMyCommunityPosts(userId, query);
    return success(request, result.items, { nextCursor: result.nextCursor, hasMore: result.hasMore, totalHint: result.totalHint });
  });

  app.post('/api/v1/community/posts', async (request, reply) => {
    const userId = await requireUser(request);
    const body = postCreateSchema.parse(request.body);
    const media = await repository.getMediaById(body.mediaId);
    if (!media || media.ownerUserId !== userId || media.deletedAt !== null || media.sizeBytes <= 0 || media.purpose !== 'outfit') {
      throw new AppProblem(400, 'VALIDATION_FAILED', '请先上传有效的穿搭图片', false);
    }
    // Phase 2.3-A：productId 非空时校验商品存在且已发布（不存在的商品明确拒绝，不静默创建）
    let productId: string | null = null;
    if (body.productId != null && body.productId !== '') {
      const product = await repository.getProduct(null, body.productId);
      if (!product) throw new AppProblem(400, 'VALIDATION_FAILED', '关联的商品不存在或未发布', false);
      productId = body.productId;
    }
    const post = await repository.createCommunityPost(userId, {
      id: newId('post'),
      mediaId: media.id,
      imageUrl: `${config.PUBLIC_BASE_URL}/api/v1/media/${media.id}`,
      caption: body.caption,
      category: body.category,
      topic: body.topic,
      productId,
    });
    return reply.code(201).send(success(request, post));
  });

  app.get('/api/v1/community/posts/:id', async (request) => {
    let viewerUserId: string | null = null;
    try { viewerUserId = await requireUser(request); } catch { /* public read */ }
    const { id } = postParamsSchema.parse(request.params);
    const post = await repository.getCommunityPost(viewerUserId, id);
    if (!post) throw notFound('动态不存在');
    return success(request, post);
  });

  app.put('/api/v1/community/posts/:id/like', async (request) => {
    const userId = await requireUser(request);
    const { id } = postParamsSchema.parse(request.params);
    const { liked } = postLikeSchema.parse(request.body);
    const result = await repository.setCommunityPostLike(userId, id, liked);
    if (!result) throw notFound('动态不存在');
    return success(request, result);
  });

  app.delete('/api/v1/community/posts/:id', async (request, reply) => {
    const userId = await requireUser(request);
    const { id } = postParamsSchema.parse(request.params);
    if (!(await repository.deleteCommunityPost(userId, id))) throw notFound('动态不存在或无权删除');
    return reply.code(204).send();
  });
}
