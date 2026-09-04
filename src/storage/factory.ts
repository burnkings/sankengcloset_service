import type { AppConfig } from '../config.js';
import { LocalObjectStorage } from './local-storage.js';
import { OssObjectStorage } from './oss-storage.js';
import type { ObjectStorage } from './types.js';

/** 按 STORAGE_DRIVER 装配存储实现；oss 模式缺少必填配置时抛错（防静默退回本地盘） */
export function createObjectStorage(config: AppConfig): ObjectStorage {
  if (config.STORAGE_DRIVER === 'oss') {
    if (!config.OSS_REGION || !config.OSS_BUCKET || !config.OSS_ACCESS_KEY_ID || !config.OSS_ACCESS_KEY_SECRET || !config.OSS_PUBLIC_BASE_URL) {
      throw new Error('STORAGE_DRIVER=oss requires OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_PUBLIC_BASE_URL');
    }
    return new OssObjectStorage({
      region: config.OSS_REGION,
      accessKeyId: config.OSS_ACCESS_KEY_ID,
      accessKeySecret: config.OSS_ACCESS_KEY_SECRET,
      bucket: config.OSS_BUCKET,
      publicBaseUrl: config.OSS_PUBLIC_BASE_URL,
    });
  }
  return new LocalObjectStorage(config.UPLOAD_DIR);
}
