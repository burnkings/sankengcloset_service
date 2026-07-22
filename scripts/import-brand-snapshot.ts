// scripts/import-brand-snapshot.ts — 本地快照导入脚本（多格式）
// 支持：--file --format rss|html|json|text --brand-id --source-url --mode --dry-run

import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { WithPujiParser } from '../src/crawler/parsers/withpuji-parser.js';
import { parseAnnouncement, parseMetadata, type SnapshotMetadata } from '../src/crawler/parsers/announcement-parser.js';
import { FieldNormalizer } from '../src/crawler/normalizers/field-normalizer.js';
import { FieldValidator } from '../src/crawler/pipelines/validator.js';
import { InMemoryDeduplicator } from '../src/crawler/pipelines/deduplicator.js';
import { Persistence } from '../src/crawler/storage/persistence.js';
import { createJobId, createJobStats, finishJob } from '../src/crawler/core/job.js';
import type { CrawlJobConfig, ParsedItem } from '../src/crawler/core/types.js';

// ────────────────────────────────────────────────
// 参数解析
// ────────────────────────────────────────────────

function getArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1]! : fallback;
}

const DRY_RUN = process.argv.includes('--dry-run');
const FILE_PATH = getArg('file', 'data/snapshots/announcements/withpuji-release-schedule.md');
const FORMAT = getArg('format', 'text') as 'rss' | 'html' | 'json' | 'text';
const BRAND_ID = getArg('brand-id', 'br_002');
const SOURCE_TYPE = getArg('source-type', 'OFFICIAL');
const SOURCE_URL = getArg('source-url', '');
const CRAWL_MODE = getArg('mode', 'full');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sankeng:***@localhost:5432/sankeng';

// ────────────────────────────────────────────────
// 格式解析器
// ────────────────────────────────────────────────

function parseByFormat(content: string, format: string, metadata: SnapshotMetadata): ParsedItem[] {
  switch (format) {
    case 'rss': {
      const parser = new WithPujiParser();
      return parser.parseList({ body: content });
    }
    case 'text':
    case 'html': {
      // text 和 html 都用 Announcement Parser
      const result = parseAnnouncement(content, metadata);
      let annCounter = 0;
      return result.products.map(p => {
        annCounter++;
        return {
        sourceUrl: metadata.sourceUrl || `snapshot://${FILE_PATH}`,
        externalId: `ann_${Date.now()}_${annCounter}`,
        canonicalName: p.title,
        displayName: p.title,
        brandName: p.brand || metadata.brand || '未知品牌',
        category: p.category,
        subCategory: '',
        pitType: p.pitType,
        currentPrice: p.fullPriceCents,
        originalPrice: p.fullPriceCents,
        depositPrice: p.depositPriceCents,
        balancePrice: p.balancePriceCents,
        currency: 'CNY',
        saleStatus: p.saleStatus,
        description: p.rawText.slice(0, 500),
        rawDescription: p.rawText,
        coverUrl: '',
        images: [],
        sourcePublishedAt: metadata.publishedAt || null,
        shopUrl: '',
        tags: [],
      };
      });
    }
    case 'json': {
      try {
        const data = JSON.parse(content);
        const items = Array.isArray(data) ? data : data.products || data.items || [];
        return items.map((item: Record<string, unknown>) => ({
          sourceUrl: String(item.source_url || item.sourceUrl || metadata.sourceUrl || ''),
          externalId: String(item.id || item.external_id || `json_${Date.now()}`),
          canonicalName: String(item.name || item.title || item.canonical_name || '未知'),
          displayName: String(item.display_name || item.name || item.title || '未知'),
          brandName: String(item.brand || item.brand_name || metadata.brand || '未知'),
          category: String(item.category || '其他'),
          subCategory: String(item.sub_category || ''),
          pitType: (String(item.pit_type || 'OTHER').toUpperCase() as ParsedItem['pitType']),
          currentPrice: Number(item.price || item.current_price || 0),
          originalPrice: Number(item.original_price || item.price || 0),
          depositPrice: Number(item.deposit_price || 0),
          balancePrice: Number(item.balance_price || 0),
          currency: 'CNY',
          saleStatus: String(item.sale_status || item.status || 'ON_SALE'),
          description: String(item.description || ''),
          rawDescription: String(item.raw_description || item.description || ''),
          coverUrl: String(item.cover_url || item.cover || ''),
          images: Array.isArray(item.images) ? item.images.map(String) : [],
          sourcePublishedAt: String(item.published_at || item.date || null),
          shopUrl: String(item.shop_url || ''),
          tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        }));
      } catch {
        return [];
      }
    }
    default:
      return [];
  }
}

