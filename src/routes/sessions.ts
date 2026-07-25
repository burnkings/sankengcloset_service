import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { success, requireUser } from '../http.js';
import type { AppRepository } from '../repositories/contracts.js';
import { AppProblem, notFound } from '../lib/problem.js';
import { exchangeWechatCode } from '../services/wechat-auth.js';

const devLoginSchema = z.object({ nickname: z.string().trim().min(1).max(32).default('本地测试用户') });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const wechatSchema = z.object({ code: z.string().min(1), deviceId: z.string().min(1).max(128) });

function createTokens(app: FastifyInstance, userId: string) {
  return {
    accessToken: app.jwt.sign({ sub: userId, kind: 'access' }, { expiresIn: '15m' }),
    refreshToken: app.jwt.sign({ sub: userId, kind: 'refresh' }, { expiresIn: '30d' }),
    expiresIn: 900,
  };
}

export async function registerSessionRoutes(app: FastifyInstance, config: AppConfig, repository: AppRepository) {
  // Dev login route — only available in test environment
  if (config.NODE_ENV === 'test') {
    app.post('/api/v1/sessions/dev', async (request) => {
      const body = devLoginSchema.parse(request.body ?? {});
      const user = await repository.ensureDevUser(body.nickname);
      return success(request, { user, ...createTokens(app, user.id), mode: 'development' });
    });
  }

  app.post('/api/v1/sessions/wechat', async (request) => {
    const body = wechatSchema.parse(request.body);
    if (config.WECHAT_APP_ID === '' || config.WECHAT_APP_SECRET === '') {
      throw new AppProblem(503, 'WECHAT_NOT_CONFIGURED', '微信登录尚未配置 App ID 与 Secret', false);
    }
    const session = await exchangeWechatCode(config.WECHAT_APP_ID, config.WECHAT_APP_SECRET, body.code);
    const user = await repository.ensureWechatUser(session.openId, '三坑女孩');
    return success(request, { user, ...createTokens(app, user.id), mode: 'wechat' });
  });

  app.post('/api/v1/sessions/refresh', async (request) => {
    const body = refreshSchema.parse(request.body);
    const payload = app.jwt.verify<{ sub: string; kind: string }>(body.refreshToken);
    if (payload.kind !== 'refresh') throw new AppProblem(401, 'UNAUTHORIZED', '刷新令牌无效', false);
    const user = await repository.getUser(payload.sub);
    if (!user) throw new AppProblem(401, 'UNAUTHORIZED', '用户不存在或已停用', false);
    return success(request, createTokens(app, user.id));
  });

  app.delete('/api/v1/sessions/current', async (request, reply) => {
    await requireUser(request);
    return reply.code(204).send();
  });

  app.get('/api/v1/me', async (request) => {
    const userId = await requireUser(request);
    const user = await repository.getUser(userId);
    if (!user) throw new AppProblem(401, 'UNAUTHORIZED', '用户不存在或已停用', false);
    return success(request, { ...user, capabilities: { aiImport: true, sync: true, externalPurchaseOnly: true } });
  });
}
