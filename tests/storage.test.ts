import { describe, expect, it } from 'vitest';
import { LocalObjectStorage } from '../src/storage/local-storage.js';
import { OssObjectStorage } from '../src/storage/oss-storage.js';
import { buildObjectKey } from '../src/routes/uploads.js';

describe('ObjectStorage 接口契约', () => {
  it('LocalObjectStorage：无公开 URL，isPublic 恒 false', () => {
    const storage = new LocalObjectStorage('./var/uploads-test');
    expect(storage.isPublic('feed/usr_a/obj_1')).toBe(false);
    expect(storage.publicUrl('feed/usr_a/obj_1')).toBeNull();
    expect(storage.isPublic('private/usr_a/outfit/obj_1')).toBe(false);
  });

  it('OssObjectStorage：公开前缀（feed/products/brands/avatar）可生成 img 域名 URL', () => {
    const storage = new OssObjectStorage({
      region: 'oss-cn-hangzhou',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'sankengcloset',
      publicBaseUrl: 'https://img.sankengcloset.icu',
    });
    expect(storage.isPublic('feed/usr_a/obj_1')).toBe(true);
    expect(storage.publicUrl('feed/usr_a/obj_1')).toBe('https://img.sankengcloset.icu/feed/usr_a/obj_1');
    expect(storage.isPublic('products/br_x/logo.png')).toBe(true);
    expect(storage.isPublic('brands/br_x/logo.png')).toBe(true);
    expect(storage.isPublic('avatar/usr_a/a.png')).toBe(true);
  });

  it('OssObjectStorage：私有前缀不生成公开 URL（publicUrl null）', () => {
    const storage = new OssObjectStorage({
      region: 'oss-cn-hangzhou',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'sankengcloset',
      publicBaseUrl: 'https://img.sankengcloset.icu/',
    });
    expect(storage.isPublic('private/usr_a/purchase_import/obj_1')).toBe(false);
    expect(storage.publicUrl('private/usr_a/purchase_import/obj_1')).toBeNull();
    expect(storage.publicUrl('usr_a/outfit/obj_1')).toBeNull();
  });

  it('publicBaseUrl 末尾斜杠被规范化', () => {
    const storage = new OssObjectStorage({
      region: 'oss-cn-hangzhou',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      bucket: 'sankengcloset',
      publicBaseUrl: 'https://img.sankengcloset.icu///',
    });
    expect(storage.publicUrl('feed/usr_a/obj_1')).toBe('https://img.sankengcloset.icu/feed/usr_a/obj_1');
  });

  it('buildObjectKey：outfit 走 feed/ 公开前缀，其余走 private/ 私有前缀', () => {
    expect(buildObjectKey('usr_a', 'outfit', 'obj_1')).toBe('feed/usr_a/obj_1');
    expect(buildObjectKey('usr_a', 'purchase_import', 'obj_1')).toBe('private/usr_a/purchase_import/obj_1');
    expect(buildObjectKey('usr_a', 'ai_import', 'obj_1')).toBe('private/usr_a/ai_import/obj_1');
    expect(buildObjectKey('usr_a', 'wardrobe', 'obj_1')).toBe('private/usr_a/wardrobe/obj_1');
  });
});
