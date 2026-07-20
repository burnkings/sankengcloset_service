// src/scheduler/task-scheduler.ts — 任务调度器

export interface ScheduledTask {
  id: string;
  name: string;
  sourceType: string;
  scheduleCron: string;     // 简化版：间隔分钟数
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: Date | null;
  lastStatus: 'idle' | 'running' | 'success' | 'failed' | 'paused';
  consecutiveFailures: number;
  maxRetries: number;
  timeoutMs: number;
  lastError: string;
}

export interface TaskRunRecord {
  taskId: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'running' | 'success' | 'failed' | 'timeout';
  itemsProcessed: number;
  errors: string[];
}

export class TaskScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private running = new Map<string, TaskRunRecord>();
  private history: TaskRunRecord[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pausedSources = new Set<string>();
  private pausedBrands = new Set<string>();

  constructor(private readonly onRun: (task: ScheduledTask) => Promise<void>) {}

  /** 注册任务 */
  register(task: Omit<ScheduledTask, 'lastRunAt' | 'lastStatus' | 'consecutiveFailures' | 'lastError'>): void {
    this.tasks.set(task.id, {
      ...task,
      lastRunAt: null,
      lastStatus: 'idle',
      consecutiveFailures: 0,
      lastError: '',
    });
  }

  /** 启动调度 */
  start(): void {
    for (const [id, task] of this.tasks) {
      if (task.enabled) this.scheduleNext(id);
    }
  }

  /** 停止所有 */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** 手工触发 */
  async trigger(taskId: string): Promise<TaskRunRecord | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (this.running.has(taskId)) return null;
    return this.executeTask(task);
  }

  /** 暂停/恢复来源 */
  pauseSource(sourceType: string): void { this.pausedSources.add(sourceType); }
  resumeSource(sourceType: string): void { this.pausedSources.delete(sourceType); }

  /** 暂停/恢复品牌 */
  pauseBrand(brandId: string): void { this.pausedBrands.add(brandId); }
  resumeBrand(brandId: string): void { this.pausedBrands.delete(brandId); }

  /** 获取任务状态 */
  getTaskStatus(taskId: string): ScheduledTask | undefined { return this.tasks.get(taskId); }
  getAllTasks(): ScheduledTask[] { return [...this.tasks.values()]; }
  getRunning(): string[] { return [...this.running.keys()]; }
  getHistory(limit: number = 20): TaskRunRecord[] { return this.history.slice(-limit); }

  /** 检查是否可以执行 */
  private canRun(task: ScheduledTask): boolean {
    if (!task.enabled) return false;
    if (this.running.has(task.id)) return false;
    if (this.pausedSources.has(task.sourceType)) return false;
    if (task.consecutiveFailures >= task.maxRetries * 3) return false;
    return true;
  }

  /** 调度下一次执行 */
  private scheduleNext(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled) return;
    const delay = task.intervalMinutes * 60 * 1000;
    const timer = setTimeout(() => this.executeTask(task), delay);
    this.timers.set(taskId, timer);
  }

  /** 执行任务 */
  private async executeTask(task: ScheduledTask): Promise<TaskRunRecord> {
    if (!this.canRun(task)) {
      return { taskId: task.id, startedAt: new Date(), finishedAt: new Date(), status: 'timeout', itemsProcessed: 0, errors: ['任务不可执行（暂停或超过重试次数）'] };
    }

    const record: TaskRunRecord = {
      taskId: task.id,
      startedAt: new Date(),
      finishedAt: null,
      status: 'running',
      itemsProcessed: 0,
      errors: [],
    };
    this.running.set(task.id, record);

    try {
      // 超时控制
      await Promise.race([
        this.onRun(task).then(() => { record.status = 'success'; }),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), task.timeoutMs)),
      ]);
      task.consecutiveFailures = 0;
    } catch (e) {
      record.status = 'failed';
      record.errors.push((e as Error).message);
      task.consecutiveFailures++;
      task.lastError = (e as Error).message;
      if (task.consecutiveFailures >= task.maxRetries * 3) {
        task.enabled = false;
      }
    } finally {
      record.finishedAt = new Date();
      task.lastRunAt = record.startedAt;
      task.lastStatus = record.status === 'success' ? 'success' : 'failed';
      this.running.delete(task.id);
      this.history.push(record);
      if (this.history.length > 100) this.history = this.history.slice(-100);
      this.scheduleNext(task.id);
    }

    return record;
  }
}
