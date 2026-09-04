import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { API_TAGS, swaggerTransform } from './swagger-docs.js';
import { ZodError } from 'zod';
import { loadConfig, type AppConfig } from './config.js';
import { AppProblem } from './lib/problem.js';
import { requireUser } from './http.js';
import type { AppRepository } from './repositories/contracts.js';
import { MemoryRepository } from './repositories/memory.js';
import { PostgresRepository } from './repositories/postgres.js';
import { createObjectStorage } from './storage/factory.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerContentRoutes } from './routes/content.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerAiImportRoutes } from './routes/ai-import.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerInteractionRoutes } from './routes/interaction.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerUserDataRoutes } from './routes/user-data.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import type { OrderRecognizer } from './services/vision-ocr.js';
import { createHttpOrderRecognizer } from './services/vision-ocr.js';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildAppOptions {
  config?: AppConfig;
  repository?: AppRepository;
  logger?: boolean;
  visionRecognizer?: OrderRecognizer;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const repository = options.repository ?? (
    config.DATA_DRIVER === 'postgres' ? new PostgresRepository(config.DATABASE_URL) : new MemoryRepository()
  );
  // 测试可注入 stub 识别器；未提供时用默认（未配置视觉模型 → 任务真实 failed）
  const visionRecognizer = options.visionRecognizer ?? createHttpOrderRecognizer(config);
  const app = Fastify({
    logger: options.logger ?? config.NODE_ENV !== 'test',
    bodyLimit: config.UPLOAD_MAX_BYTES,
    trustProxy: config.TRUST_PROXY,
  });

  await app.register(cors, {
    origin: config.NODE_ENV === 'development' ? true : config.CORS_ORIGINS.split(',').map((item) => item.trim()),
    credentials: false,
  });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(swagger, {
    openapi: {
      info: {
        title: '三坑绮橱 API',
        version: '0.1.0',
        description: '三坑绮橱（JK / Lolita / 汉服）——商品发现、个人衣橱管理、圈子穿搭分享后端 API。登录接口返回 Bearer 令牌后，可在 Swagger UI 右上角 Authorize 填入（仅填 accessToken 即可）。',
      },
      servers: [{ url: config.PUBLIC_BASE_URL }],
      tags: [...API_TAGS],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: '登录/刷新接口返回的 accessToken',
          },
        },
      },
    },
    transform: swaggerTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list', deepLinking: true } });
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        requestId: request.id,
        error: { code: 'VALIDATION_FAILED', message: error.issues[0]?.message ?? '字段不符合要求', retryable: false },
      });
    }
    if (error instanceof AppProblem) {
      return reply.code(error.statusCode).send({
        requestId: request.id,
        error: { code: error.code, message: error.message, retryable: error.retryable },
      });
    }
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 401) {
      return reply.code(401).send({ requestId: request.id, error: { code: 'UNAUTHORIZED', message: '请先登录', retryable: false } });
    }
    request.log.error({ err: error }, 'unhandled request error');
    return reply.code(500).send({ requestId: request.id, error: { code: 'SERVER_ERROR', message: '服务暂时不可用', retryable: true } });
  });

  // ─── Idempotency-Key 支持（关键写操作防网络重试重复建单） ─────────────
  // 缓存按 userId+key 隔离；成功/确定性错误(2xx-4xx)缓存 10 分钟，重放原响应。
  const idempotencyStore = new Map<string, { statusCode: number; body: unknown; expiresAt: number }>();
  const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
  const IDEMPOTENCY_MAX = 2000;

  app.addHook('preHandler', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (!key || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    let userId = '';
    try { userId = await requireUser(request); } catch { return; }
    const cacheKey = `${userId}:${String(key)}`;
    const cached = idempotencyStore.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return reply.code(cached.statusCode).type('application/json').send(cached.body);
    }
    if (cached) idempotencyStore.delete(cacheKey);
    (reply as { idempotencyCacheKey?: string }).idempotencyCacheKey = cacheKey;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const cacheKey = (reply as { idempotencyCacheKey?: string }).idempotencyCacheKey;
    if (!cacheKey) return payload;
    if (reply.statusCode >= 200 && reply.statusCode < 500) {
      if (idempotencyStore.size >= IDEMPOTENCY_MAX) {
        const oldest = idempotencyStore.keys().next().value;
        if (oldest !== undefined) idempotencyStore.delete(oldest);
      }
      idempotencyStore.set(cacheKey, { statusCode: reply.statusCode, body: payload, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
    }
    return payload;
  });

  const storage = createObjectStorage(config);
  await registerHealthRoutes(app, repository);

  // 管理面板
  const __dirname = dirname(fileURLToPath(import.meta.url));
  app.get('/admin', async (_, reply) => {
    const html = await readFile(resolve(__dirname, '../public/admin.html'), 'utf8');
    return reply.type('text/html').send(html);
  });
  await registerSessionRoutes(app, config, repository);
  await registerContentRoutes(app, repository);
  await registerSyncRoutes(app, repository);
  await registerUploadRoutes(app, config, repository, storage);
  await registerAiImportRoutes(app, config, repository, storage, visionRecognizer);
  await registerInteractionRoutes(app, repository);
  await registerCalendarRoutes(app, repository);
  await registerUserDataRoutes(app, config, repository);
  await registerFeedbackRoutes(app, repository);

  // 审核路由（仅 postgres 模式）
  if (config.DATA_DRIVER === 'postgres') {
    const reviewSql = postgres(config.DATABASE_URL, { max: 5 });
    await registerReviewRoutes(app, reviewSql);
    app.addHook('onClose', async () => { await reviewSql.end(); });
  }

  app.addHook('onClose', async () => repository.close());
  return app;
}
