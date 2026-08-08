// routes/review.ts — 商品审核路由
// 审核流：Crawler → draft → Directus审核 → published → Feed API

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../http.js';
import { notFound, badRequest } from '../lib/problem.js';
import type postgres from 'postgres';

const visibilityStatuses = ['draft', 'reviewing', 'published', 'hidden'] as const;

export const updateVisibilitySchema = z.object({
  visibility_status: z.enum(visibilityStatuses),
});

export const batchUpdateSchema = z.object({
  product_ids: z.array(z.string().min(1).max(128)).min(1).max(100),
  visibility_status: z.enum(visibilityStatuses),
});

export async function registerReviewRoutes(app: FastifyInstance, sql: postgres.Sql) {
  // ── 单个商品状态更新 ──
  app.patch<{ Params: { id: string }; Body: { visibility_status: string } }>(
    '/api/v1/review/products/:id/visibility',
    async (request) => {
      const { id } = request.params;
      const body = updateVisibilitySchema.parse(request.body);

      // 验证商品存在
      const existing = await sql`SELECT id, visibility_status FROM products WHERE id = ${id} AND deleted_at IS NULL`;
      if (existing.length === 0) throw notFound('商品不存在');

      // 记录原始状态（审核日志）
      const oldStatus = existing[0]!.visibility_status;

      // 更新状态
      await sql`
        UPDATE products SET
          visibility_status = ${body.visibility_status},
          updated_at = now()
        WHERE id = ${id}
      `;

      // 写入审核记录
      await sql`
        INSERT INTO review_records (id, entity_type, entity_id, action, old_value, new_value, reviewer, notes)
        VALUES (${`rev_${id}_${Date.now()}`}, 'product', ${id}, 'visibility_change',
          ${String(oldStatus)}, ${body.visibility_status}, 'system', ${`从 ${oldStatus} 变更为 ${body.visibility_status}`})
      `;

      return success(request, {
        id,
        old_visibility: oldStatus,
        new_visibility: body.visibility_status,
      });
    },
  );

  // ── 批量状态更新 ──
  app.post<{ Body: { product_ids: string[]; visibility_status: string } }>(
    '/api/v1/review/products/batch-visibility',
    async (request) => {
      const body = batchUpdateSchema.parse(request.body);
      const results: { id: string; old_status: string; new_status: string; ok: boolean; error?: string }[] = [];

      for (const productId of body.product_ids) {
        try {
          const existing = await sql`SELECT id, visibility_status FROM products WHERE id = ${productId} AND deleted_at IS NULL`;
          if (existing.length === 0) {
            results.push({ id: productId, old_status: '', new_status: body.visibility_status, ok: false, error: '商品不存在' });
            continue;
          }
          const oldStatus = existing[0]!.visibility_status;
          await sql`UPDATE products SET visibility_status = ${body.visibility_status}, updated_at = now() WHERE id = ${productId}`;
          await sql`
            INSERT INTO review_records (id, entity_type, entity_id, action, old_value, new_value, reviewer, notes)
            VALUES (${`rev_${productId}_${Date.now()}`}, 'product', ${productId}, 'visibility_change',
              ${String(oldStatus)}, ${body.visibility_status}, 'system', ${`批量变更`})
          `;
          results.push({ id: productId, old_status: oldStatus, new_status: body.visibility_status, ok: true });
        } catch (e) {
          results.push({ id: productId, old_status: '', new_status: body.visibility_status, ok: false, error: (e as Error).message });
        }
      }

      const succeeded = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok).length;
      return success(request, { succeeded, failed, results });
    },
  );

  // ── 查询待审核商品列表 ──
  app.get('/api/v1/review/products', async (request) => {
    const query = (request.query as Record<string, string>) ?? {};
    const status = query.status || 'draft';
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
    const offset = Math.max(0, parseInt(query.offset || '0', 10));

    if (!visibilityStatuses.includes(status as typeof visibilityStatuses[number])) {
      throw badRequest(`无效的状态: ${status}`);
    }

    const rows = await sql`
      SELECT p.id, p.canonical_name, p.brand_id, b.name as brand_name,
        p.pit_type, p.category, p.current_price, p.sale_status,
        p.visibility_status, p.review_status, p.source_platform,
        p.created_at, p.updated_at
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.deleted_at IS NULL AND p.visibility_status = ${status}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await sql`SELECT count(*) as cnt FROM products WHERE deleted_at IS NULL AND visibility_status = ${status}`;

    return success(request, {
      items: rows.map(r => ({
        id: String(r.id),
        canonical_name: String(r.canonical_name),
        brand_name: String(r.brand_name ?? ''),
        pit_type: String(r.pit_type),
        category: String(r.category),
        current_price: Number(r.current_price),
        sale_status: String(r.sale_status),
        visibility_status: String(r.visibility_status),
        review_status: String(r.review_status),
        source_platform: String(r.source_platform),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
      })),
      total: Number(countResult[0]!.cnt),
      limit,
      offset,
    });
  });

  // ── 查询审核历史 ──
  app.get('/api/v1/review/history', async (request) => {
    const query = (request.query as Record<string, string>) ?? {};
    const entityType = query.entity_type || 'product';
    const entityId = query.entity_id || '';
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));

    let rows;
    if (entityId) {
      rows = await sql`
        SELECT * FROM review_records WHERE entity_type = ${entityType} AND entity_id = ${entityId}
        ORDER BY created_at DESC LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT * FROM review_records WHERE entity_type = ${entityType}
        ORDER BY created_at DESC LIMIT ${limit}
      `;
    }

    return success(request, rows.map(r => ({
      id: String(r.id),
      entity_type: String(r.entity_type),
      entity_id: String(r.entity_id),
      action: String(r.action),
      old_value: String(r.old_value ?? ''),
      new_value: String(r.new_value ?? ''),
      reviewer: String(r.reviewer ?? ''),
      notes: String(r.notes ?? ''),
      created_at: String(r.created_at),
    })));
  });
}
