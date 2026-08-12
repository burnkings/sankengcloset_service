import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryRepository } from '../src/repositories/memory.js';
import { emptyAiSuggestion } from '../src/types.js';
import type { OrderRecognizer } from '../src/services/vision-ocr.js';

let app: FastifyInstance | undefined;

async function createApp(overrides: { visionRecognizer?: OrderRecognizer } = {}) {
  app = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test', DATA_DRIVER: 'memory',
      JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
      PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-p0-contract-tests',
    }),
    repository: new MemoryRepository(), logger: false,
    ...(overrides.visionRecognizer ? { visionRecognizer: overrides.visionRecognizer } : {}),
  });
  await app.ready();
  return app;
}

async function login(instance: FastifyInstance, nickname = '测试用户'): Promise<{ token: string; refreshToken: string; userId: string }> {
  const response = await instance.inject({ method: 'POST', url: '/api/v1/sessions/dev', payload: { nickname } });
  expect(response.statusCode).toBe(200);
  const data = response.json().data;
  return { token: data.accessToken as string, refreshToken: data.refreshToken as string, userId: data.userId as string };
}

async function uploadImage(instance: FastifyInstance, token: string, purpose: string, bytes: Buffer = Buffer.from('fake-image')): Promise<{ uploadId: string; mediaId: string }> {
  const auth = { authorization: `Bearer ${token}` };
  const prepared = await instance.inject({
    method: 'POST', url: '/api/v1/uploads:prepare', headers: auth,
    payload: { purpose, contentType: 'image/jpeg' },
  });
  expect(prepared.statusCode).toBe(200);
  const { uploadId, mediaId } = prepared.json().data as { uploadId: string; mediaId: string };
  const uploaded = await instance.inject({
    method: 'PUT', url: `/api/v1/uploads/${uploadId}/content`,
    headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: bytes,
  });
  expect(uploaded.statusCode).toBe(201);
  return { uploadId, mediaId };
}

afterEach(async () => { if (app) await app.close(); app = undefined; });

