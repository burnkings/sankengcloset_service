import type { FastifyInstance } from 'fastify';
import type { AppRepository } from '../repositories/contracts.js';
import { success } from '../http.js';

export async function registerHealthRoutes(app: FastifyInstance, repository: AppRepository) {
  app.get('/health', async (request) => success(request, { status: 'ok', service: 'sankengcloset-api' }));
  app.get('/ready', async (request, reply) => {
    try {
      const ready = await repository.ready();
      return success(request, { status: ready ? 'ready' : 'not_ready' });
    } catch {
      return reply.code(503).send({ requestId: request.id, error: { code: 'SERVER_ERROR', message: '数据库尚未就绪', retryable: true } });
    }
  });
}
