// crawler/sources/brand-api.ts — 品牌公开 API 适配器
// 职责：获取公开数据，输出 FetchResult
// 禁止：直接写数据库、直接生成 Product、混合业务逻辑

import type { FetchResult } from '../core/types.js';
import { BaseSourceAdapter } from './base.js';

/**
 * 品牌公开 API 适配器
 *
 * 支持两种模式：
 * 1. fixture:// — 本地测试（读取 fixtures/ 下的 JSON 文件）
 * 2. http/https — 真实 HTTP 请求
 *
 * 期望的 API 响应格式：
 * {
 *   "brand": { "id", "name", "category", ... },
 *   "products": [{ "id", "name", "price", ... }]
 * }
 */
export class BrandApiSourceAdapter extends BaseSourceAdapter {
  readonly sourceType = 'OFFICIAL';
  readonly name = '品牌公开 API';

  canHandle(url: string): boolean {
    return url.startsWith('fixture://') || url.startsWith('http://') || url.startsWith('https://');
  }

  protected async doFetch(url: string): Promise<FetchResult> {
    const startTime = Date.now();

    if (url.startsWith('fixture://')) {
      return this.fetchFixture(url, startTime);
    }

    return this.fetchHttp(url, startTime);
  }

  private async fetchFixture(url: string, startTime: number): Promise<FetchResult> {
    const { readFile } = await import('node:fs/promises');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const filename = url.replace('fixture://', '');
    const filePath = resolve(__dirname, '../fixtures', filename);
    const body = await readFile(filePath, 'utf8');

    return {
      url,
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body,
      contentType: 'application/json',
      fetchedAt: new Date(),
      durationMs: Date.now() - startTime,
    };
  }

  private async fetchHttp(url: string, startTime: number): Promise<FetchResult> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json, text/html',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const body = await response.text();

    return {
      url,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      contentType: response.headers.get('content-type') ?? 'application/json',
      fetchedAt: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}
