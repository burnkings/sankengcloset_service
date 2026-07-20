// src/scheduler/monitor.ts — 系统监控

import postgres from 'postgres';
import { statfs } from 'node:fs/promises';

export interface HealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  value?: number;
}

export interface SystemHealth {
  timestamp: Date;
  checks: HealthCheck[];
  overall: 'ok' | 'warn' | 'error';
}

export class SystemMonitor {
  constructor(private readonly sql: postgres.Sql) {}

  /** 执行所有健康检查 */
  async checkAll(): Promise<SystemHealth> {
    const checks = await Promise.all([
      this.checkDiskSpace(),
      this.checkDatabase(),
      this.checkProductCount(),
      this.checkCrawlErrors(),
      this.checkImageStorage(),
    ]);
    const overall = checks.some(c => c.status === 'error') ? 'error'
      : checks.some(c => c.status === 'warn') ? 'warn' : 'ok';
    return { timestamp: new Date(), checks, overall };
  }

  /** 磁盘空间检查 */
  async checkDiskSpace(): Promise<HealthCheck> {
    try {
      const info = await statfs('/');
      const total = info.blocks * info.frsize;
      const free = info.bavail * info.frsize;
      const usedPercent = ((total - free) / total) * 100;
      if (usedPercent > 90) return { name: 'disk', status: 'error', message: `磁盘使用率 ${usedPercent.toFixed(1)}%`, value: usedPercent };
      if (usedPercent > 80) return { name: 'disk', status: 'warn', message: `磁盘使用率 ${usedPercent.toFixed(1)}%`, value: usedPercent };
      return { name: 'disk', status: 'ok', message: `磁盘使用率 ${usedPercent.toFixed(1)}%`, value: usedPercent };
    } catch {
      return { name: 'disk', status: 'warn', message: '无法检查磁盘空间' };
    }
  }

  /** 数据库连接检查 */
  async checkDatabase(): Promise<HealthCheck> {
    try {
      await this.sql`SELECT 1`;
      return { name: 'database', status: 'ok', message: '数据库连接正常' };
    } catch (e) {
      return { name: 'database', status: 'error', message: `数据库连接失败: ${(e as Error).message}` };
    }
  }

  /** 商品数量检查 */
  async checkProductCount(): Promise<HealthCheck> {
    try {
      const result = await this.sql`SELECT count(*) as cnt FROM products WHERE deleted_at IS NULL`;
      const count = Number(result[0]?.cnt ?? 0);
      if (count === 0) return { name: 'products', status: 'warn', message: '商品数量为 0', value: 0 };
      return { name: 'products', status: 'ok', message: `商品数量: ${count}`, value: count };
    } catch (e) {
      return { name: 'products', status: 'error', message: `查询失败: ${(e as Error).message}` };
    }
  }

  /** 采集错误检查 */
  async checkCrawlErrors(): Promise<HealthCheck> {
    try {
      const result = await this.sql`SELECT count(*) as cnt FROM crawl_jobs WHERE status = 'FAILED' AND created_at > now() - interval '24 hours'`;
      const count = Number(result[0]?.cnt ?? 0);
      if (count > 5) return { name: 'crawl_errors', status: 'error', message: `24小时内 ${count} 次采集失败`, value: count };
      if (count > 0) return { name: 'crawl_errors', status: 'warn', message: `24小时内 ${count} 次采集失败`, value: count };
      return { name: 'crawl_errors', status: 'ok', message: '24小时内无采集失败', value: 0 };
    } catch {
      return { name: 'crawl_errors', status: 'ok', message: '无法检查采集错误' };
    }
  }

  /** 图片存储检查 */
  async checkImageStorage(): Promise<HealthCheck> {
    try {
      const result = await this.sql`SELECT count(*) as cnt FROM products WHERE cover_url != '' AND deleted_at IS NULL`;
      const count = Number(result[0]?.cnt ?? 0);
      return { name: 'images', status: 'ok', message: `有封面图的产品: ${count}`, value: count };
    } catch {
      return { name: 'images', status: 'ok', message: '无法检查图片存储' };
    }
  }

  /** 数据量异常检测 */
  async detectAnomaly(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    try {
      // 检查最近1小时新增产品数
      const recent = await this.sql`SELECT count(*) as cnt FROM products WHERE created_at > now() - interval '1 hour'`;
      const count = Number(recent[0]?.cnt ?? 0);
      if (count > 100) {
        checks.push({ name: 'anomaly_volume', status: 'warn', message: `1小时内新增 ${count} 条产品（可能异常）`, value: count });
      }
    } catch {}
    return checks;
  }
}
