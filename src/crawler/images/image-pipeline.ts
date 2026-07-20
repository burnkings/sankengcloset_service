// crawler/images/image-pipeline.ts — 图片处理管道

import { ImageDownloader, type DownloadResult } from './image-downloader.js';
import { LocalImageStorage, type StoredImage } from './local-storage.js';
import { ThumbnailGenerator } from './thumbnail-generator.js';

export interface ProcessedImage {
  originalUrl: string;
  objectKey: string;
  storedUrl: string;
  hash: string;
  width: number;
  height: number;
  sizeBytes: number;
  contentType: string;
  thumbnailUrls: Map<number, string>;
  status: 'success' | 'duplicate' | 'invalid' | 'error';
  error?: string | undefined;
}

export class ImagePipeline {
  private downloader: ImageDownloader;
  private storage: LocalImageStorage;
  private thumbnailGen: ThumbnailGenerator;
  private seenHashes = new Map<string, string>(); // hash → objectKey

  constructor(opts: {
    storageDir: string;
    storageBaseUrl?: string;
    maxFileSize?: number;
    timeoutMs?: number;
  }) {
    this.downloader = new ImageDownloader({
      maxFileSize: opts.maxFileSize ?? 10 * 1024 * 1024,
      timeoutMs: opts.timeoutMs ?? 15000,
    });
    this.storage = new LocalImageStorage({
      baseDir: opts.storageDir,
      baseUrl: opts.storageBaseUrl ?? '' as string,
    });
    this.thumbnailGen = new ThumbnailGenerator();
  }

  async init(): Promise<void> {
    await this.storage.init();
  }

  /** 处理单张图片 */
  async process(url: string): Promise<ProcessedImage> {
    // 1. 下载
    const download = await this.downloader.download(url);
    if (!download.success || !download.buffer) {
      return {
        originalUrl: url, objectKey: '', storedUrl: '', hash: '', width: 0, height: 0,
        sizeBytes: 0, contentType: '', thumbnailUrls: new Map(), status: 'error', error: download.error,
      };
    }

    // 2. 去重（基于哈希）
    if (this.seenHashes.has(download.hash)) {
      const existingKey = this.seenHashes.get(download.hash)!;
      return {
        originalUrl: url, objectKey: existingKey, storedUrl: '', hash: download.hash,
        width: download.width, height: download.height, sizeBytes: download.contentLength,
        contentType: download.contentType, thumbnailUrls: new Map(), status: 'duplicate',
      };
    }

    // 3. 存储原始图
    const ext = this.getExtension(download.contentType);
    const stored = await this.storage.storeOriginal(download.buffer, download.hash, ext);
    this.seenHashes.set(download.hash, stored.objectKey);

    // 4. 生成缩略图
    const thumbnailUrls = new Map<number, string>();
    const sizes = [120, 240, 480];
    for (const size of sizes) {
      const thumb = await this.thumbnailGen.generate(download.buffer, size);
      if (thumb) {
        const thumbStored = await this.storage.storeThumbnail(thumb.buffer, download.hash, `.${thumb.format}`, size);
        thumbnailUrls.set(size, thumbStored.url);
      }
    }

    return {
      originalUrl: url,
      objectKey: stored.objectKey,
      storedUrl: stored.url,
      hash: download.hash,
      width: download.width,
      height: download.height,
      sizeBytes: stored.sizeBytes,
      contentType: download.contentType,
      thumbnailUrls,
      status: 'success',
    };
  }

  /** 批量处理图片 */
  async processBatch(urls: string[]): Promise<ProcessedImage[]> {
    const results: ProcessedImage[] = [];
    for (const url of urls) {
      if (!url) continue;
      results.push(await this.process(url));
    }
    return results;
  }

  /** 获取磁盘占用 */
  async getDiskUsage() {
    return this.storage.getDiskUsage();
  }

  /** 检查文件是否已存在（不下载） */
  async checkExists(hash: string): Promise<boolean> {
    const key = `originals/${hash}${'.jpg'}`;
    return this.storage.exists(key);
  }

  private getExtension(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    };
    return map[contentType] ?? '.jpg';
  }
}
