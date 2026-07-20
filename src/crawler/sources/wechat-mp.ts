// crawler/sources/wechat-mp.ts — 微信公众号 RSS 适配器

import type { FetchResult } from '../core/types.js';
import { BaseSourceAdapter } from './base.js';

/**
 * 微信公众号 RSS/公开页面适配器
 * 模拟从微信公众号文章获取品牌商品信息
 */
export class WechatMpSourceAdapter extends BaseSourceAdapter {
  readonly sourceType = 'WECHAT_MP';
  readonly name = '微信公众号';

  canHandle(url: string): boolean {
    return url.startsWith('fixture://wechat') || url.startsWith('https://mp.weixin.qq.com');
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
