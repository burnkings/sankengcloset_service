import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryRepository } from '../src/repositories/memory.js';

let app: FastifyInstance | undefined;

async function createApp() {
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test', DATA_DRIVER: 'memory',
      JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
      PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-feature-api-tests',
    }),
    repository: new MemoryRepository(), logger: false,
  });
  await app.ready();
  return app;
}

async function login(instance: FastifyInstance): Promise<string> {
  const response = await instance.inject({ method: 'POST', url: '/api/v1/sessions/dev', payload: { nickname: '接口测试用户' } });
  return response.json().data.accessToken as string;
}

afterEach(async () => { if (app) await app.close(); app = undefined; });

describe('V2.5 user feature API', () => {
  it('persists wardrobe records rather than only accepting a sync receipt', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const headers = { authorization: `Bearer ${token}` };
    const created = await instance.inject({
      method: 'POST', url: '/api/v1/me/wardrobe', headers,
      payload: { id: 'wd_test_1', name: '测试格裙', category: 'JK', purchasePrice: 12800 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.name).toBe('测试格裙');

    const updated = await instance.inject({
      method: 'PATCH', url: '/api/v1/me/wardrobe/wd_test_1', headers,
      payload: { wearStatus: 'WORN', isFavorite: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.wearStatus).toBe('WORN');

    const listed = await instance.inject({ method: 'GET', url: '/api/v1/me/wardrobe', headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);
  });

  it('publishes, likes, lists and deletes an owned community post', async () => {
    const instance = await createApp();
    const token = await login(instance);
    const headers = { authorization: `Bearer ${token}` };
    const prepared = await instance.inject({
      method: 'POST', url: '/api/v1/uploads:prepare', headers,
      payload: { purpose: 'outfit', contentType: 'image/jpeg' },
    });
    const { uploadId, mediaId } = prepared.json().data;
    const uploaded = await instance.inject({
      method: 'PUT', url: `/api/v1/uploads/${uploadId}/content`,
      headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from('image'),
    });
    expect(uploaded.statusCode).toBe(201);

    const created = await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId, category: 'LOLITA', topic: '茶会搭配', caption: '测试发布动态' },
    });
    expect(created.statusCode).toBe(201);
    const postId = created.json().data.id as string;

    const liked = await instance.inject({
      method: 'PUT', url: `/api/v1/community/posts/${postId}/like`, headers, payload: { liked: true },
    });
    expect(liked.json().data).toEqual({ liked: true, likeCount: 1 });

    const mine = await instance.inject({ method: 'GET', url: '/api/v1/me/community/posts', headers });
    expect(mine.json().data[0].id).toBe(postId);

    const removed = await instance.inject({ method: 'DELETE', url: `/api/v1/community/posts/${postId}`, headers });
    expect(removed.statusCode).toBe(204);
  });
});
