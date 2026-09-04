import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../http.js';
import type { AppRepository } from '../repositories/contracts.js';

export const calendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month 格式应为 YYYY-MM').default(''),
  limit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(100).default(50)),
});

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 发售日历：按月聚合 product_releases（published）与 sale_events 的发售事件。
 * 数据由爬虫/导入域填充；无数据时返回空数组（前端空态兜底）。
 */
export async function registerCalendarRoutes(app: FastifyInstance, repository: AppRepository) {
  app.get('/api/v1/calendar', async (request) => {
    const query = calendarQuerySchema.parse(request.query);
    const month = query.month !== '' ? query.month : currentMonthKey();
    const events = await repository.listCalendar(month, query.limit);
    return success(request, events, { month });
  });
}
