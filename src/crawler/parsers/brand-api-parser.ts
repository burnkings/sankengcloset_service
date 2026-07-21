// crawler/parsers/brand-api-parser.ts — 品牌 API 解析器
// 职责：原始数据 → 结构化 ParsedItem
// 要求：不能解析时返回错误，不能静默失败

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
}

interface BrandApiResponse {
  brand?: BrandData;
  products?: ProductData[];
}

export class BrandApiParser implements Parser {
  parseList(result: FetchResult): ParsedItem[] {
    if (result.statusCode !== 200) {
      throw new Error(`HTTP ${result.statusCode}: ${result.url}`);
    }

    let data: BrandApiResponse;
    try {
      data = JSON.parse(result.body);
    } catch (e) {
      throw new Error(`JSON 解析失败: ${(e as Error).message}`);
    }

    if (!data.brand) {
      throw new Error('响应缺少 brand 字段');
    }

    const products = data.products;
    if (!Array.isArray(products)) {
      throw new Error('响应缺少 products 数组');
    }

    if (products.length === 0) {
      return [];
    }

    const items: ParsedItem[] = [];
    for (const raw of products) {
      try {
        const item = this.mapProduct(raw, data.brand, result.url);
        if (item) items.push(item);
      } catch (e) {
        // 单个商品解析失败不中断整体，记录警告
        console.warn(`[BrandApiParser] 商品解析跳过: ${(e as Error).message}`);
      }
    }

    return items;
  }

  parseDetail(result: FetchResult): ParsedItem | null {
    if (result.statusCode !== 200) return null;

    try {
      const data: BrandApiResponse = JSON.parse(result.body);
      const product = data.products?.[0];
      if (!product || !data.brand) return null;
      return this.mapProduct(product, data.brand, result.url);
    } catch {
      return null;
    }
  }

  private mapProduct(raw: ProductData, brand: BrandData, sourceUrl: string): ParsedItem | null {
    const name = raw.name?.trim();
    if (!name) {
      throw new Error('商品名称为空');
    }

    return {
      sourceUrl,
      externalId: raw.id ?? '',
      canonicalName: name,
      displayName: name,
      brandName: (brand.name ?? '').trim(),
      category: (raw.category ?? '').trim(),
      subCategory: (raw.subcategory ?? '').trim(),
      pitType: this.mapPitType(brand.category),
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
      shopUrl: raw.shopUrl ?? brand.officialUrl ?? '',
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
