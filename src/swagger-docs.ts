// src/swagger-docs.ts — API documentation (12-table schema)
import type { FastifyInstance } from 'fastify';

export const API_TAGS = ['content', 'interaction', 'user-data', 'feedback', 'ai-import', 'community', 'media'];

export function swaggerTransform(schema: any) {
  return { ...schema, tags: schema.tags ?? [] };
}

export function registerSwaggerDocs(_app: FastifyInstance) {
  // swagger docs stub — 12-table schema
}
