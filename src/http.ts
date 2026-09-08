import type { FastifyRequest } from 'fastify';
import { AppProblem } from './lib/problem.js';

export function success<T>(request: FastifyRequest, data: T, page?: Record<string, unknown>) {
  return page === undefined ? { requestId: request.id, data } : { requestId: request.id, data, page };
}

export async function requireUser(request: FastifyRequest): Promise<string> {
  const payload = await request.jwtVerify<{ sub: string; kind: string }>();
  if (payload.kind !== 'access' || !payload.sub) throw new AppProblem(401,'UNAUTHORIZED','请先登录');
  return payload.sub;
}
