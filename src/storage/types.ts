/**
 * 对象存储统一接口。
 * 实现：LocalObjectStorage（本地磁盘，默认）/ OssObjectStorage（阿里云 OSS）。
 * 方法契约：put/get/delete 幂等；publicUrl 返回可公开访问的 URL（无公开访问能力返回 null）。
 */
export interface ObjectStorage {
  put(objectKey: string, data: Buffer): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  /** 该 objectKey 是否可通过 publicUrl 匿名访问（bucket policy 放行前缀） */
  isPublic(objectKey: string): boolean;
  /** 公开访问 URL；不可公开访问返回 null */
  publicUrl(objectKey: string): string | null;
}
