// crawler/parsers/weibo-parser.ts — 微博帖子解析器

import type { FetchResult, ParsedItem } from '../core/types.js';
import type { Parser } from '../core/types.js';

interface WeiboPost {
  id?: string;
  title?: string;
  content?: string;
  publishTime?: string;
  images?: string[];
  productHint?: {
    name?: string;
    category?: string;
    estimatedPrice?: number;
    status?: string;
    deposit?: number;
    balance?: number;
  };
}

interface WeiboResponse {
  account?: { id?: string; name?: string; category?: string };
  posts?: WeiboPost[];
}

export class WeiboParser implements Parser {
  parseList(result: FetchResult): ParsedItem[] {
    try {
      const data: WeiboResponse = JSON.parse(result.body);
      const account = data.account;
      const posts = data.posts ?? [];
      return posts
        .filter(p => p.productHint)
        .map(p => this.mapPost(p, account, result.url))
        .filter(Boolean) as ParsedItem[];
    } catch {
      return [];
    }
  }

  parseDetail(result: FetchResult): ParsedItem | null {
    try {
      const data: WeiboResponse = JSON.parse(result.body);
      const post = data.posts?.find(p => p.productHint);
      if (!post) return null;
      return this.mapPost(post, data.account, result.url);
    } catch {
      return null;
    }
  }

  private mapPost(post: WeiboPost, account: WeiboResponse['account'], sourceUrl: string): ParsedItem | null {
    const hint = post.productHint;
    const name = hint?.name ?? '';
    if (!name) return null;

    return {
      sourceUrl,
      externalId: post.id ?? '',
      canonicalName: name.trim(),
      displayName: name.trim(),
      brandName: (account?.name ?? '').trim(),
      category: (hint?.category ?? '').trim(),
      subCategory: '',
      pitType: this.mapPitType(account?.category),
      currentPrice: Math.round((hint?.estimatedPrice ?? 0) * 100),
      originalPrice: 0,
      depositPrice: Math.round((hint?.deposit ?? 0) * 100),
      balancePrice: Math.round((hint?.balance ?? 0) * 100),
      currency: 'CNY',
      saleStatus: this.mapStatus(hint?.status),
      description: (post.content ?? '').trim(),
      rawDescription: (post.content ?? '').trim(),
      coverUrl: post.images?.[0] ?? '',
      images: post.images ?? [],
      sourcePublishedAt: post.publishTime ?? null,
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
