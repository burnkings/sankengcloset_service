// crawler/storage/persistence.ts — 数据持久化

import type postgres from 'postgres';
import type { NormalizedItem, CrawlJobStats } from '../core/types.js';

export class Persistence {
  constructor(private readonly sql: postgres.Sql) {}

  async upsertProduct(item: NormalizedItem, brandId: string): Promise<string> {
    // 先查已有产品
    const existing = await this.sql`
      SELECT id FROM products
      WHERE brand_id = ${brandId} AND canonical_name = ${item.canonicalName} AND deleted_at IS NULL
      LIMIT 1
    `;
    if (existing.length > 0) {
      // 更新已有产品
      await this.sql`
        UPDATE products SET
          current_price = ${item.currentPrice},
          original_price = ${item.originalPrice},
          sale_status = ${item.saleStatus},
          last_seen_at = now(),
          updated_at = now()
        WHERE id = ${existing[0]!.id}
      `;
      return String(existing[0]!.id);
    }
    // 插入新产品
    const id = 'prd_' + crypto.randomUUID().replace(/-/g, '');
    await this.sql`
      INSERT INTO products (
        id, canonical_name, display_name, brand_id, pit_type, category, sub_category,
        sale_status, current_price, original_price, deposit_price, balance_price,
        source_url, source_platform, external_id, cover_url, images,
        description, raw_description, review_status, confidence
      ) VALUES (
        ${id}, ${item.canonicalName}, ${item.displayName}, ${brandId}, ${item.pitType}, ${item.category}, ${item.subCategory},
        ${item.saleStatus}, ${item.currentPrice}, ${item.originalPrice}, ${item.depositPrice}, ${item.balancePrice},
        ${item.sourceUrl}, 'OFFICIAL', ${item.externalId}, ${item.coverUrl}, ${item.images},
        ${item.description}, ${item.rawDescription}, 'PENDING', ${item.confidence}
      )
    `;
    return id;
  }

  async recordPriceSnapshot(productId: string, price: number, originalPrice: number, source: string, sourceUrl: string): Promise<void> {
    // 幂等：同 product + 同 source + 同价格 不重复插入
    const existing = await this.sql`
      SELECT id FROM price_snapshots
      WHERE product_id = ${productId} AND source = ${source} AND price_cents = ${price}
      ORDER BY created_at DESC LIMIT 1
    `;
    if (existing.length > 0) return;

    await this.sql`
      INSERT INTO price_snapshots (id, product_id, price_cents, original_price_cents, source, source_url)
      VALUES (${`ps_${productId}_${Date.now()}`}, ${productId}, ${price}, ${originalPrice}, ${source}, ${sourceUrl})
    `;
  }

  async recordSourceRecord(entityType: string, entityId: string, sourceType: string, sourceUrl: string, parserVersion: string): Promise<void> {
    // 幂等：同 entity + 同 sourceUrl 不重复插入
    const existing = await this.sql`
      SELECT id FROM source_records
      WHERE entity_type = ${entityType} AND entity_id = ${entityId} AND source_url = ${sourceUrl}
      LIMIT 1
    `;
    if (existing.length > 0) return;

    await this.sql`
      INSERT INTO source_records (id, source_type, source_url, entity_type, entity_id, parser_version, review_status, confidence)
      VALUES (${`src_${entityId}_${Date.now()}`}, ${sourceType}, ${sourceUrl}, ${entityType}, ${entityId}, ${parserVersion}, 'PENDING', 80)
    `;
  }

  async saveJobStats(stats: CrawlJobStats): Promise<void> {
    const id = stats.jobId;
    const startedAt = stats.startedAt.toISOString();
    const finishedAt = stats.finishedAt?.toISOString() ?? null;

    await this.sql`
      INSERT INTO crawl_jobs (id, source_type, source_url, crawl_mode, status, started_at, finished_at,
        items_total, items_success, items_failed, items_skipped, error_message, parser_version, trigger)
      VALUES (${id}, ${stats.sourceType}, ${stats.sourceUrl}, ${stats.crawlMode}, ${stats.status.toUpperCase()},
        ${startedAt}, ${finishedAt},
        ${stats.fetchedCount}, ${stats.acceptedCount}, ${stats.errorCount}, ${stats.duplicateCount},
        ${stats.errors.join('; ')}, 'v1', 'manual')
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, finished_at = EXCLUDED.finished_at,
        items_total = EXCLUDED.items_total, items_success = EXCLUDED.items_success,
        items_failed = EXCLUDED.items_failed, items_skipped = EXCLUDED.items_skipped,
        error_message = EXCLUDED.error_message
    `;
  }

