// crawler/sources/weibo-brand.ts — 微博品牌账号适配器

import type { FetchResult } from '../core/types.js';
import { BaseSourceAdapter } from './base.js';

/**
 * 微博品牌公开账号适配器
 * 模拟从微博公开页面/接口获取品牌动态
 */
export class WeiboBrandSourceAdapter extends BaseSourceAdapter {
  readonly sourceType = 'WEIBO';
  readonly name = '微博品牌公开账号';

  canHandle(url: string): boolean {
    return url.startsWith('fixture://weibo') || url.startsWith('https://weibo.com');
  }

  protected async doFetch(url: string): Promise<FetchResult> {
    if (url.startsWith('fixture://')) {
      const { readFile } = await import('node:fs/promises');
      const { resolve, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const filename = url.replace('fixture://', '');
      const filePath = resolve(__dirname, '../fixtures', filename);
      const body = await readFile(filePath, 'utf8');
      return {
        url, statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body, contentType: 'application/json',
        fetchedAt: new Date(), durationMs: 0,
      };
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': this.userAgent, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await response.text();
    return {
      url, statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body, contentType: response.headers.get('content-type') ?? 'application/json',
      fetchedAt: new Date(), durationMs: 0,
    };
  }
}
