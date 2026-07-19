import type { FastifyRequest } from 'fastify';

export function success<T>(request: FastifyRequest, data: T, page?: Record<string, unknown>) {
  return page === undefined ? { requestId: request.id, data } : { requestId: request.id, data, page };
}

export async function requireUser(request: FastifyRequest): Promise<string> {
  const payload = await request.jwtVerify<{ sub: string; kind: string }>();
  if (payload.kind !== 'access') throw new Error('Invalid access token');
  return payload.sub;
}
