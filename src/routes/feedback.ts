import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, requireUser } from '../http.js';
import type { AppRepository } from '../repositories/contracts.js';

/** Phase 2.6：意见反馈提交（匿名可提交；登录用户记录 userId） */
export const feedbackSchema = z.object({
  id: z.string().trim().min(1).max(128),
  type: z.enum(['功能建议', '问题反馈', '内容纠错', '其他']).default('其他'),
  content: z.string().trim().min(1).max(2000),
  contact: z.string().trim().max(200).default(''),
  images: z.array(z.string().max(512)).max(9).default([]),
  createdAt: z.string().trim().max(64).default(() => String(Date.now())),
});

/**
 * Phase 2.6：意见反馈 + 版本检查
 * - POST /api/v1/feedback    提交反馈（幂等：按客户端生成的 id 去重）
 * - GET  /api/v1/app/version 版本检查（前端 about 页「检查更新」）
 */
export async function registerFeedbackRoutes(app: FastifyInstance, repository: AppRepository) {
  app.post('/api/v1/feedback', async (request, reply) => {
    const payload = feedbackSchema.parse(request.body);
    let userId: string | null = null;
    try { userId = await requireUser(request); } catch { /* 匿名 */ }
    const record = await repository.createFeedback(userId, payload);
    return success(request, record);
  });

  app.get('/api/v1/app/version', async (request) => {
    return success(request, {
      latestVersion: process.env.APP_VERSION ?? 'V2.5.0-beta.2',
      hasUpdate: false,
      updateUrl: '',
      releaseNote: '',
    });
  });
}
