import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { requireUser, success } from '../http.js';
import { newId } from '../lib/id.js';
import { AppProblem, notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';
import { createSafeMockTask } from '../services/ai-import.js';

export const createSchema = z.object({ objectKey: z.string().min(1).max(512) });
export const taskParamsSchema = z.object({ taskId: z.string().min(1).max(128) });
export const suggestionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(['JK', 'LOLITA', 'HANFU', 'OTHER']),
  brand: z.string().trim().max(120),
  priceCents: z.number().int().min(0).max(100_000_000),
  color: z.string().trim().max(80),
  size: z.string().trim().max(80),
  note: z.string().trim().max(1000),
});
export const confirmSchema = z.object({
  opId: z.string().min(1).max(128),
  targetType: z.enum(['wardrobe', 'wishlist']),
  confirmed: suggestionSchema,
});

export async function registerAiImportRoutes(app: FastifyInstance, config: AppConfig, repository: AppRepository) {
  app.post('/api/v1/ai/import-tasks', async (request, reply) => {
    const userId = await requireUser(request);
    const { objectKey } = createSchema.parse(request.body);
    const media = await repository.getMediaByObjectKey(userId, objectKey);
    if (!media || media.sizeBytes <= 0) throw new AppProblem(400, 'VALIDATION_FAILED', '图片尚未完成上传', false);
    if (config.AI_PROVIDER !== 'safe_mock') throw new AppProblem(503, 'AI_PROVIDER_NOT_CONFIGURED', '远程视觉模型尚未配置', true);
    const task = createSafeMockTask(userId, objectKey, newId('req'));
    await repository.createAiTask(task);
    return reply.code(202).send(success(request, task));
  });

  app.get('/api/v1/ai/import-tasks/:taskId', async (request) => {
    const userId = await requireUser(request);
    const { taskId } = taskParamsSchema.parse(request.params);
    const task = await repository.getAiTask(userId, taskId);
    if (!task) throw notFound('AI 导入任务不存在');
    return success(request, task);
  });

  app.post('/api/v1/ai/import-tasks/:taskId/confirm', async (request) => {
    const userId = await requireUser(request);
    const { taskId } = taskParamsSchema.parse(request.params);
    const body = confirmSchema.parse(request.body);
    const task = await repository.confirmAiTask(userId, taskId, body);
    return success(request, { task, receipt: { opId: body.opId, result: 'accepted', targetId: task.targetId } });
  });

  app.delete('/api/v1/ai/import-tasks/:taskId/source', async (request, reply) => {
    const userId = await requireUser(request);
    const { taskId } = taskParamsSchema.parse(request.params);
    const task = await repository.getAiTask(userId, taskId);
    if (!task) return reply.code(204).send();
    await repository.deleteMediaByObjectKey(userId, task.objectKey);
    return reply.code(204).send();
  });
}
