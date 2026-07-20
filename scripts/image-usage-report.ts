// scripts/image-usage-report.ts — 图片磁盘占用报告

import postgres from 'postgres';
import { LocalImageStorage } from '../src/crawler/images/local-storage.js';
import { resolve } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:sankeng@localhost:5432/sankeng';
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? resolve(process.cwd(), 'var/uploads/images');
const sql = postgres(DATABASE_URL, { max: 1 });

async function main() {
  console.log('=== Phase D6: 图片处理报告 ===\n');

  // 1. 数据库中的图片关联
  const productImages = await sql`
    SELECT count(*) as total FROM products WHERE deleted_at IS NULL AND cover_url != ''
  `;
  const allImages = await sql`
    SELECT count(*) as total FROM products WHERE deleted_at IS NULL AND array_length(images, 1) > 0
  `;
  const imageObjects = await sql`SELECT count(*) as total FROM product_images`;

  console.log('--- 数据库图片统计 ---');
  console.log(`  有封面图的产品: ${(productImages[0] ?? {total: 0}).total}`);
  console.log(`  有图片列表的产品: ${(allImages[0] ?? {total: 0}).total}`);
  console.log(`  product_images 记录: ${(imageObjects[0] ?? {total: 0}).total}`);

  // 2. 本地磁盘占用
  const storage = new LocalImageStorage({ baseDir: UPLOAD_DIR });
  try {
    const usage = await storage.getDiskUsage();
    console.log('\n--- 本地磁盘占用 ---');
    console.log(`  原始图片: ${(usage.originals / 1024).toFixed(1)} KB (${usage.fileCount} 个文件)`);
    console.log(`  缩略图: ${(usage.thumbnails / 1024).toFixed(1)} KB`);
    console.log(`  总计: ${(usage.totalBytes / 1024).toFixed(1)} KB`);
  } catch {
    console.log('\n--- 本地磁盘占用 ---');
    console.log('  (存储目录尚未创建)');
  }

  // 3. 图片 URL 来源分布
  const urlPatterns = await sql`
    SELECT
      CASE
        WHEN source_url LIKE '%fixture://%' THEN 'fixture'
        WHEN source_url LIKE '%tmall.com%' THEN 'tmall'
        WHEN source_url LIKE '%taobao.com%' THEN 'taobao'
        WHEN source_url LIKE '%example.com%' THEN 'example'
        ELSE 'other'
      END as source,
      count(*) as cnt
    FROM products WHERE deleted_at IS NULL AND cover_url != ''
    GROUP BY source ORDER BY cnt DESC
  `;
  console.log('\n--- 图片来源分布 ---');
  for (const row of urlPatterns) {
    console.log(`  ${row.source}: ${row.cnt}`);
  }

  // 4. 迁移路径说明
  console.log('\n--- 存储迁移路径 ---');
  console.log('  当前: 本地磁盘 (var/uploads/images/)');
  console.log('  下一步: MinIO (S3 兼容)');
  console.log('  生产: 阿里云 OSS / 腾讯云 COS');
  console.log('  迁移方式: 只需切换 LocalImageStorage → S3ImageStorage');
  console.log('  接口不变，调用方无感知');

  // 5. App 可访问方式
  console.log('\n--- App 可访问方式 ---');
  console.log('  开发: 本地文件路径 + file:// 协议');
  console.log('  生产: HTTPS CDN URL (OSS/COS + 自定义域名)');
  console.log('  过渡: Nginx 反代 /api/images/* → 本地磁盘');

  await sql.end();
  console.log('\n=== 报告完成 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
