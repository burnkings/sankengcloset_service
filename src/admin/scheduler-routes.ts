// src/admin/scheduler-routes.ts — 调度管理 API

import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { adminAuthHook, getAdminUserId } from './auth.js';
import type { TaskScheduler } from '../scheduler/task-scheduler.js';
import type { SystemMonitor } from '../scheduler/monitor.js';

export async function registerSchedulerRoutes(
  app: FastifyInstance,
  sql: postgres.Sql,
  scheduler: TaskScheduler,
  monitor: SystemMonitor,
) {
  app.addHook('preHandler', adminAuthHook);

  // GET /api/admin/scheduler/tasks — 任务列表
  app.get('/api/admin/scheduler/tasks', async () => {
    const tasks = scheduler.getAllTasks();
    return { tasks, running: scheduler.getRunning() };
  });

  // POST /api/admin/scheduler/tasks/:id/trigger — 手工触发
  app.post('/api/admin/scheduler/tasks/:id/trigger', async (request) => {
    const { id } = request.params as { id: string };
    const record = await scheduler.trigger(id);
    if (!record) return { error: '任务不存在或正在运行' };
    return { record };
  });

  // POST /api/admin/scheduler/tasks/:id/pause — 暂停任务
  app.post('/api/admin/scheduler/tasks/:id/pause', async (request) => {
    const { id } = request.params as { id: string };
    const task = scheduler.getTaskStatus(id);
    if (!task) return { error: '任务不存在' };
    task.enabled = false;
    return { success: true, taskId: id };
  });

  // POST /api/admin/scheduler/source/:type/pause — 暂停来源
  app.post('/api/admin/scheduler/source/:type/pause', async (request) => {
    const { type } = request.params as { type: string };
    scheduler.pauseSource(type);
    return { success: true, sourceType: type, status: 'paused' };
  });

  // POST /api/admin/scheduler/source/:type/resume — 恢复来源
  app.post('/api/admin/scheduler/source/:type/resume', async (request) => {
    const { type } = request.params as { type: string };
    scheduler.resumeSource(type);
    return { success: true, sourceType: type, status: 'resumed' };
  });

  // GET /api/admin/scheduler/history — 执行历史
  app.get('/api/admin/scheduler/history', async (request) => {
    const query = (request.query as any) || {};
    const limit = Number(query.limit) || 20;
    return { history: scheduler.getHistory(limit) };
  });

  // GET /api/admin/health — 系统健康检查
  app.get('/api/admin/health', async () => {
    return monitor.checkAll();
  });
}
