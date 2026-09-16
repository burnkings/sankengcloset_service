import type { FastifyInstance } from 'fastify';
import { success } from '../http.js';
import type { AppRepository } from '../repositories/contracts.js';

/**
 * Sync API removed in 12-table schema (no sync_operations table).
 * Kept as no-op for backwards compatibility.
 */
export async function registerSyncRoutes(app: FastifyInstance, _repository: AppRepository) {
  app.post('/api/v1/sync/batch', async (request) => {
    return success(request, []);
  });

  app.get('/api/v1/sync/checkpoint', async (request) => {
    return success(request, { checkpoint: '' });
  });
}
