import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { requireUser, success } from '../http.js';
import { AppProblem, notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';
import type { ObjectStorage } from '../storage/types.js';
import type { AiImportTask } from '../types.js';
import { createPendingTask, runImportTaskWorker } from '../services/ai-import.js';
import { createHttpOrderRecognizer, type OrderRecognizer } from '../services/vision-ocr.js';

const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'id 格式不正确');

export const createSchema = z.object({
  mediaId: z.string().max(128).optional(),
  objectKey: z.string().max(512).optional(), // 兼容旧客户端
  taskType: z.enum(['purchase_order']).default('purchase_order'),
  sourcePlatform: z.enum(['', 'taobao', 'weidian', 'tuanzhang', 'other']).default(''),
  sourceLink: z.string().max(1000).default(''),
}).refine((body) => body.mediaId !== undefined || body.objectKey !== undefined, {
  message: '缺少 mediaId（或兼容字段 objectKey）',
});
export const taskParamsSchema = z.object({ taskId: z.string().min(1).max(128) });

export const confirmSuggestionSchema = z.object({
  name: z.string().max(120).default(''),
  brand: z.string().max(120).default(''),
  shopName: z.string().max(120).default(''),
  category: z.enum(['JK', 'LOLITA', 'HANFU', 'OTHER']).default('OTHER'),
  orderNumber: z.string().max(64).default(''),
  orderDate: z.string().max(10).default(''),
  totalCents: z.number().int().min(0).max(100_000_000).default(0),
  depositCents: z.number().int().min(0).max(100_000_000).default(0),
  paidCents: z.number().int().min(0).max(100_000_000).default(0),
  balanceDueDate: z.string().max(10).default(''),
  arrivalDate: z.string().max(10).default(''),
  note: z.string().max(1000).default(''),
});
export const confirmSchema = z.object({
  opId: z.string().max(128).optional(),
  targetType: z.literal('purchase'),
  targetId: idSchema,
  confirmed: confirmSuggestionSchema,
});

/** 对外响应：只暴露规格声明的字段（model 去掉内部 provider）。 */
function toTaskResponse(task: AiImportTask) {
  return {
    taskId: task.taskId,
    state: task.state,
    model: { name: task.model.name, version: task.model.version },
    confidence: task.confidence,
    fieldConfidence: task.fieldConfidence,
    suggestion: task.suggestion,
    evidence: task.evidence,
    warnings: task.warnings,
  };
}

const PROCESSING_STALE_MS = 90_000;

export async function registerAiImportRoutes(
  app: FastifyInstance,
  config: AppConfig,
  repository: AppRepository,
  storage: ObjectStorage,
  recognizer: OrderRecognizer = createHttpOrderRecognizer(config),
) {
  app.post('/api/v1/ai/import-tasks', async (request, reply) => {
    const userId = await requireUser(request);
    const body = createSchema.parse(request.body);
    const media = body.mediaId
      ? await repository.getMediaById(body.mediaId)
      : await repository.getMediaByObjectKey(userId, body.objectKey ?? '');
    if (!media || media.ownerUserId !== userId) throw new AppProblem(404, 'NOT_FOUND', '图片不存在', false);
    if (media.deletedAt !== null || media.sizeBytes <= 0) {
      throw new AppProblem(400, 'VALIDATION_FAILED', '图片尚未完成上传', false);
    }
    if (media.purpose !== 'purchase_import' && media.purpose !== 'ai_import') {
      throw new AppProblem(400, 'VALIDATION_FAILED', '请使用 purchase_import 用途上传订单截图', false);
    }

    const task = createPendingTask({
      userId,
      objectKey: media.objectKey,
      mediaId: media.id,
      taskType: body.taskType,
      sourcePlatform: body.sourcePlatform,
      sourceLink: body.sourceLink,
      requestId: request.id,
    });
    await repository.createAiTask(task);

    // 异步 worker：pending → processing → ready | failed（绝不阻塞响应、绝不伪造 ready）
    queueMicrotask(() => {
      runImportTaskWorker({ repository, storage, recognizer, task, media }).catch(() => { /* worker 内部已兜底 */ });
    });
    return reply.code(202).send(success(request, toTaskResponse(task)));
  });

  app.get('/api/v1/ai/import-tasks/:taskId', async (request) => {
    const userId = await requireUser(request);
    const { taskId } = taskParamsSchema.parse(request.params);
    let task = await repository.getAiTask(userId, taskId);
    if (!task) throw notFound('AI 导入任务不存在');
    // 处理中超时兜底：进程重启/识别挂起时避免永久 processing
    if (task.state === 'processing' && Date.now() - new Date(task.createdAt).getTime() > PROCESSING_STALE_MS) {
      task = await repository.updateAiTask(taskId, userId, {
        state: 'failed',
        warnings: ['识别服务超时，请重试或手动补全'],
      }) ?? task;
    }
    return success(request, toTaskResponse(task));
  });

  app.post('/api/v1/ai/import-tasks/:taskId/confirm', async (request) => {
    const userId = await requireUser(request);
    const { taskId } = taskParamsSchema.parse(request.params);
    const body = confirmSchema.parse(request.body);
    const task = await repository.confirmAiTask(userId, taskId, {
      ...(body.opId ? { opId: body.opId } : {}),
      targetType: body.targetType,
      targetId: body.targetId,
      confirmed: body.confirmed,
    });
    return success(request, {
      taskId: task.taskId,
      state: task.state,
      confirmedAt: task.confirmedAt,
      targetType: task.targetType,
      targetId: task.targetId,
    });
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
