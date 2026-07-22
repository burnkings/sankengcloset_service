import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { loadConfig, type AppConfig } from './config.js';
import { AppProblem } from './lib/problem.js';
import type { AppRepository } from './repositories/contracts.js';
import { MemoryRepository } from './repositories/memory.js';
import { PostgresRepository } from './repositories/postgres.js';
import { LocalObjectStorage } from './storage/local-storage.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerContentRoutes } from './routes/content.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerAiImportRoutes } from './routes/ai-import.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerInteractionRoutes } from './routes/interaction.js';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildAppOptions {
  config?: AppConfig;
  repository?: AppRepository;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const repository = options.repository ?? (
    config.DATA_DRIVER === 'postgres' ? new PostgresRepository(config.DATABASE_URL) : new MemoryRepository()
  );
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
      info: { title: '三坑绮橱 API', version: '0.1.0' },
      servers: [{ url: config.PUBLIC_BASE_URL }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
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

  const storage = new LocalObjectStorage(config.UPLOAD_DIR);
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
  await registerAiImportRoutes(app, config, repository);
  await registerInteractionRoutes(app, repository);

  // 审核路由（仅 postgres 模式）
  if (config.DATA_DRIVER === 'postgres') {
    const reviewSql = postgres(config.DATABASE_URL, { max: 5 });
    await registerReviewRoutes(app, reviewSql);
    app.addHook('onClose', async () => { await reviewSql.end(); });
  }

  app.addHook('onClose', async () => repository.close());
  return app;
}
