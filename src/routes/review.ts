// routes/review.ts — 商品审核路由

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, requireUser } from '../http.js';
import { notFound, badRequest, AppProblem } from '../lib/problem.js';
import type postgres from 'postgres';

const visibilityStatuses = ['draft', 'reviewing', 'published', 'hidden'] as const;

export const updateVisibilitySchema = z.object({
  visibility_status: z.enum(visibilityStatuses),
});

export const batchUpdateSchema = z.object({
  product_ids: z.array(z.string().min(1).max(128)).min(1).max(100),
  visibility_status: z.enum(visibilityStatuses),
});

export async function registerReviewRoutes(app: FastifyInstance, sql: postgres.Sql, adminIds:string[] = []) {
  app.addHook('onRequest', async request=>{
    if(!request.url.startsWith('/api/v1/review/'))return;
    if(!adminIds.includes(await requireUser(request)))throw new AppProblem(403,'FORBIDDEN','需要目录管理员权限');
  });

  // 单个商品状态更新
  app.patch<{ Params: { id: string }; Body: { visibility_status: string } }>(
    '/api/v1/review/products/:id/visibility',
    async (request) => {
      const { id } = request.params;
      const body = updateVisibilitySchema.parse(request.body);

      const existing = await sql`SELECT id, visibility_status, reviewed_by, reviewed_at FROM products WHERE id = ${id} AND deleted_at IS NULL`;
      if (existing.length === 0) throw notFound('商品不存在');
      const oldStatus = existing[0]!.visibility_status;
      const reviewerId = await requireUser(request);

      await sql`
        UPDATE products SET
          visibility_status = ${body.visibility_status},
          reviewed_by = ${reviewerId},
          reviewed_at = now(),
          updated_at = now()
        WHERE id = ${id}
      `;

      return success(request, {
        id,
        old_visibility: oldStatus,
        new_visibility: body.visibility_status,
      });
    },
  );

  // 批量状态更新
  app.post<{ Body: { product_ids: string[]; visibility_status: string } }>(
    '/api/v1/review/products/batch-visibility',
    async (request) => {
      const body = batchUpdateSchema.parse(request.body);
      const reviewerId = await requireUser(request);
      const results: { id: string; old_status: string; new_status: string; ok: boolean; error?: string }[] = [];

      for (const productId of body.product_ids) {
        try {
          const existing = await sql`SELECT id, visibility_status FROM products WHERE id = ${productId} AND deleted_at IS NULL`;
          if (existing.length === 0) {
            results.push({ id: productId, old_status: '', new_status: body.visibility_status, ok: false, error: '商品不存在' });
            continue;
          }
          const oldStatus = existing[0]!.visibility_status;
          await sql`UPDATE products SET visibility_status = ${body.visibility_status}, reviewed_by = ${reviewerId}, reviewed_at = now(), updated_at = now() WHERE id = ${productId}`;
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

  // 查询待审核商品列表
  app.get('/api/v1/review/products', async (request) => {
    const query = (request.query as Record<string, string>) ?? {};
    const status = query.status || 'draft';
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
    const offset = Math.max(0, parseInt(query.offset || '0', 10));

    if (!visibilityStatuses.includes(status as typeof visibilityStatuses[number])) {
      throw badRequest(`无效的状态: ${status}`);
    }

    const rows = await sql`
      SELECT p.id, p.title, p.brand_id, b.name as brand_name,
        p.category, p.price_cents, p.sale_status,
        p.visibility_status, p.source_platform,
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
        title: String(r.title),
        brand_name: String(r.brand_name ?? ''),
        category: String(r.category),
        price_cents: Number(r.price_cents ?? 0),
        sale_status: String(r.sale_status),
        visibility_status: String(r.visibility_status),
        source_platform: String(r.source_platform),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
      })),
      total: Number(countResult[0]!.cnt),
      limit,
      offset,
    });
  });
}
