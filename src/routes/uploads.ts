import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { requireUser, success } from '../http.js';
import { newId } from '../lib/id.js';
import { AppProblem, notFound } from '../lib/problem.js';
import type { AppRepository } from '../repositories/contracts.js';
import type { LocalObjectStorage } from '../storage/local-storage.js';

const prepareSchema = z.object({
  purpose: z.enum(['ai_import', 'outfit', 'wardrobe']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});
const uploadParamsSchema = z.object({ uploadId: z.string().min(1).max(128) });
const sourceSchema = z.object({ objectKey: z.string().min(1).max(512) });

export async function registerUploadRoutes(
  app: FastifyInstance,
  config: AppConfig,
  repository: AppRepository,
  storage: LocalObjectStorage,
) {
  app.post('/api/v1/uploads:prepare', async (request) => {
    const userId = await requireUser(request);
    const body = prepareSchema.parse(request.body);
    const uploadId = newId('upl');
    const objectKey = `${userId}/${body.purpose}/${newId('obj')}`;
    const media = await repository.createMedia({
      ownerUserId: userId, objectKey, uploadId, purpose: body.purpose, contentType: body.contentType,
    });
    return success(request, {
      uploadId, objectKey, method: 'PUT',
      uploadUrl: `${config.PUBLIC_BASE_URL}/api/v1/uploads/${uploadId}/content`,
      requiredHeaders: { authorization: 'Bearer <accessToken>', 'content-type': body.contentType },
      expiresIn: 900,
      mediaId: media.id,
    });
  });

  app.put('/api/v1/uploads/:uploadId/content', async (request, reply) => {
    const userId = await requireUser(request);
    const { uploadId } = uploadParamsSchema.parse(request.params);
    const media = await repository.getMediaByUploadId(userId, uploadId);
    if (!media) throw notFound('上传任务不存在');
    if (!Buffer.isBuffer(request.body)) throw new AppProblem(400, 'VALIDATION_FAILED', '请提交原始图片二进制', false);
    if (request.body.length === 0 || request.body.length > config.UPLOAD_MAX_BYTES) {
      throw new AppProblem(413, 'VALIDATION_FAILED', '图片大小不符合要求', false);
    }
    await storage.put(media.objectKey, request.body);
    await repository.markMediaUploaded(userId, uploadId, request.body.length);
    return reply.code(201).send(success(request, { objectKey: media.objectKey, sizeBytes: request.body.length }));
  });

  app.delete('/api/v1/media/source', async (request, reply) => {
    const userId = await requireUser(request);
    const { objectKey } = sourceSchema.parse(request.body);
    const media = await repository.getMediaByObjectKey(userId, objectKey);
    if (!media) return reply.code(204).send();
    await storage.delete(objectKey);
    await repository.deleteMediaByObjectKey(userId, objectKey);
    return reply.code(204).send();
  });
}