// ────────────────────────────────────────────────
// 初始化
// ────────────────────────────────────────────────

const sql = postgres(DATABASE_URL, { max: 2 });
const normalizer = new FieldNormalizer();
const validator = new FieldValidator();
const deduplicator = new InMemoryDeduplicator();
const persistence = new Persistence(sql);

console.log(`=== Local Snapshot Import (Multi-Format) ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'} | CrawlMode: ${CRAWL_MODE}`);
console.log(`Format: ${FORMAT} | File: ${FILE_PATH}`);
console.log(`Brand: ${BRAND_ID} | Source: ${SOURCE_URL || FILE_PATH}\n`);

try {
  // 1. 读取快照文件
  const content = await readFile(FILE_PATH, 'utf-8');
  console.log(`Snapshot size: ${content.length} bytes`);

  // 2. 解析元数据（text/html 格式）
  let metadata: SnapshotMetadata = { brand: '', sourceUrl: SOURCE_URL, publishedAt: '', pitType: '' };
  let body = content;
  if (FORMAT === 'text' || FORMAT === 'html') {
    const parsed = parseMetadata(content);
    metadata = { ...metadata, ...parsed.metadata };
    body = parsed.body;
    if (metadata.brand) console.log(`Metadata: brand=${metadata.brand}, source=${metadata.sourceUrl}`);
  }

  // 3. 解析
  const jobId = createJobId();
  let stats = createJobStats({
    sourceType: SOURCE_TYPE,
    sourceUrl: SOURCE_URL || FILE_PATH,
    parserVersion: 'v1',
    trigger: 'manual',
    maxRetries: 0,
    retryDelayMs: 0,
    requestTimeoutMs: 10000,
    rateLimitMs: 0,
    userAgent: 'SankengBot/1.0',
    dryRun: DRY_RUN,
    crawlMode: CRAWL_MODE,
  }, jobId);

  const parsed = parseByFormat(body, FORMAT, metadata);
  stats = { ...stats, fetchedCount: 1, parsedCount: parsed.length };
  console.log(`Parsed: ${parsed.length} items\n`);

  // 4. 加载已有产品去重
  const existing = await persistence.getExistingProducts();
  deduplicator.load(existing);

  // 5. 处理每个 item
  let newProducts = 0;
  let newReleases = 0;
  let duplicates = 0;
  let rejected = 0;

  for (const item of parsed) {
    const normalized = normalizer.normalize(item);
    const validation = validator.validate(normalized);
    const dedup = await deduplicator.check(normalized);

    if (!validation.valid) {
      rejected++;
      stats = { ...stats, rejectedCount: stats.rejectedCount + 1 };
      console.log(`❌ [REJECT] ${item.canonicalName}`);
      continue;
    }

    if (dedup.action === 'skip_dedup') {
      duplicates++;
      stats = { ...stats, duplicateCount: stats.duplicateCount + 1 };
      console.log(`⏭️  [DUP] ${item.canonicalName}`);
      continue;
    }

    if (DRY_RUN) {
      stats = { ...stats, acceptedCount: stats.acceptedCount + 1 };
      console.log(`✅ [DRY] ${item.canonicalName} — ${item.pitType} ¥${item.currentPrice / 100}`);
      continue;
    }

    // 写入数据库
    const brandId = await persistence.getBrandIdByName(normalized.normalizedBrandName) || BRAND_ID;
    const productId = await persistence.upsertProduct(normalized, brandId);
    newProducts++;

    // 从 item 中提取 release 信息
    const releaseInfo = extractReleaseFromItem(item);
    const releaseId = await persistence.upsertRelease(productId, {
      releaseName: releaseInfo.releaseName,
      releaseNo: releaseInfo.releaseNo,
      releaseType: releaseInfo.releaseType,
      saleStatus: normalized.saleStatus,
      depositPrice: normalized.depositPrice,
      balancePrice: normalized.balancePrice,
      fullPrice: normalized.currentPrice,
      startAt: normalized.sourcePublishedAt,
      endAt: null,
      balanceDueAt: null,
      shipAt: null,
      isRerelease: releaseInfo.releaseType === 'rerelease',
      isSoldOut: normalized.saleStatus === 'SOLD_OUT',
      sourceUrl: normalized.sourceUrl,
      lifecycleStatus: normalized.saleStatus === 'SOLD_OUT' ? 'sold_out' : 'active',
      confidence: normalized.confidence,
    });
    newReleases++;

    // 写入价格快照
    await persistence.recordPriceSnapshotWithRelease(
      productId, normalized.currentPrice, normalized.originalPrice,
      'snapshot', normalized.sourceUrl, releaseId,
    );

    // 写入来源记录
    await persistence.recordSourceRecord('product', productId, SOURCE_TYPE, normalized.sourceUrl, 'v1');

    stats = { ...stats, acceptedCount: stats.acceptedCount + 1 };
    console.log(`✅ [NEW] ${item.canonicalName} — ${item.pitType} ¥${item.currentPrice / 100} (release: ${releaseInfo.releaseName})`);
  }

  // 6. 保存 job
  stats = finishJob(stats, 'success');
  if (!DRY_RUN) {
    await persistence.saveJobStats(stats);
  }

  // 7. 输出汇总
  console.log(`\n--- 汇总 ---`);
  console.log(`新增 product: ${newProducts}`);
  console.log(`新增 release: ${newReleases}`);
  console.log(`重复: ${duplicates}`);
  console.log(`拒绝: ${rejected}`);
  console.log(`Job ID: ${jobId}`);

} catch (e) {
  console.error(`\n❌ 导入失败: ${(e as Error).message}`);
  console.error((e as Error).stack);
} finally {
  await sql.end();
}

