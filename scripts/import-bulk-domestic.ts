// scripts/import-bulk-domestic.ts — 批量导入国内品牌数据
// 读取 data/snapshots/domestic-brands/*.json 并导入

import postgres from 'postgres';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Persistence } from '../src/crawler/storage/persistence.js';
import { createJobId, createJobStats, finishJob } from '../src/crawler/core/job.js';

const DRY_RUN = process.argv.includes('--dry-run');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:***@localhost:5432/sankeng';
const DATA_DIR = resolve(import.meta.dirname, '../data/snapshots/domestic-brands');

const sql = postgres(DATABASE_URL, { max: 5 });
const persistence = new Persistence(sql);

interface ProductSnapshot {
  id: string;
  name: string;
  brand: string;
  brandId: string;
  pitType: string;
  category: string;
  price: number;
  deposit: number;
  balance: number;
  status: string;
  description: string;
  coverImage: string;
  images: string[];
  publishedAt: string;
  tags: string[];
}

interface ReleaseSnapshot {
  productId: string;
  releaseName: string;
  releaseNo: number;
  releaseType: string;
  saleStatus: string;
  depositPrice: number;
  balancePrice: number;
  fullPrice: number;
  startAt: string | null;
  endAt: string | null;
  balanceDueAt: string | null;
  shipAt: string | null;
  isRerelease: boolean;
  isSoldOut: boolean;
  lifecycleStatus: string;
  sourceUrl: string;
}

console.log(`=== Bulk Domestic Brand Import ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}\n`);

try {
  const files = await readdir(DATA_DIR);
  const productFiles = files.filter(f => f.endsWith('-products.json'));

  let totalProducts = 0;
  let totalReleases = 0;
  let totalSnapshots = 0;
  let totalSources = 0;

  for (const file of productFiles) {
    const brandKey = file.replace('-products.json', '');
    const releaseFile = `${brandKey}-releases.json`;

    console.log(`\n--- ${brandKey} ---`);

    // 读取产品
    const productData = JSON.parse(await readFile(resolve(DATA_DIR, file), 'utf-8'));
    const products: ProductSnapshot[] = productData.products || [];

    // 读取批次
    let releases: ReleaseSnapshot[] = [];
    try {
      const releaseData = JSON.parse(await readFile(resolve(DATA_DIR, releaseFile), 'utf-8'));
      releases = releaseData.releases || [];
    } catch {
      console.log(`  No release file found`);
    }

    console.log(`  Products: ${products.length}, Releases: ${releases.length}`);

    if (DRY_RUN) {
      totalProducts += products.length;
      totalReleases += releases.length;
      continue;
    }

    // 创建 job
    const jobId = createJobId();
    const stats = createJobStats({
      sourceType: 'OFFICIAL',
      sourceUrl: `snapshot://${brandKey}`,
      parserVersion: 'v1',
      trigger: 'manual',
      maxRetries: 0,
      retryDelayMs: 0,
      requestTimeoutMs: 10000,
      rateLimitMs: 0,
      userAgent: 'SankengBot/1.0',
      dryRun: false,
      crawlMode: 'full',
    }, jobId);

    // 导入产品
    let brandProducts = 0;
    for (const p of products) {
      const id = p.id;
      const existing = await sql`SELECT id FROM products WHERE id = ${id}`;
      if (existing.length > 0) continue;

      await sql`
        INSERT INTO products (
          id, canonical_name, display_name, brand_id, pit_type, category,
          sale_status, current_price, original_price, deposit_price, balance_price,
          source_url, source_platform, cover_url, images, description,
          review_status, visibility_status, confidence
        ) VALUES (
          ${id}, ${p.name}, ${p.name}, ${p.brandId}, ${p.pitType}, ${p.category},
          ${p.status.toUpperCase()}, ${p.price * 100}, ${p.price * 100}, ${p.deposit * 100}, ${p.balance * 100},
          ${p.coverImage}, 'OFFICIAL', ${p.coverImage}, ${p.images}, ${p.description},
          'PENDING', 'draft', 85
        )
        ON CONFLICT (id) DO NOTHING
      `;
      brandProducts++;
    }
    totalProducts += brandProducts;

    // 导入批次
    let brandReleases = 0;
    for (const r of releases) {
      const id = `rel_${r.productId}_${r.releaseNo}_${r.releaseType}`;
      const existing = await sql`SELECT id FROM product_releases WHERE id = ${id}`;
      if (existing.length > 0) continue;

      await sql`
        INSERT INTO product_releases (
          id, product_id, release_name, release_no, release_type, sale_status,
          deposit_price_cents, balance_price_cents, full_price_cents,
          start_at, end_at, balance_due_at, ship_at,
          is_rerelease, is_sold_out, source_url, visibility_status,
          lifecycle_status, confidence
        ) VALUES (
          ${id}, ${r.productId}, ${r.releaseName}, ${r.releaseNo}, ${r.releaseType}, ${r.saleStatus},
          ${r.depositPrice}, ${r.balancePrice}, ${r.fullPrice},
          ${r.startAt}, ${r.endAt}, ${r.balanceDueAt}, ${r.shipAt},
          ${r.isRerelease}, ${r.isSoldOut}, ${r.sourceUrl}, 'draft',
          ${r.lifecycleStatus}, 85
        )
        ON CONFLICT (id) DO NOTHING
      `;
      brandReleases++;

      // 价格快照
      const psId = `ps_${r.productId}_${r.releaseNo}_${Date.now()}`;
      await sql`
        INSERT INTO price_snapshots (id, product_id, price_cents, original_price_cents, source, source_url, release_id)
        VALUES (${psId}, ${r.productId}, ${r.fullPrice}, ${r.fullPrice}, 'snapshot', ${r.sourceUrl}, ${id})
        ON CONFLICT (id) DO NOTHING
      `;
      totalSnapshots++;

      // 来源记录
      const srcId = `src_${r.productId}_${r.releaseNo}`;
      await sql`
        INSERT INTO source_records (id, source_type, source_url, entity_type, entity_id, parser_version, review_status, confidence)
        VALUES (${srcId}, 'OFFICIAL', ${r.sourceUrl}, 'product', ${r.productId}, 'v1', 'PENDING', 85)
        ON CONFLICT (id) DO NOTHING
      `;
      totalSources++;
    }
    totalReleases += brandReleases;

    // 保存 job
    const finished = finishJob({ ...stats, fetchedCount: 1, parsedCount: products.length, acceptedCount: brandProducts }, 'success');
    await persistence.saveJobStats(finished);

    console.log(`  Imported: ${brandProducts} products, ${brandReleases} releases`);
  }

  console.log(`\n=== 汇总 ===`);
  console.log(`Products: ${totalProducts}`);
  console.log(`Releases: ${totalReleases}`);
  console.log(`Price Snapshots: ${totalSnapshots}`);
  console.log(`Source Records: ${totalSources}`);

} catch (e) {
  console.error(`\n❌ 导入失败: ${(e as Error).message}`);
  console.error((e as Error).stack);
} finally {
  await sql.end();
}
