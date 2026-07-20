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
        WHERE id = ${existing[0].id}
      `;
      return String(existing[0].id);
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
    await this.sql`
      INSERT INTO price_snapshots (id, product_id, price_cents, original_price_cents, source, source_url)
      VALUES (${`ps_${productId}_${Date.now()}`}, ${productId}, ${price}, ${originalPrice}, ${source}, ${sourceUrl})
    `;
  }

  async recordSourceRecord(entityType: string, entityId: string, sourceType: string, sourceUrl: string, parserVersion: string): Promise<void> {
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
      INSERT INTO crawl_jobs (id, source_type, source_url, status, started_at, finished_at,
        items_total, items_success, items_failed, items_skipped, error_message, parser_version, trigger)
      VALUES (${id}, ${stats.sourceType}, ${stats.sourceUrl}, ${stats.status.toUpperCase()},
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

  async getExistingProducts(): Promise<{ id: string; brandId: string; canonicalName: string; sourceUrl: string }[]> {
    const rows = await this.sql`SELECT id, brand_id, canonical_name, source_url FROM products WHERE deleted_at IS NULL`;
    return rows.map(r => ({ id: String(r.id), brandId: String(r.brand_id), canonicalName: String(r.canonical_name), sourceUrl: String(r.source_url) }));
  }

  async getBrandIdByName(name: string): Promise<string | null> {
    const rows = await this.sql`SELECT id FROM brands WHERE name = ${name} AND deleted_at IS NULL`;
    return rows[0] ? String(rows[0].id) : null;
  }
}
