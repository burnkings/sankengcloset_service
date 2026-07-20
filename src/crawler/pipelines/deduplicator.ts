// crawler/pipelines/deduplicator.ts — 去重

import type { NormalizedItem, DedupResult } from '../core/types.js';
import type { Deduplicator } from '../core/types.js';

interface KnownProduct {
  id: string;
  brandId: string;
  brandName?: string;
  canonicalName: string;
  sourceUrl: string;
}

export class InMemoryDeduplicator implements Deduplicator {
  private known = new Map<string, KnownProduct>();

  load(products: KnownProduct[]): void {
    for (const p of products) {
      // Store by brandId + canonicalName
      const key1 = `${p.brandId}::${p.canonicalName.toLowerCase()}`;
      this.known.set(key1, p);
      // Also store by brandName + canonicalName (for normalized lookup)
      if (p.brandName) {
        const key2 = `${p.brandName.toLowerCase()}::${p.canonicalName.toLowerCase()}`;
        this.known.set(key2, p);
      }
      if (p.sourceUrl) {
        this.known.set(`url::${p.sourceUrl}`, p);
      }
    }
  }

  async check(item: NormalizedItem): Promise<DedupResult> {
    // P0: brand + canonicalName 精确匹配
    const nameKey = `${item.normalizedBrandName}::${item.canonicalName.toLowerCase()}`;
    if (this.known.has(nameKey)) {
      const existing = this.known.get(nameKey)!;
      return { action: 'update', existingId: existing.id, reason: `品牌+名称重复: ${existing.id}` };
    }

    // P1: sourceUrl 匹配
    if (item.sourceUrl) {
      const urlKey = `url::${item.sourceUrl}`;
      if (this.known.has(urlKey)) {
        const existing = this.known.get(urlKey)!;
        return { action: 'update', existingId: existing.id, reason: `URL 重复: ${existing.id}` };
      }
    }

    return { action: 'insert', existingId: null, reason: '新商品' };
  }
}