describe('P0 统一契约与核心闭环', () => {
  it('鉴权：无 token 访问受保护接口返回 401', async () => {
    const instance = await createApp();
    const me = await instance.inject({ method: 'GET', url: '/api/v1/me' });
    expect(me.statusCode).toBe(401);
    const wishlist = await instance.inject({ method: 'POST', url: '/api/v1/wishlist', payload: { title: 'x', status: 'WISH' } });
    expect(wishlist.statusCode).toBe(401);
    const purchases = await instance.inject({ method: 'GET', url: '/api/v1/me/purchases' });
    expect(purchases.statusCode).toBe(401);
  });

  it('登录/刷新：refresh token 轮换，旧 token 立即失效', async () => {
    const instance = await createApp();
    const session = await login(instance);
    expect(session.userId).toBeTypeOf('string');
    const refreshed = await instance.inject({
      method: 'POST', url: '/api/v1/sessions/refresh', payload: { refreshToken: session.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const newToken = refreshed.json().data.refreshToken as string;
    expect(newToken).not.toBe(session.refreshToken);
    // 旧 refresh token 重放 → 401
    const replay = await instance.inject({
      method: 'POST', url: '/api/v1/sessions/refresh', payload: { refreshToken: session.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    // 新 token 可用
    const again = await instance.inject({
      method: 'POST', url: '/api/v1/sessions/refresh', payload: { refreshToken: newToken },
    });
    expect(again.statusCode).toBe(200);
  });

  it('用户隔离：A 的订单/收藏 B 不可见、不可改', async () => {
    const instance = await createApp();
    const a = await login(instance, '用户A');
    const b = await login(instance, '用户B');
    const created = await instance.inject({
      method: 'POST', url: '/api/v1/me/purchases', headers: { authorization: `Bearer ${a.token}` },
      payload: { id: 'pur_a_1', name: 'A的格裙', brand: '兔缝缝', totalCents: 16800, balanceDueDate: '2026-09-15' },
    });
    expect(created.statusCode).toBe(201);
    // B 读取 A 的订单 → 404
    const bRead = await instance.inject({
      method: 'GET', url: '/api/v1/me/purchases/pur_a_1', headers: { authorization: `Bearer ${b.token}` },
    });
    expect(bRead.statusCode).toBe(404);
    // B 修改 A 的订单 → 404
    const bPatch = await instance.inject({
      method: 'PATCH', url: '/api/v1/me/purchases/pur_a_1', headers: { authorization: `Bearer ${b.token}` },
      payload: { note: '篡改' },
    });
    expect(bPatch.statusCode).toBe(404);
    // B 的列表为空
    const bList = await instance.inject({
      method: 'GET', url: '/api/v1/me/purchases', headers: { authorization: `Bearer ${b.token}` },
    });
    expect(bList.json().data).toHaveLength(0);
  });

  it('游标分页：feed 第二页与第一页无重叠且可走到底', async () => {
    const instance = await createApp();
    const page1 = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=2' });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().data).toHaveLength(2);
    expect(page1.json().page.hasMore).toBe(true);
    const cursor = page1.json().page.nextCursor as string;
    expect(cursor).not.toBe('');
    expect(Number.isNaN(Number(cursor))).toBe(true);
    const page2 = await instance.inject({ method: 'GET', url: `/api/v1/feed?limit=2&cursor=${encodeURIComponent(cursor)}` });
    expect(page2.statusCode).toBe(200);
    const ids1 = new Set(page1.json().data.map((item: { id: string }) => item.id));
    const ids2 = page2.json().data.map((item: { id: string }) => item.id);
    expect(ids2.every((id: string) => !ids1.has(id))).toBe(true);
    expect(page2.json().page.hasMore).toBe(false);
  });

  it('Feed 频道契约：新品、预约、降价各自过滤，穿搭不伪装普通商品', async () => {
    const instance = await createApp();
    const newest = await instance.inject({ method: 'GET', url: '/api/v1/feed?channel=new&limit=10' });
    expect(newest.statusCode).toBe(200);
    expect(newest.json().data.length).toBeGreaterThan(0);
    const reservation = await instance.inject({ method: 'GET', url: '/api/v1/feed?channel=reservation&limit=10' });
    expect(reservation.json().data.every((item: { saleStatus: string }) => item.saleStatus === 'PRE_ORDER')).toBe(true);
    const priceDrop = await instance.inject({ method: 'GET', url: '/api/v1/feed?channel=price_drop&limit=10' });
    expect(priceDrop.json().data.length).toBeGreaterThan(0);
    expect(priceDrop.json().data.every((item: { originalPrice: number; price: number }) => item.originalPrice > item.price)).toBe(true);
    const outfit = await instance.inject({ method: 'GET', url: '/api/v1/feed?channel=outfit&limit=10' });
    expect(outfit.statusCode).toBe(200);
    expect(outfit.json().data).toEqual([]);
  });

  it('Feed 游标非法或跨筛选复用时返回 400', async () => {
    const instance = await createApp();
    const invalid = await instance.inject({ method: 'GET', url: '/api/v1/feed?cursor=123&limit=2' });
    expect(invalid.statusCode).toBe(400);
    const first = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=1' });
    const cursor = first.json().page.nextCursor as string;
    const wrongScope = await instance.inject({ method: 'GET', url: `/api/v1/feed?channel=reservation&limit=1&cursor=${encodeURIComponent(cursor)}` });
    expect(wrongScope.statusCode).toBe(400);
  });

  it('重复收藏：同 productId 二次 POST 返回既有条目，不产生重复', async () => {
    const instance = await createApp();
    const { token } = await login(instance);
    const headers = { authorization: `Bearer ${token}` };
    const first = await instance.inject({
      method: 'POST', url: '/api/v1/wishlist', headers,
      payload: { productId: 'prd_jk_navy_45', title: '深蓝格裙', status: 'WISH' },
    });
    expect(first.statusCode).toBe(201);
    const second = await instance.inject({
      method: 'POST', url: '/api/v1/wishlist', headers,
      payload: { productId: 'prd_jk_navy_45', title: '深蓝格裙', status: 'WISH' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);
    const list = await instance.inject({ method: 'GET', url: '/api/v1/wishlist', headers });
    expect(list.json().data).toHaveLength(1);
    // Feed 的 saved 按当前用户实时计算；游客 false
    const feedLogged = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=10', headers });
    const item = feedLogged.json().data.find((i: { entityId: string }) => i.entityId === 'prd_jk_navy_45');
    expect(item.saved).toBe(true);
    const feedGuest = await instance.inject({ method: 'GET', url: '/api/v1/feed?limit=10' });
    const guestItem = feedGuest.json().data.find((i: { entityId: string }) => i.entityId === 'prd_jk_navy_45');
    expect(guestItem.saved).toBe(false);
  });

  it('上传权限：purchase_import 私有不可公开读取，outfit 可公开读取', async () => {
    const instance = await createApp();
    const { token } = await login(instance);
    const privateMedia = await uploadImage(instance, token, 'purchase_import');
    const publicMedia = await uploadImage(instance, token, 'outfit');
    const auth = { authorization: `Bearer ${token}` };
    // 私有订单截图：公开 URL 404
    const privateGet = await instance.inject({ method: 'GET', url: `/api/v1/media/${privateMedia.mediaId}` });
    expect(privateGet.statusCode).toBe(404);
    // 圈子图片：公开可读
    const publicGet = await instance.inject({ method: 'GET', url: `/api/v1/media/${publicMedia.mediaId}` });
    expect(publicGet.statusCode).toBe(200);
    // 他人 uploadId 不可 PUT
    const other = await login(instance, '用户B');
    const stolen = await instance.inject({
      method: 'PUT', url: `/api/v1/uploads/${privateMedia.uploadId}/content`,
      headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('steal'),
    });
    expect(stolen.statusCode).toBe(404);
    void auth;
  });

  it('确认不重复建单：ready 任务确认只记录审计，不覆盖订单、不新建第二笔', async () => {
    const stub: OrderRecognizer = {
      async recognizeOrder() {
        const suggestion = emptyAiSuggestion();
        suggestion.name = '深蓝格裙 45cm';
        suggestion.brand = '兔缝缝';
        suggestion.shopName = '兔缝缝官方店';
        suggestion.category = 'JK';
        suggestion.orderNumber = 'TB20260811001';
        suggestion.orderDate = '2026-08-10';
        suggestion.totalCents = 16800;
        suggestion.depositCents = 6800;
        suggestion.paidCents = 6800;
        suggestion.balanceDueDate = '2026-09-15';
        suggestion.arrivalDate = '';
        suggestion.note = '';
        return {
          suggestion, confidence: 0.93,
          fieldConfidence: { name: 0.95, orderNumber: 0.9, totalCents: 0.95, balanceDueDate: 0.7 },
          evidence: ['订单号 TB20260811001', '金额 ¥168.00'],
          warnings: [],
          model: { name: 'test-vision', version: 'v1' },
        };
      },
    };
    const instance = await createApp({ visionRecognizer: stub });
    const { token } = await login(instance);
    const headers = { authorization: `Bearer ${token}` };
    const { mediaId } = await uploadImage(instance, token, 'purchase_import');

    const created = await instance.inject({
      method: 'POST', url: '/api/v1/ai/import-tasks', headers,
      payload: { mediaId, taskType: 'purchase_order', sourcePlatform: 'taobao', sourceLink: 'https://item.taobao.com/x' },
    });
    expect(created.statusCode).toBe(202);
    const taskId = created.json().data.taskId as string;
    // 轮询到 ready
    let taskState = '';
    let taskData: { state: string; suggestion?: { name: string; totalCents: number }; confidence: number } | undefined;
    for (let i = 0; i < 20; i++) {
      const polled = await instance.inject({ method: 'GET', url: `/api/v1/ai/import-tasks/${taskId}`, headers });
      taskData = polled.json().data as { state: string; suggestion?: { name: string; totalCents: number }; confidence: number };
      taskState = taskData.state;
      if (taskState === 'ready' || taskState === 'failed') break;
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    expect(taskState).toBe('ready');
    expect(taskData?.suggestion?.name).toBe('深蓝格裙 45cm');
    expect(taskData?.suggestion?.totalCents).toBe(16800);
    expect(taskData?.confidence).toBe(0.93);

    // 前端先创建 purchase，再确认（确认仅审计关联）
    const purchase = await instance.inject({
      method: 'POST', url: '/api/v1/me/purchases', headers,
      payload: { id: 'pur_ai_1', name: '深蓝格裙 45cm', brand: '兔缝缝', shopName: '兔缝缝官方店', category: 'JK', orderNumber: 'TB20260811001', totalCents: 16800, depositCents: 6800, paidCents: 6800, balanceDueDate: '2026-09-15' },
    });
    expect(purchase.statusCode).toBe(201);

    const confirmed = await instance.inject({
      method: 'POST', url: `/api/v1/ai/import-tasks/${taskId}/confirm`, headers,
      payload: { opId: 'op_confirm_1', targetType: 'purchase', targetId: 'pur_ai_1', confirmed: { name: '深蓝格裙 45cm', totalCents: 16800, category: 'JK' } },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data.state).toBe('confirmed');
    expect(confirmed.json().data.targetId).toBe('pur_ai_1');
    expect(confirmed.json().data.confirmedAt).toBeTypeOf('string');

    // 重复确认（同 opId / 同任务）→ 幂等返回，不新建第二笔、不覆盖
    const again = await instance.inject({
      method: 'POST', url: `/api/v1/ai/import-tasks/${taskId}/confirm`, headers,
      payload: { opId: 'op_confirm_1', targetType: 'purchase', targetId: 'pur_ai_1', confirmed: { name: '深蓝格裙 45cm', totalCents: 1, category: 'JK' } },
    });
    expect(again.statusCode).toBe(200);
    const list = await instance.inject({ method: 'GET', url: '/api/v1/me/purchases', headers });
    expect(list.json().data).toHaveLength(1);
    // 订单未被 confirm 覆盖
    const purchaseDetail = await instance.inject({ method: 'GET', url: '/api/v1/me/purchases/pur_ai_1', headers });
    expect(purchaseDetail.json().data.totalCents).toBe(16800);

    // 他人的任务不可见
    const other = await login(instance, '用户B');
    const stolen = await instance.inject({ method: 'GET', url: `/api/v1/ai/import-tasks/${taskId}`, headers: { authorization: `Bearer ${other.token}` } });
    expect(stolen.statusCode).toBe(404);
  });

  it('Idempotency-Key：重复 POST 订单只创建一笔', async () => {
    const instance = await createApp();
    const { token } = await login(instance);
    const headers = { authorization: `Bearer ${token}`, 'idempotency-key': 'idem-purchase-001' };
    const payload = { id: 'pur_idem_1', name: '幂等格裙', brand: '花笺', totalCents: 25800 };
    const first = await instance.inject({ method: 'POST', url: '/api/v1/me/purchases', headers, payload });
    expect(first.statusCode).toBe(201);
    const second = await instance.inject({ method: 'POST', url: '/api/v1/me/purchases', headers, payload });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);
    const list = await instance.inject({ method: 'GET', url: '/api/v1/me/purchases', headers: { authorization: `Bearer ${token}` } });
    expect(list.json().data).toHaveLength(1);
  });

  it('提醒联动：删除订单清理关联提醒；更新尾款日同步 BALANCE 提醒', async () => {
    const instance = await createApp();
    const { token } = await login(instance);
    const headers = { authorization: `Bearer ${token}` };
    await instance.inject({
      method: 'POST', url: '/api/v1/me/purchases', headers,
      payload: { id: 'pur_rem_1', name: '联动格裙', totalCents: 16800, balanceDueDate: '2026-09-15' },
    });
    await instance.inject({
      method: 'POST', url: '/api/v1/me/reminders', headers,
      payload: { id: 'rem_1', title: '尾款提醒', type: 'BALANCE', remindDate: '2026-09-15', relatedPurchaseId: 'pur_rem_1' },
    });
    // 更新尾款日 → BALANCE 提醒 remindDate 同步
    await instance.inject({
      method: 'PATCH', url: '/api/v1/me/purchases/pur_rem_1', headers,
      payload: { balanceDueDate: '2026-10-01' },
    });
    const reminder = await instance.inject({ method: 'GET', url: '/api/v1/me/reminders/rem_1', headers });
    expect(reminder.json().data.remindDate).toBe('2026-10-01');
    // 删除订单 → 关联提醒一并删除（无孤儿提醒）
    await instance.inject({ method: 'DELETE', url: '/api/v1/me/purchases/pur_rem_1', headers });
    const orphan = await instance.inject({ method: 'GET', url: '/api/v1/me/reminders/rem_1', headers });
    expect(orphan.statusCode).toBe(404);
  });

  it('P1 轻社区：topic 可空、按品牌名关注、帖子点赞与删除', async () => {
    const instance = await createApp();
    const { token } = await login(instance);
    const headers = { authorization: `Bearer ${token}` };
    const { mediaId } = await uploadImage(instance, token, 'outfit');
    const post = await instance.inject({
      method: 'POST', url: '/api/v1/community/posts', headers,
      payload: { mediaId, caption: '今日穿搭', category: 'LOLITA', topic: '' },
    });
    expect(post.statusCode).toBe(201);
    const postId = post.json().data.id as string;
    // 按品牌名关注（内存模式种子品牌：兔缝缝）
    const follow = await instance.inject({
      method: 'POST', url: '/api/v1/brands/follow', headers, payload: { brandId: '兔缝缝' },
    });
    expect(follow.statusCode).toBe(201);
    const followed = await instance.inject({ method: 'GET', url: '/api/v1/brands/followed', headers });
    expect(followed.json().data).toContain('br_rabbit');
    // 点赞
    const liked = await instance.inject({
      method: 'PUT', url: `/api/v1/community/posts/${postId}/like`, headers, payload: { liked: true },
    });
    expect(liked.json().data.likeCount).toBe(1);
    // 删除自己的帖子
    const removed = await instance.inject({ method: 'DELETE', url: `/api/v1/community/posts/${postId}`, headers });
    expect(removed.statusCode).toBe(204);
  });
});
