import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, success } from '../http.js';
import type { AppRepository } from '../repositories/contracts.js';

const operationSchema = z.object({
  opId: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  entityType: z.enum([
    'favorite', 'brand_follow', 'post_like', 'outfit', 'wishlist_item', 'wardrobe_item',
    'purchase', 'reminder', 'budget', 'notification_read', 'local_asset_bundle', 'ai_import_confirmation',
  ]),
  entityId: z.string().max(128).default(''),
  action: z.enum(['create', 'update', 'upsert', 'delete', 'read', 'readAll', 'import']),
  payload: z.string().default('{}').refine((value) => {
    try { JSON.parse(value); return true; } catch { return false; }
  }, 'payload 必须是 JSON 字符串'),
  createdAt: z.string().min(1),
});
const batchSchema = z.object({ operations: z.array(operationSchema).min(1).max(100) });

export async function registerSyncRoutes(app: FastifyInstance, repository: AppRepository) {
  app.post('/api/v1/sync/operations:batch', async (request) => {
    const userId = await requireUser(request);
    const body = batchSchema.parse(request.body);
    const receipts = await repository.applySyncBatch(userId, body.operations);
    return success(request, { receipts });
  });

  app.get('/api/v1/sync/checkpoint', async (request) => {
    const userId = await requireUser(request);
    return success(request, { checkpoint: await repository.getSyncCheckpoint(userId) });
  });
}
