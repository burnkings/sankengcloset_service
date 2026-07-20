// src/admin/auth.ts — 简单 Token 认证

import type { FastifyRequest, FastifyReply } from 'fastify';

const ADMIN_TOKENS = new Map<string, { userId: string; createdAt: number }>();

/** 生成管理员认证 Token */
export function createAdminToken(userId: string): string {
  const token = `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  ADMIN_TOKENS.set(token, { userId, createdAt: Date.now() });
  return token;
}

/** 验证 Token */
export function validateAdminToken(token: string): { valid: boolean; userId: string } {
  const entry = ADMIN_TOKENS.get(token);
  if (!entry) return { valid: false, userId: '' };
  // Token 24小时过期
  if (Date.now() - entry.createdAt > 24 * 60 * 60 * 1000) {
    ADMIN_TOKENS.delete(token);
    return { valid: false, userId: '' };
  }
  return { valid: true, userId: entry.userId };
}

/** Fastify 认证钩子 */
export async function adminAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: '需要认证', code: 'UNAUTHORIZED' });
  }
  const token = authHeader.slice(7);
  const { valid, userId } = validateAdminToken(token);
  if (!valid) {
    return reply.code(401).send({ error: 'Token 无效或已过期', code: 'INVALID_TOKEN' });
  }
  // 将 userId 注入 request
  (request as any).adminUserId = userId;
}

/** 获取当前管理员 ID */
export function getAdminUserId(request: FastifyRequest): string {
  return (request as any).adminUserId ?? 'unknown';
}
