import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { success, requireUser } from '../http.js';
import type { AppRepository } from '../repositories/contracts.js';
import { AppProblem } from '../lib/problem.js';
import { exchangeWechatCode } from '../services/wechat-auth.js';

export const devLoginSchema = z.object({ nickname: z.string().trim().min(1).max(32).default('本地测试用户') });
export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export const wechatSchema = z.object({
  code: z.string().min(1),
  deviceId: z.string().max(128).optional(),
});

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createTokens(app: FastifyInstance, userId: string) {
  return {
    accessToken: app.jwt.sign({ sub: userId, kind: 'access', jti: createHash('sha256').update(`${userId}:access:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16) }, { expiresIn: '15m' }),
    refreshToken: app.jwt.sign({ sub: userId, kind: 'refresh', jti: createHash('sha256').update(`${userId}:refresh:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16) }, { expiresIn: '30d' }),
    expiresIn: 900,
  };
}

export async function registerSessionRoutes(app: FastifyInstance, config: AppConfig, repository: AppRepository) {
  // Dev login route — 仅非生产环境注册，响应明确标识 mode=development；生产绝不接受任意 userId 冒充登录
  if (config.NODE_ENV !== 'production') {
    app.post('/api/v1/sessions/dev', async (request) => {
      const body = devLoginSchema.parse(request.body ?? {});
      const user = await repository.ensureDevUser(body.nickname);
      const tokens = createTokens(app, user.id);
      await repository.createUserSession(user.id, '', hashToken(tokens.refreshToken), new Date(Date.now() + REFRESH_TTL_MS).toISOString());
      return success(request, { userId: user.id, user, ...tokens, mode: 'development' });
    });
  }

  app.post('/api/v1/sessions/wechat', async (request) => {
    const body = wechatSchema.parse(request.body);
    if (config.WECHAT_APP_ID === '' || config.WECHAT_APP_SECRET === '') {
      throw new AppProblem(503, 'WECHAT_NOT_CONFIGURED', '微信登录尚未配置 App ID 与 Secret', false);
    }
    const session = await exchangeWechatCode(config.WECHAT_APP_ID, config.WECHAT_APP_SECRET, body.code);
    const user = await repository.ensureWechatUser(session.openId, '三坑女孩');
    const tokens = createTokens(app, user.id);
    await repository.createUserSession(user.id, body.deviceId ?? '', hashToken(tokens.refreshToken), new Date(Date.now() + REFRESH_TTL_MS).toISOString());
    return success(request, { userId: user.id, user, ...tokens, mode: 'wechat' });
  });

  app.post('/api/v1/sessions/refresh', async (request) => {
    const body = refreshSchema.parse(request.body);
    const payload = app.jwt.verify<{ sub: string; kind: string }>(body.refreshToken);
    if (payload.kind !== 'refresh') throw new AppProblem(401, 'UNAUTHORIZED', '刷新令牌无效', false);
    const user = await repository.getUser(payload.sub);
    if (!user) throw new AppProblem(401, 'UNAUTHORIZED', '用户不存在或已停用', false);
    const oldHash = hashToken(body.refreshToken);
    const tokens = createTokens(app, user.id);
    const rotated = await repository.rotateUserSession(
      oldHash,
      hashToken(tokens.refreshToken),
      new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
    );
    if (!rotated) throw new AppProblem(401, 'UNAUTHORIZED', '刷新令牌已失效，请重新登录', false);
    return success(request, { userId: user.id, ...tokens });
  });

  app.delete('/api/v1/sessions/current', async (request, reply) => {
    const userId = await requireUser(request);
    const body = (request.body ?? {}) as { refreshToken?: string };
    if (body.refreshToken) await repository.revokeUserSession(hashToken(body.refreshToken));
    return reply.code(204).send();
  });

  app.get('/api/v1/me', async (request) => {
    const userId = await requireUser(request);
    const user = await repository.getUser(userId);
    if (!user) throw new AppProblem(401, 'UNAUTHORIZED', '用户不存在或已停用', false);
    return success(request, { ...user, capabilities: { aiImport: true, sync: true, externalPurchaseOnly: true } });
  });
}
