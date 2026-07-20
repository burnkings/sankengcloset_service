// crawler/parsers/official-brand-parser.ts — 品牌官网 JSON 解析器

import type { FetchResult, ParsedItem } from '../core/types.js';
import type { Parser } from '../core/types.js';

interface BrandData {
  id?: string;
  name?: string;
  nameEn?: string;
  category?: string;
  officialUrl?: string;
  description?: string;
}

interface ProductData {
  id?: string;
  name?: string;
  category?: string;
  subcategory?: string;
  price?: number;
  originalPrice?: number;
  status?: string;
  description?: string;
  coverImage?: string;
  images?: string[];
  shopUrl?: string;
  tags?: string[];
  publishedAt?: string;
  specs?: { color?: string; size?: string; stock?: number }[];
}

interface BrandApiResponse {
  brand?: BrandData;
  products?: ProductData[];
}

export class OfficialBrandParser implements Parser {
  parseList(result: FetchResult): ParsedItem[] {
    try {
      const data: BrandApiResponse = JSON.parse(result.body);
      const brand = data.brand;
      const products = data.products ?? [];

      return products
        .map(p => this.mapProduct(p, brand, result.url))
        .filter(Boolean) as ParsedItem[];
    } catch {
      return [];
    }
  }

  parseDetail(result: FetchResult): ParsedItem | null {
    try {
      const data: BrandApiResponse = JSON.parse(result.body);
      const product = data.products?.[0];
      const brand = data.brand;
      if (!product) return null;
      return this.mapProduct(product, brand, result.url);
    } catch {
      return null;
    }
  }

  private mapProduct(raw: ProductData, brand: BrandData | undefined, sourceUrl: string): ParsedItem | null {
    const name = raw.name ?? '';
    if (!name) return null;

    return {
      sourceUrl,
      externalId: raw.id ?? '',
      canonicalName: name.trim(),
      displayName: name.trim(),
      brandName: (brand?.name ?? '').trim(),
      category: (raw.category ?? '').trim(),
      subCategory: (raw.subcategory ?? '').trim(),
      pitType: this.mapPitType(brand?.category),
      currentPrice: Math.round((raw.price ?? 0) * 100),
      originalPrice: Math.round((raw.originalPrice ?? 0) * 100),
      depositPrice: 0,
      balancePrice: 0,
      currency: 'CNY',
      saleStatus: this.mapSaleStatus(raw.status),
      description: (raw.description ?? '').trim(),
      rawDescription: (raw.description ?? '').trim(),
      coverUrl: raw.coverImage ?? '',
      images: raw.images ?? [],
      sourcePublishedAt: raw.publishedAt ?? null,
      shopUrl: raw.shopUrl ?? brand?.officialUrl ?? '',
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
    const map: Record<string, string> = {
      'on_sale': 'ON_SALE',
      'pre_order': 'PRE_ORDER',
      'upcoming': 'UPCOMING',
      'sold_out': 'SOLD_OUT',
      'ended': 'ENDED',
    };
    return map[(value ?? '').toLowerCase()] ?? 'ON_SALE';
  }
}
