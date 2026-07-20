// crawler/parsers/wechat-mp-parser.ts — 微信公众号文章解析器

import type { FetchResult, ParsedItem } from '../core/types.js';
import type { Parser } from '../core/types.js';

interface WechatProduct {
  name?: string;
  category?: string;
  price?: number;
  originalPrice?: number;
  status?: string;
}

interface WechatArticle {
  id?: string;
  title?: string;
  summary?: string;
  publishTime?: string;
  url?: string;
  images?: string[];
  products?: WechatProduct[];
}

interface WechatResponse {
  account?: { id?: string; name?: string; category?: string };
  articles?: WechatArticle[];
}

export class WechatMpParser implements Parser {
  parseList(result: FetchResult): ParsedItem[] {
    try {
      const data: WechatResponse = JSON.parse(result.body);
      const account = data.account;
      const articles = data.articles ?? [];
      const items: ParsedItem[] = [];

      for (const article of articles) {
        const products = article.products ?? [];
        for (const product of products) {
          const mapped = this.mapProduct(product, article, account, result.url);
          if (mapped) items.push(mapped);
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  parseDetail(result: FetchResult): ParsedItem | null {
    try {
      const data: WechatResponse = JSON.parse(result.body);
      const article = data.articles?.[0];
      const product = article?.products?.[0];
      if (!product) return null;
      return this.mapProduct(product, article!, data.account, result.url);
    } catch {
      return null;
    }
  }

  private mapProduct(
    product: WechatProduct,
    article: WechatArticle,
    account: WechatResponse['account'],
    sourceUrl: string,
  ): ParsedItem | null {
    const name = product.name ?? '';
    if (!name) return null;

    return {
      sourceUrl: article.url ?? sourceUrl,
      externalId: `${article.id}_${name}`,
      canonicalName: name.trim(),
      displayName: name.trim(),
      brandName: (account?.name ?? '').trim(),
      category: (product.category ?? '').trim(),
      subCategory: '',
      pitType: this.mapPitType(account?.category),
      currentPrice: Math.round((product.price ?? 0) * 100),
      originalPrice: Math.round((product.originalPrice ?? 0) * 100),
      depositPrice: 0,
      balancePrice: 0,
      currency: 'CNY',
      saleStatus: this.mapStatus(product.status),
      description: (article.summary ?? '').trim(),
      rawDescription: (article.summary ?? '').trim(),
      coverUrl: article.images?.[0] ?? '',
      images: article.images ?? [],
      sourcePublishedAt: article.publishTime ?? null,
      shopUrl: '',
      tags: [],
    };
  }

  private mapPitType(v?: string): 'JK' | 'LOLITA' | 'HANFU' | 'OTHER' {
    const t = (v ?? '').toUpperCase();
    if (t === 'JK') return 'JK';
    if (t === 'LOLITA' || t === 'LO') return 'LOLITA';
    if (t === 'HANFU' || t === 'HF') return 'HANFU';
    return 'OTHER';
  }

  private mapStatus(v?: string): string {
    const map: Record<string, string> = {
      'on_sale': 'ON_SALE', 'pre_order': 'PRE_ORDER', 'upcoming': 'UPCOMING',
      'sold_out': 'SOLD_OUT', 'ended': 'ENDED',
    };
    return map[(v ?? '').toLowerCase()] ?? 'ON_SALE';
  }
}
