export class AppProblem extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export function notFound(message = '资源不存在'): AppProblem {
  return new AppProblem(404, 'NOT_FOUND', message, false);
}

export function conflict(message: string): AppProblem {
  return new AppProblem(409, 'CONFLICT', message, false);
}

export function badRequest(message: string): AppProblem {
  return new AppProblem(400, 'BAD_REQUEST', message, false);
}