  async getExistingProducts(): Promise<{ id: string; brandId: string; brandName: string; canonicalName: string; sourceUrl: string }[]> {
    const rows = await this.sql`
      SELECT p.id, p.brand_id, b.name as brand_name, p.canonical_name, p.source_url
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.deleted_at IS NULL
    `;
    return rows.map(r => ({
      id: String(r.id),
      brandId: String(r.brand_id),
      brandName: String(r.brand_name ?? ''),
      canonicalName: String(r.canonical_name),
      sourceUrl: String(r.source_url),
    }));
  }

  async getBrandIdByName(name: string): Promise<string | null> {
    const rows = await this.sql`SELECT id FROM brands WHERE name = ${name} AND deleted_at IS NULL`;
    return rows[0] ? String(rows[0].id) : null;
  }

  // ────────────────────────────────────────────────
  // Release Batch 支持
  // ────────────────────────────────────────────────

  async upsertRelease(
    productId: string,
    release: {
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
      sourceUrl: string;
      lifecycleStatus: string;
      confidence: number;
    },
  ): Promise<string> {
    // 查找已有 release（product_id + release_no + release_type）
    if (release.releaseNo > 0) {
      const existing = await this.sql`
        SELECT id FROM product_releases
        WHERE product_id = ${productId} AND release_no = ${release.releaseNo}
          AND release_type = ${release.releaseType} AND deleted_at IS NULL
        LIMIT 1
      `;
      if (existing.length > 0) {
        // 更新已有 release
        await this.sql`
          UPDATE product_releases SET
            sale_status = ${release.saleStatus},
            deposit_price_cents = ${release.depositPrice},
            balance_price_cents = ${release.balancePrice},
            full_price_cents = ${release.fullPrice},
            is_sold_out = ${release.isSoldOut},
            lifecycle_status = ${release.lifecycleStatus},
            updated_at = now()
          WHERE id = ${existing[0]!.id}
        `;
        return String(existing[0]!.id);
      }
    }

    // 插入新 release
    const id = 'rel_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await this.sql`
      INSERT INTO product_releases (
        id, product_id, release_name, release_no, release_type, sale_status,
        deposit_price_cents, balance_price_cents, full_price_cents,
        start_at, end_at, balance_due_at, ship_at,
        is_rerelease, is_sold_out, source_url, visibility_status,
        lifecycle_status, confidence
      ) VALUES (
        ${id}, ${productId}, ${release.releaseName}, ${release.releaseNo}, ${release.releaseType},
        ${release.saleStatus}, ${release.depositPrice}, ${release.balancePrice}, ${release.fullPrice},
        ${release.startAt}, ${release.endAt}, ${release.balanceDueAt}, ${release.shipAt},
        ${release.isRerelease}, ${release.isSoldOut}, ${release.sourceUrl}, 'draft',
        ${release.lifecycleStatus}, ${release.confidence}
      )
    `;
    return id;
  }

  async recordPriceSnapshotWithRelease(
    productId: string,
    price: number,
    originalPrice: number,
    source: string,
    sourceUrl: string,
    releaseId: string | null = null,
  ): Promise<void> {
    // 幂等：同 product + 同 source + 同价格 + 同 release 不重复插入
    const existing = await this.sql`
      SELECT id FROM price_snapshots
      WHERE product_id = ${productId} AND source = ${source} AND price_cents = ${price}
        AND (${releaseId}::text IS NULL AND release_id IS NULL OR release_id = ${releaseId})
      ORDER BY created_at DESC LIMIT 1
    `;
    if (existing.length > 0) return;

    await this.sql`
      INSERT INTO price_snapshots (id, product_id, price_cents, original_price_cents, source, source_url, release_id)
      VALUES (${`ps_${productId}_${Date.now()}`}, ${productId}, ${price}, ${originalPrice}, ${source}, ${sourceUrl}, ${releaseId})
    `;
  }

  async getExistingReleases(): Promise<{ id: string; productId: string; releaseNo: number; releaseType: string; sourceUrl: string }[]> {
    const rows = await this.sql`
      SELECT id, product_id, release_no, release_type, source_url
      FROM product_releases WHERE deleted_at IS NULL
    `;
    return rows.map(r => ({
      id: String(r.id),
      productId: String(r.product_id),
      releaseNo: Number(r.release_no),
      releaseType: String(r.release_type),
      sourceUrl: String(r.source_url),
    }));
  }
}
