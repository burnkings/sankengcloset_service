import OSS from 'ali-oss';
import type { ObjectStorage } from './types.js';

/**
 * 阿里云 OSS 存储实现。
 * 公开前缀与 bucket policy 对齐（feed/ products/ brands/ avatar/ 匿名可读，
 * 见 oss-storage-architecture.md）：公开媒体可经 img 域名直出，私有媒体仅 API 代理读。
 */
export class OssObjectStorage implements ObjectStorage {
  private readonly client: OSS;
  private readonly publicBaseUrl: string;
  /** 与 bucket policy 放行的匿名读前缀一致 */
  private static readonly PUBLIC_PREFIXES = ['feed/', 'products/', 'brands/', 'avatar/'];

  constructor(options: {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    /** 如 https://img.sankengcloset.icu（不带末尾斜杠） */
    publicBaseUrl: string;
  }) {
    this.client = new OSS({
      region: options.region,
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      bucket: options.bucket,
    });
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');
  }

  async put(objectKey: string, data: Buffer): Promise<void> {
    await this.client.put(objectKey, data);
  }

  async get(objectKey: string): Promise<Buffer> {
    const result = await this.client.get(objectKey);
    return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content as unknown as string);
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.delete(objectKey);
  }

  isPublic(objectKey: string): boolean {
    return OssObjectStorage.PUBLIC_PREFIXES.some((prefix) => objectKey.startsWith(prefix));
  }

  publicUrl(objectKey: string): string | null {
    if (!this.isPublic(objectKey)) return null;
    return `${this.publicBaseUrl}/${objectKey}`;
  }
}
