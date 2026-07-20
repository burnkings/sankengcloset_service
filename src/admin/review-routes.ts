// src/admin/review-routes.ts — 审核 API 路由

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import postgres from 'postgres';
import { adminAuthHook, getAdminUserId } from './auth.js';

const approveSchema = z.object({ reason: z.string().max(500).default('审核通过') });
const rejectSchema = z.object({ reason: z.string().min(1).max(500) });
const mergeSchema = z.object({ targetId: z.string().min(1), reason: z.string().max(500).default('合并商品') });
const editSchema = z.object({
  displayName: z.string().min(1).max(300).optional(),
  currentPrice: z.number().int().min(0).optional(),
  saleStatus: z.enum(['UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED']).optional(),
  description: z.string().max(5000).optional(),
  pitType: z.enum(['JK', 'LOLITA', 'HANFU', 'OTHER']).optional(),
  category: z.string().max(100).optional(),
});

export async function registerReviewRoutes(app: FastifyInstance, sql: postgres.Sql) {
  // 所有审核路由需要认证
  app.addHook('preHandler', adminAuthHook);

  // GET /api/admin/review/pending — 待审核列表
  app.get('/api/admin/review/pending', async (request) => {
    const query = (request.query as any) || {};
    const limit = Math.min(Number(query.limit) || 20, 100);
    const offset = Number(query.offset) || 0;

    const items = await sql`
      SELECT p.id, p.canonical_name, p.display_name, p.pit_type, p.category,
        p.current_price, p.original_price, p.sale_status, p.review_status,
        p.source_url, p.source_platform, p.cover_url, p.confidence,
        p.created_at, p.updated_at,
        b.name as brand_name
      FROM products p LEFT JOIN brands b ON p.brand_id = b.id
      WHERE p.review_status = 'PENDING' AND p.deleted_at IS NULL
      ORDER BY p.confidence ASC, p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = await sql`SELECT count(*) as cnt FROM products WHERE review_status = 'PENDING' AND deleted_at IS NULL`;

    return { items, total: Number((total[0] ?? { cnt: 0 }).cnt), limit, offset };
  });

  // GET /api/admin/review/:id — 商品详情
  app.get('/api/admin/review/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const items = await sql`
      SELECT p.*, b.name as brand_name, b.official_url as brand_url
      FROM products p LEFT JOIN brands b ON p.brand_id = b.id
      WHERE p.id = ${id} AND p.deleted_at IS NULL
    `;
    if (items.length === 0) return reply.code(404).send({ error: '商品不存在' });
    const product = items[0];

    // 获取来源记录
    const sources = await sql`SELECT * FROM source_records WHERE entity_id = ${id} ORDER BY created_at DESC`;

    // 获取审核记录
    const reviews = await sql`SELECT * FROM review_records WHERE entity_id = ${id} ORDER BY created_at DESC LIMIT 10`;

    // 获取价格历史
    const prices = await sql`SELECT * FROM price_snapshots WHERE product_id = ${id} ORDER BY fetched_at DESC LIMIT 10`;

    return { product, sources, reviews, prices };
  });

  // POST /api/admin/review/:id/approve — 通过
  app.post('/api/admin/review/:id/approve', async (request) => {
    const { id } = request.params as { id: string };
    const body = approveSchema.parse(request.body);
    const userId = getAdminUserId(request);

    await sql`UPDATE products SET review_status = 'APPROVED', updated_at = now() WHERE id = ${id}`;
    await sql`
      INSERT INTO review_records (id, entity_type, entity_id, action, reason, reviewer_id)
      VALUES (${`rev_${Date.now()}`}, 'product', ${id}, 'approve', ${body.reason}, ${userId})
    `;
    return { success: true };
  });

  // POST /api/admin/review/:id/reject — 驳回
  app.post('/api/admin/review/:id/reject', async (request) => {
    const { id } = request.params as { id: string };
    const body = rejectSchema.parse(request.body);
    const userId = getAdminUserId(request);

    await sql`UPDATE products SET review_status = 'REJECTED', updated_at = now() WHERE id = ${id}`;
    await sql`
      INSERT INTO review_records (id, entity_type, entity_id, action, reason, reviewer_id)
      VALUES (${`rev_${Date.now()}`}, 'product', ${id}, 'reject', ${body.reason}, ${userId})
    `;
    return { success: true };
  });

  // POST /api/admin/review/:id/edit — 编辑
  app.post('/api/admin/review/:id/edit', async (request) => {
    const { id } = request.params as { id: string };
    const body = editSchema.parse(request.body);
    const userId = getAdminUserId(request);

    const updates: string[] = [];
    const changes: Record<string, unknown> = {};
    if (body.displayName !== undefined) { updates.push(`display_name = '${body.displayName}'`); changes.displayName = body.displayName; }
    if (body.currentPrice !== undefined) { updates.push(`current_price = ${body.currentPrice}`); changes.currentPrice = body.currentPrice; }
    if (body.saleStatus !== undefined) { updates.push(`sale_status = '${body.saleStatus}'`); changes.saleStatus = body.saleStatus; }
    if (body.description !== undefined) { updates.push(`description = '${body.description}'`); changes.description = body.description; }
    if (body.pitType !== undefined) { updates.push(`pit_type = '${body.pitType}'`); changes.pitType = body.pitType; }
    if (body.category !== undefined) { updates.push(`category = '${body.category}'`); changes.category = body.category; }

    if (updates.length === 0) return { success: true, message: '无修改' };

    await sql.unsafe(`UPDATE products SET ${updates.join(', ')}, updated_at = now() WHERE id = '${id}'`);
    await sql`
      INSERT INTO review_records (id, entity_type, entity_id, action, field_changes, reason, reviewer_id)
      VALUES (${`rev_${Date.now()}`}, 'product', ${id}, 'correct', ${JSON.stringify(changes)}, '字段编辑', ${userId})
    `;
    return { success: true, changes };
  });

  // POST /api/admin/review/:id/merge — 合并
  app.post('/api/admin/review/:id/merge', async (request) => {
    const { id } = request.params as { id: string };
    const body = mergeSchema.parse(request.body);
    const userId = getAdminUserId(request);
    const targetId = body.targetId;

    // 获取源商品
    const source = await sql`SELECT * FROM products WHERE id = ${id} AND deleted_at IS NULL`;
    if (source.length === 0) return { error: '源商品不存在' };

    // 合并图片
    const sourceImages = (source[0] ?? {}).images ?? [];
    const target = await sql`SELECT images FROM products WHERE id = ${targetId} AND deleted_at IS NULL`;
    if (target.length === 0) return { error: '目标商品不存在' };
    const targetImages = (target[0] ?? {}).images ?? [];
    const mergedImages = [...new Set([...targetImages, ...sourceImages])];

    await sql`UPDATE products SET images = ${mergedImages}, updated_at = now() WHERE id = ${targetId}`;
    await sql`UPDATE products SET data_status = 'DELETED', deleted_at = now() WHERE id = ${id}`;

    await sql`
      INSERT INTO review_records (id, entity_type, entity_id, action, field_changes, reason, reviewer_id)
      VALUES (${`rev_${Date.now()}`}, 'product', ${id}, 'merge', ${JSON.stringify({ targetId, mergedImages: mergedImages.length })}, ${body.reason}, ${userId})
    `;
    return { success: true, targetId, mergedImages: mergedImages.length };
  });

  // POST /api/admin/review/:id/retire — 标记下架
  app.post('/api/admin/review/:id/retire', async (request) => {
    const { id } = request.params as { id: string };
    const userId = getAdminUserId(request);

    await sql`UPDATE products SET sale_status = 'ENDED', review_status = 'APPROVED', updated_at = now() WHERE id = ${id}`;
    await sql`
      INSERT INTO review_records (id, entity_type, entity_id, action, reason, reviewer_id)
      VALUES (${`rev_${Date.now()}`}, 'product', ${id}, 'retire', '标记下架', ${userId})
    `;
    return { success: true };
  });

  // GET /api/admin/review/errors — 采集错误
  app.get('/api/admin/review/errors', async () => {
    const jobs = await sql`
      SELECT id, source_type, source_url, status, error_message, items_total, items_success, items_failed, created_at
      FROM crawl_jobs WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 20
    `;
    return { errors: jobs };
  });

  // POST /api/admin/login — 简单登录
  app.post('/api/admin/login', async (request) => {
    const { username, password } = (request.body as any) ?? {};
    if (username === 'admin' && password === (process.env.ADMIN_PASSWORD ?? 'sankeng2025')) {
      const { createAdminToken } = await import('./auth.js');
      const token = createAdminToken(username);
      return { token, userId: username };
    }
    return { error: '用户名或密码错误' };
  });
}