// ────────────────────────────────────────────────
// 从 ParsedItem 提取 release 信息
// ────────────────────────────────────────────────

function extractReleaseFromItem(item: ParsedItem) {
  const text = `${item.canonicalName} ${item.description} ${item.rawDescription}`;

  // 批次号
  let releaseNo = 0;
  const noPatterns = [
    { re: /一期|第1期|第一批/, no: 1 },
    { re: /二期|第2期|第二批/, no: 2 },
    { re: /三期|第3期|第三批/, no: 3 },
  ];
  for (const { re, no } of noPatterns) {
    if (re.test(text)) { releaseNo = no; break; }
  }

  // 发售类型
  let releaseType: 'first_release' | 'rerelease' | 'reservation' | 'spot' | 'lottery' | 'unknown' = 'unknown';
  if (/再贩|返场|复刻/.test(text)) releaseType = 'rerelease';
  else if (/预约|预定|定金|预售/.test(text)) releaseType = 'reservation';
  else if (/现货|现发|即发/.test(text)) releaseType = 'spot';
  else if (/首发|首贩/.test(text)) releaseType = 'first_release';
  else if (releaseNo > 0) releaseType = 'reservation'; // 有批次号默认为预约

  const releaseName = releaseNo > 0 ? `${releaseNo}期` : ({
    rerelease: '再贩', reservation: '预约', spot: '现货', lottery: '抽选', first_release: '首发', unknown: '未知',
  } as Record<string, string>)[releaseType] || '未知';

  return { releaseNo, releaseType, releaseName };
}
