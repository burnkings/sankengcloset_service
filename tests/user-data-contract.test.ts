import { describe, expect, it } from 'vitest';
import { purchaseSchema, reminderSchema, wardrobeSchema } from '../src/routes/user-data.js';

describe('前端个人资产契约', () => {
  it('购买记录保留来源链路与剩余金额字段', () => {
    const parsed = purchaseSchema.parse({
      id: 'purchase_client_1',
      name: '月夜蔷薇 JSK',
      remainingCents: 32_000,
      wishId: 'wish_1',
      wardrobeId: 'wardrobe_1',
      productId: 'prd_jk_navy_45',
      releaseId: 'release_1',
    });
    expect(parsed).toMatchObject({
      remainingCents: 32_000,
      wishId: 'wish_1',
      wardrobeId: 'wardrobe_1',
      productId: 'prd_jk_navy_45',
      releaseId: 'release_1',
    });
  });

  it('衣橱保留购买与心愿来源字段', () => {
    const parsed = wardrobeSchema.parse({ id: 'wardrobe_client_1', name: '深蓝格裙', category: 'JK', purchaseId: 'purchase_1', wishId: 'wish_1' });
    expect(parsed.purchaseId).toBe('purchase_1');
    expect(parsed.wishId).toBe('wish_1');
  });

  it('提醒保留全天与衣橱绑定字段', () => {
    const parsed = reminderSchema.parse({
      id: 'reminder_client_1',
      title: '发售提醒',
      remindDate: '2026-09-10',
      isAllDay: true,
      wardrobeBindings: ['wardrobe_1', 'wardrobe_2'],
    });
    expect(parsed.isAllDay).toBe(true);
    expect(parsed.wardrobeBindings).toEqual(['wardrobe_1', 'wardrobe_2']);
  });
});
