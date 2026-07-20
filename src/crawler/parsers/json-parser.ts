// crawler/parsers/json-parser.ts — JSON 数据解析器

import type { FetchResult, ParsedItem } from '../core/types.js';
import type { Parser } from '../core/types.js';

interface RawProduct {
  id?: string;
  name?: string;
  brand?: string;
  brandName?: string;
  category?: string;
  subCategory?: string;
  pitType?: string;
  price?: number;
  originalPrice?: number;
  depositPrice?: number;
  balancePrice?: number;
  currency?: string;
  saleStatus?: string;
  description?: string;
  rawDescription?: string;
  coverUrl?: string;
  images?: string[];
  sourceUrl?: string;
  shopUrl?: string;
  publishedAt?: string;
  tags?: string[];
}

export class JsonParser implements Parser {
  parseList(result: FetchResult): ParsedItem[] {
    try {
      const data = JSON.parse(result.body);
      const items: RawProduct[] = Array.isArray(data) ? data : data.items ?? data.products ?? [];
      return items.map(item => this.mapItem(item, result.url)).filter(Boolean) as ParsedItem[];
    } catch {
      return [];
    }
  }

  parseDetail(result: FetchResult): ParsedItem | null {
    try {
      const data = JSON.parse(result.body);
      const item: RawProduct = data.product ?? data;
      return this.mapItem(item, result.url);
    } catch {
      return null;
    }
  }

  private mapItem(raw: RawProduct, sourceUrl: string): ParsedItem | null {
    const name = raw.name ?? '';
    if (!name) return null;

    return {
      sourceUrl: raw.sourceUrl ?? sourceUrl,
      externalId: raw.id ?? '',
      canonicalName: name.trim(),
      displayName: name.trim(),
      brandName: (raw.brand ?? raw.brandName ?? '').trim(),
      category: (raw.category ?? '').trim(),
      subCategory: (raw.subCategory ?? '').trim(),
      pitType: this.mapPitType(raw.pitType ?? raw.category),
      currentPrice: Math.round((raw.price ?? 0) * 100),
      originalPrice: Math.round((raw.originalPrice ?? 0) * 100),
      depositPrice: Math.round((raw.depositPrice ?? 0) * 100),
      balancePrice: Math.round((raw.balancePrice ?? 0) * 100),
      currency: raw.currency ?? 'CNY',
      saleStatus: this.mapSaleStatus(raw.saleStatus),
      description: (raw.description ?? '').trim(),
      rawDescription: (raw.rawDescription ?? raw.description ?? '').trim(),
      coverUrl: raw.coverUrl ?? '',
      images: raw.images ?? [],
      sourcePublishedAt: raw.publishedAt ?? null,
      shopUrl: raw.shopUrl ?? '',
      tags: raw.tags ?? [],
    };
  }

  private mapPitType(value?: string): 'JK' | 'LOLITA' | 'HANFU' | 'OTHER' {
    const v = (value ?? '').toUpperCase();
    if (v === 'JK') return 'JK';
    if (v === 'LOLITA' || v === 'LO') return 'LOLITA';
    if (v === 'HANFU' || v === 'HF') return 'HANFU';
    return 'OTHER';
  }

  private mapSaleStatus(value?: string): string {
    const v = (value ?? '').toUpperCase();
    const valid = ['UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED'];
    return valid.includes(v) ? v : 'ON_SALE';
  }
}
