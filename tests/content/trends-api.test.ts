// tests/content/trends-api.test.ts — 趋势 API 端点测试

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryRepository } from '../../src/repositories/memory.js';

let app: FastifyInstance | undefined;

async function createApp() {
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DRIVER: 'memory',
    JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
    PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-api-tests',
  });
  app = await buildApp({ config, repository: new MemoryRepository(), logger: false });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('Trends API', () => {
  it('returns trend summary with default 30d period', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/trends' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.brandTrends).toBeDefined();
    expect(body.data.productTrends).toBeDefined();
    expect(body.data.generatedAt).toBeDefined();
  });

  it('accepts period parameter', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/trends?period=7d' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects invalid period', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/trends?period=1d' });
    expect(response.statusCode).toBe(400);
  });

  it('returns TrendSummary structure', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/trends?period=30d' });
    const body = response.json();
    expect(body.data).toHaveProperty('brandTrends');
    expect(body.data).toHaveProperty('productTrends');
    expect(body.data).toHaveProperty('generatedAt');
    expect(Array.isArray(body.data.brandTrends)).toBe(true);
    expect(Array.isArray(body.data.productTrends)).toBe(true);
  });
});
