// tests/content/feedback-api.test.ts — Phase 2.6 意见反馈 + 版本检查 API 测试

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

describe('Phase 2.6 意见反馈 API', () => {
  it('POST /api/v1/feedback 匿名提交成功', async () => {
    const instance = await createApp();
    const response = await instance.inject({
      method: 'POST', url: '/api/v1/feedback',
      payload: {
        id: 'feedback_1720000000000',
        type: '功能建议',
        content: '希望增加按颜色筛选',
        contact: '',
        images: [],
        createdAt: '1720000000000',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.id).toBe('feedback_1720000000000');
    expect(body.data.status).toBe('open');
    expect(body.data.userId).toBeNull();
  });

  it('POST /api/v1/feedback 内容为空返回 400', async () => {
    const instance = await createApp();
    const response = await instance.inject({
      method: 'POST', url: '/api/v1/feedback',
      payload: { id: 'feedback_x', type: '其他', content: '   ', contact: '', images: [], createdAt: '1' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('POST /api/v1/feedback 幂等：同 id 重复提交不报错', async () => {
    const instance = await createApp();
    const payload = { id: 'feedback_dup', type: '问题反馈', content: '重复提交测试', contact: '', images: [], createdAt: '1' };
    const first = await instance.inject({ method: 'POST', url: '/api/v1/feedback', payload });
    const second = await instance.inject({ method: 'POST', url: '/api/v1/feedback', payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe('feedback_dup');
  });
});

describe('Phase 2.6 版本检查 API', () => {
  it('GET /api/v1/app/version 返回版本信息', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/app/version' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.data.latestVersion).toBe('string');
    expect(body.data.latestVersion.length).toBeGreaterThan(0);
    expect(typeof body.data.hasUpdate).toBe('boolean');
    expect(typeof body.data.updateUrl).toBe('string');
    expect(typeof body.data.releaseNote).toBe('string');
  });
});
