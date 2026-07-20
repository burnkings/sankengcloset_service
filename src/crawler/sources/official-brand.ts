// crawler/sources/official-brand.ts — 品牌官网公开 API 适配器

import type { FetchResult } from '../core/types.js';
import { BaseSourceAdapter } from './base.js';

/**
 * 品牌官网公开 API 适配器
 *
 * 假设品牌官网提供公开 JSON 接口：
 *   GET /api/products → { brand: {...}, products: [...] }
 *
 * 本适配器支持：
 * - fixture:// 协议（本地测试）
 * - http/https 协议（真实采集）
 */
export class OfficialBrandSourceAdapter extends BaseSourceAdapter {
  readonly sourceType = 'OFFICIAL';
  readonly name = '品牌官网公开 API';

  canHandle(url: string): boolean {
    return url.startsWith('fixture://') || url.startsWith('http://') || url.startsWith('https://');
  }

  protected async doFetch(url: string): Promise<FetchResult> {
    const startTime = Date.now();

    if (url.startsWith('fixture://')) {
      // Fixture 模式：读取本地文件
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

    // 真实 HTTP 模式
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json',
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
