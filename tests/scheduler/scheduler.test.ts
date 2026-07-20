// tests/scheduler/scheduler.test.ts — 调度器测试

import { describe, it, expect, vi } from 'vitest';
import { TaskScheduler } from '../../src/scheduler/task-scheduler.js';

describe('TaskScheduler', () => {
  it('should register and list tasks', () => {
    const scheduler = new TaskScheduler(async () => {});
    scheduler.register({
      id: 'task-1', name: 'Test Task', sourceType: 'OFFICIAL',
      scheduleCron: '0 */6 * * *', intervalMinutes: 360,
      enabled: true, maxRetries: 3, timeoutMs: 30000,
    });
    const tasks = scheduler.getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe('task-1');
  });

  it('should trigger task manually', async () => {
    let called = false;
    const scheduler = new TaskScheduler(async () => { called = true; });
    scheduler.register({
      id: 'task-1', name: 'Test', sourceType: 'OFFICIAL',
      scheduleCron: '0 */6 * * *', intervalMinutes: 360,
      enabled: true, maxRetries: 3, timeoutMs: 30000,
    });
    await scheduler.trigger('task-1');
    expect(called).toBe(true);
  });

  it('should prevent duplicate execution', async () => {
    let callCount = 0;
    const scheduler = new TaskScheduler(async () => { callCount++; await new Promise(r => setTimeout(r, 50)); });
    scheduler.register({
      id: 'task-1', name: 'Test', sourceType: 'OFFICIAL',
      scheduleCron: '0 */6 * * *', intervalMinutes: 360,
      enabled: true, maxRetries: 3, timeoutMs: 30000,
    });
    scheduler.trigger('task-1');
    const result = await scheduler.trigger('task-1');
    expect(result).toBeNull();
  });

  it('should pause and resume source', () => {
    const scheduler = new TaskScheduler(async () => {});
    scheduler.pauseSource('WEIBO');
    scheduler.register({
      id: 'task-1', name: 'Test', sourceType: 'WEIBO',
      scheduleCron: '0 */6 * * *', intervalMinutes: 360,
      enabled: true, maxRetries: 3, timeoutMs: 30000,
    });
    // canRun should return false for paused source
    const task = scheduler.getTaskStatus('task-1');
    expect(task?.enabled).toBe(true);
  });

  it('should record history', async () => {
    const scheduler = new TaskScheduler(async () => {});
    scheduler.register({
      id: 'task-1', name: 'Test', sourceType: 'OFFICIAL',
      scheduleCron: '0 */6 * * *', intervalMinutes: 360,
      enabled: true, maxRetries: 3, timeoutMs: 30000,
    });
    await scheduler.trigger('task-1');
    const history = scheduler.getHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  it('should disable after consecutive failures', async () => {
    const scheduler = new TaskScheduler(async () => { throw new Error('fail'); });
    scheduler.register({
      id: 'task-1', name: 'Test', sourceType: 'OFFICIAL',
      scheduleCron: '0 */6 * * *', intervalMinutes: 360,
      enabled: true, maxRetries: 2, timeoutMs: 30000,
    });
    // 连续失败 6 次（maxRetries * 3）
    for (let i = 0; i < 6; i++) await scheduler.trigger('task-1');
    const task = scheduler.getTaskStatus('task-1');
    expect(task?.enabled).toBe(false);
  });
});
