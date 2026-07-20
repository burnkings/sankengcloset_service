// crawler/images/image-downloader.ts — 图片下载器

import { createHash } from 'node:crypto';
import { SsrfGuard } from './ssrf-guard.js';

export interface DownloadResult {
  success: boolean;
  buffer: Buffer | null;
  contentType: string;
  contentLength: number;
  hash: string;        // SHA-256
  width: number;
  height: number;
  url: string;
  error?: string;
}

export interface DownloadConfig {
  maxFileSize: number;      // bytes, default 10MB
  timeoutMs: number;        // default 15000
  maxRetries: number;       // default 2
  allowedTypes: string[];   // default ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
}

const DEFAULT_CONFIG: DownloadConfig = {
  maxFileSize: 10 * 1024 * 1024,
  timeoutMs: 15000,
  maxRetries: 2,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

export class ImageDownloader {
  private ssrfGuard = new SsrfGuard();
  private config: DownloadConfig;

  constructor(config: Partial<DownloadConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async download(url: string): Promise<DownloadResult> {
    // SSRF 防护
    const validation = this.ssrfGuard.validate(url);
    if (!validation.safe) {
      return { success: false, buffer: null, contentType: '', contentLength: 0, hash: '', width: 0, height: 0, url, error: `SSRF: ${validation.reason}` };
    }

    let lastError = '';
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'SankengBot/1.0 Image Fetcher',
            'Accept': 'image/*',
          },
          signal: AbortSignal.timeout(this.config.timeoutMs),
          redirect: 'follow',
        });

        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }

        // Content-Type 校验
        const contentType = response.headers.get('content-type') ?? '';
        const normalizedType = (contentType.split(';')[0] ?? '').trim().toLowerCase();
        if (!this.config.allowedTypes.includes(normalizedType)) {
          return { success: false, buffer: null, contentType: normalizedType, contentLength: 0, hash: '', width: 0, height: 0, url, error: `不允许的类型: ${normalizedType}` };
        }

        // 文件大小校验
        const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
        if (contentLength > this.config.maxFileSize) {
          return { success: false, buffer: null, contentType: normalizedType, contentLength, hash: '', width: 0, height: 0, url, error: `文件过大: ${(contentLength / 1024 / 1024).toFixed(1)}MB` };
        }

        // 下载内容
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length > this.config.maxFileSize) {
          return { success: false, buffer: null, contentType: normalizedType, contentLength: buffer.length, hash: '', width: 0, height: 0, url, error: `文件过大: ${(buffer.length / 1024 / 1024).toFixed(1)}MB` };
        }

        // 哈希计算
        const hash = createHash('sha256').update(buffer).digest('hex');

        // 读取图片尺寸
        let width = 0;
        let height = 0;
        try {
          const sharp = (await import('sharp')).default;
          const metadata: any = await sharp(buffer).metadata();
          width = metadata?.width ?? 0;
          height = metadata?.height ?? 0;
        } catch {
          // sharp 不可用时跳过
        }

        return {
          success: true,
          buffer,
          contentType: normalizedType,
          contentLength: buffer.length,
          hash,
          width,
          height,
          url,
        };
      } catch (e) {
        lastError = (e as Error).message;
        if (attempt < this.config.maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    return { success: false, buffer: null, contentType: '', contentLength: 0, hash: '', width: 0, height: 0, url, error: lastError };
  }
}
