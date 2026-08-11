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

  it('fails OCR honestly without a vision provider and rejects confirming a non-ready task', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const auth = { authorization: `Bearer ${token}` };
    const prepared = await instance.inject({
      method: 'POST', url: '/api/v1/uploads:prepare', headers: auth,
      payload: { purpose: 'purchase_import', contentType: 'image/jpeg' },
    });
    const { uploadId, mediaId } = prepared.json().data;
    const uploaded = await instance.inject({
      method: 'PUT', url: `/api/v1/uploads/${uploadId}/content`,
      headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: Buffer.from('fake-image'),
    });
    expect(uploaded.statusCode).toBe(201);
    const created = await instance.inject({
      method: 'POST', url: '/api/v1/ai/import-tasks', headers: auth,
      payload: { mediaId, taskType: 'purchase_order', sourcePlatform: 'taobao' },
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().data.state).toBe('pending');
    // 轮询直到终态：未配置视觉模型 → 真实 failed，绝不伪造成 ready
    const taskId = created.json().data.taskId as string;
    let state = '';
    for (let i = 0; i < 20; i++) {
      const polled = await instance.inject({ method: 'GET', url: `/api/v1/ai/import-tasks/${taskId}`, headers: auth });
      state = polled.json().data.state;
      if (state === 'failed' || state === 'ready') break;
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(state).toBe('failed');
    const failed = await instance.inject({ method: 'GET', url: `/api/v1/ai/import-tasks/${taskId}`, headers: auth });
    expect(failed.json().data.warnings.join('')).toContain('当前识别服务不可用');
    expect(failed.json().data.suggestion.totalCents).toBe(0); // 不编造识别字段
    // failed 任务不可确认
    const confirm = await instance.inject({
      method: 'POST', url: `/api/v1/ai/import-tasks/${taskId}/confirm`, headers: auth,
      payload: { targetType: 'purchase', targetId: 'pur_test_1', confirmed: { name: '手动补全' } },
    });
    expect(confirm.statusCode).toBe(409);
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
