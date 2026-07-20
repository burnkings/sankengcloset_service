// crawler/images/local-storage.ts — 本地磁盘存储

import { writeFile, mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';

export interface StoredImage {
  objectKey: string;
  localPath: string;
  url: string;
  sizeBytes: number;
}

export class LocalImageStorage {
  private baseDir: string;
  private baseUrl: string;

  constructor(opts: { baseDir: string; baseUrl?: string }) {
    this.baseDir = opts.baseDir;
    this.baseUrl = opts.baseUrl ?? '';
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(join(this.baseDir, 'originals'), { recursive: true });
    await mkdir(join(this.baseDir, 'thumbnails'), { recursive: true });
  }

  /** 存储原始图片 */
  async storeOriginal(buffer: Buffer, hash: string, ext: string): Promise<StoredImage> {
    const filename = `${hash}${ext}`;
    const objectKey = `originals/${filename}`;
    const localPath = join(this.baseDir, objectKey);
    await writeFile(localPath, buffer);
    const info = await stat(localPath);
    return {
      objectKey,
      localPath,
      url: this.baseUrl ? `${this.baseUrl}/${objectKey}` : objectKey,
      sizeBytes: info.size,
    };
  }

  /** 存储缩略图 */
  async storeThumbnail(buffer: Buffer, hash: string, ext: string, width: number): Promise<StoredImage> {
    const filename = `${hash}_${width}w${ext}`;
    const objectKey = `thumbnails/${filename}`;
    const localPath = join(this.baseDir, objectKey);
    await writeFile(localPath, buffer);
    const info = await stat(localPath);
    return {
      objectKey,
      localPath,
      url: this.baseUrl ? `${this.baseUrl}/${objectKey}` : objectKey,
      sizeBytes: info.size,
    };
  }

  /** 检查文件是否已存在 */
  async exists(objectKey: string): Promise<boolean> {
    try {
      await stat(join(this.baseDir, objectKey));
      return true;
    } catch {
      return false;
    }
  }

  /** 删除文件 */
  async delete(objectKey: string): Promise<void> {
    try {
      await unlink(join(this.baseDir, objectKey));
    } catch {
      // 文件不存在时忽略
    }
  }

  /** 获取磁盘占用 */
  async getDiskUsage(): Promise<{ originals: number; thumbnails: number; totalBytes: number; fileCount: number }> {
    const originals = await this.getDirSize(join(this.baseDir, 'originals'));
    const thumbnails = await this.getDirSize(join(this.baseDir, 'thumbnails'));
    return {
      originals: originals.bytes,
      thumbnails: thumbnails.bytes,
      totalBytes: originals.bytes + thumbnails.bytes,
      fileCount: originals.count + thumbnails.count,
    };
  }

  private async getDirSize(dir: string): Promise<{ bytes: number; count: number }> {
    let bytes = 0;
    let count = 0;
    try {
      const files = await readdir(dir);
      for (const file of files) {
        const info = await stat(join(dir, file));
        if (info.isFile()) {
          bytes += info.size;
          count++;
        }
      }
    } catch {
      // 目录不存在
    }
    return { bytes, count };
  }
}
