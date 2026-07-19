import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryRepository } from '../src/repositories/memory.js';

let app: FastifyInstance | undefined;

async function createApp() {
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DRIVER: 'memory', JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
    PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-api-tests',
  });
  app = await buildApp({ config, repository: new MemoryRepository(), logger: false });
  await app.ready();
  return app;
}

async function login(instance: FastifyInstance): Promise<string> {
  const response = await instance.inject({ method: 'POST', url: '/api/v1/sessions/dev', payload: { nickname: '测试用户' } });
  expect(response.statusCode).toBe(200);
  return response.json().data.accessToken as string;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.unstubAllGlobals();
});

describe('runtime foundation', () => {
  it('reports health and serves feed with the client envelope', async () => {
    const instance = await createApp();
    const health = await instance.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const feed = await instance.inject({ method: 'GET', url: '/api/v1/feed?category=JK&limit=2' });
    expect(feed.statusCode).toBe(200);
    expect(feed.json().data[0].category).toBe('JK');
    expect(feed.json().page.hasMore).toBe(false);
  });

  it('keeps sync operations idempotent', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const operation = {
      opId: 'op_test_1', deviceId: 'device_test', entityType: 'favorite', entityId: 'prd_jk_navy_45',
      action: 'create', payload: '{}', createdAt: String(Date.now()),
    };
    const first = await instance.inject({ method: 'POST', url: '/api/v1/sync/operations:batch', headers: { authorization: `Bearer ${token}` }, payload: { operations: [operation] } });
    const second = await instance.inject({ method: 'POST', url: '/api/v1/sync/operations:batch', headers: { authorization: `Bearer ${token}` }, payload: { operations: [operation] } });
    expect(first.statusCode).toBe(200);
    expect(second.json().data.receipts[0]).toEqual(first.json().data.receipts[0]);
  });

  it('requires upload completion and explicit confirmation before creating an AI target', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    const prepared = await instance.inject({
      method: 'POST', url: '/api/v1/uploads:prepare', headers: auth,
      payload: { purpose: 'ai_import', contentType: 'image/jpeg' },
    });
    const { uploadId, objectKey } = prepared.json().data;
    const uploaded = await instance.inject({
      method: 'PUT', url: `/api/v1/uploads/${uploadId}/content`,
      headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: Buffer.from('fake-image'),
    });
    expect(uploaded.statusCode).toBe(201);
    const created = await instance.inject({
      method: 'POST', url: '/api/v1/ai/import-tasks', headers: auth, payload: { objectKey },
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().data.state).toBe('ready');
    expect(created.json().data.suggestion.brand).toBe('');
    const taskId = created.json().data.taskId as string;
    const confirmed = await instance.inject({
      method: 'POST', url: `/api/v1/ai/import-tasks/${taskId}/confirm`, headers: auth,
      payload: {
        opId: 'op_ai_confirm_1', targetType: 'wardrobe',
        confirmed: { name: '人工确认格裙', category: 'JK', brand: '人工填写', priceCents: 12800, color: '深蓝', size: 'M', note: '' },
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data.task.state).toBe('confirmed');
    expect(confirmed.json().data.task.targetId).toMatch(/^wdi_/);
  });

  it('exchanges a WeChat code without exposing the session key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      openid: 'openid_ci_user', session_key: 'must-not-leave-server', unionid: 'union_ci_user',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const config = loadConfig({
      NODE_ENV: 'test', DATA_DRIVER: 'memory', JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
      PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-api-tests',
      WECHAT_APP_ID: 'wx_test_app', WECHAT_APP_SECRET: 'server-only-secret',
    });
    app = await buildApp({ config, repository: new MemoryRepository(), logger: false });
    await app.ready();

    const response = await app.inject({
      method: 'POST', url: '/api/v1/sessions/wechat', payload: { code: 'temporary-code', deviceId: 'device_test' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.mode).toBe('wechat');
    expect(response.json().data.accessToken).toBeTypeOf('string');
    expect(response.body).not.toContain('session_key');
    expect(response.body).not.toContain('must-not-leave-server');
  });
});
