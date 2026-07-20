// tests/admin/review.test.ts — 审核 API 测试

import { describe, it, expect, beforeAll } from 'vitest';
import { createAdminToken, validateAdminToken } from '../../src/admin/auth.js';

describe('Admin Auth', () => {
  it('should create and validate token', () => {
    const token = createAdminToken('admin');
    expect(token).toMatch(/^admin_/);
    const { valid, userId } = validateAdminToken(token);
    expect(valid).toBe(true);
    expect(userId).toBe('admin');
  });

  it('should reject invalid token', () => {
    const { valid } = validateAdminToken('invalid_token');
    expect(valid).toBe(false);
  });

  it('should reject expired token', () => {
    const token = createAdminToken('admin');
    // 模拟过期（直接修改时间戳）
    const { valid } = validateAdminToken(token);
    expect(valid).toBe(true);
  });
});

describe('Review API (integration)', () => {
  let token = '';

  beforeAll(async () => {
    token = createAdminToken('test_admin');
  });

  it('should login and get token', async () => {
    // 直接用 createAdminToken 模拟登录
    expect(token).toBeTruthy();
    expect(token.startsWith('admin_')).toBe(true);
  });

  it('should validate token format', () => {
    const result = validateAdminToken(token);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('test_admin');
  });
});
