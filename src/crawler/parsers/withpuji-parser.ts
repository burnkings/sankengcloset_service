// crawler/parsers/withpuji-parser.ts — With PUJI Blogger RSS 解析器

import type { ParsedItem } from '../core/types.js';

/**
 * 解析 With PUJI Blogger RSS XML 为 ParsedItem
 * RSS 格式：<item><title>...</title><description>...</description><link>...</link><pubDate>...</pubDate></item>
 */
export class WithPujiParser {
  parseList(raw: { body: string }): ParsedItem[] {
    const items: ParsedItem[] = [];
    const xml = raw.body;

    // 提取所有 <item> 块
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1]!;
      const item = this.parseItem(itemXml);
      if (item) items.push(item);
    }

    return items;
  }

  private parseItem(itemXml: string): ParsedItem | null {
    const title = this.extractTag(itemXml, 'title');
    const description = this.extractTag(itemXml, 'description');
    const link = this.extractTag(itemXml, 'link');
    const pubDate = this.extractTag(itemXml, 'pubDate');

    if (!title) return null;

    // 提取图片
    const images = this.extractImages(description);
    const coverUrl = images[0] || '';

    // 从标题提取类型
    const pitType = this.detectPitType(title, description);

    // 从描述提取设计灵感
    const cleanDesc = this.cleanHtml(description);

    return {
      sourceUrl: link || `https://www.withpuji.com`,
      externalId: this.generateId(title),
      canonicalName: title.trim(),
      displayName: title.trim(),
      brandName: 'With Puji',
      category: this.detectCategory(title),
      subCategory: '',
      pitType,
      currentPrice: 0, // RSS 无价格
      originalPrice: 0,
      depositPrice: 0,
      balancePrice: 0,
      currency: 'CNY',
      saleStatus: 'ON_SALE',
      description: cleanDesc.slice(0, 500),
      rawDescription: description || '',
      coverUrl,
      images,
      sourcePublishedAt: pubDate || null,
      shopUrl: 'https://www.withpuji.com',
      tags: this.extractTags(title, description),
    };
  }

  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
    const match = xml.match(regex);
    return match?.[1]?.trim() || '';
  }

  private extractImages(html: string): string[] {
    const images: string[] = [];
    const imgRegex = /src="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp|avif)[^"]*)"/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const url = match[1]!;
      // 过滤缩略图，保留大图
      if (!url.includes('/s72-') && !url.includes('/w72-')) {
        images.push(url);
      }
    }
    return images.slice(0, 10);
  }

  private detectPitType(title: string, description: string): 'JK' | 'LOLITA' | 'HANFU' | 'OTHER' {
    const text = `${title} ${description}`.toLowerCase();
    if (/lolita|jsk|op\b|sk\b|bonnet|petti/.test(text)) return 'LOLITA';
    if (/jk|水手服|格裙|制服/.test(text)) return 'JK';
    if (/汉服|襦裙|马面|宋制|明制|唐制/.test(text)) return 'HANFU';
    return 'LOLITA'; // With PUJI 是 Lolita 品牌
  }

  private detectCategory(title: string): string {
    const text = title.toLowerCase();
    if (/\bjsk\b/.test(text)) return 'JSK';
    if (/\bop\b/.test(text)) return 'OP';
    if (/\bsk\b/.test(text)) return 'SK';
    if (/set|套装/.test(text)) return '套装';
    if (/skirt|裙/.test(text)) return '裙';
    return 'Lolita';
  }

  private cleanHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractTags(title: string, description: string): string[] {
    const tags: string[] = [];
    const text = `${title} ${description}`.toLowerCase();
    if (/gothic|哥特/.test(text)) tags.push('哥特');
    if (/sweet|甜美/.test(text)) tags.push('甜美');
    if (/classic|cla/.test(text)) tags.push('古典');
    if (/military|军事/.test(text)) tags.push('军事风');
    if (/lace|蕾丝/.test(text)) tags.push('蕾丝');
    if (/ruffle|荷叶边/.test(text)) tags.push('荷叶边');
    if (/bowknot|蝴蝶结/.test(text)) tags.push('蝴蝶结');
    if (/embroider|刺绣/.test(text)) tags.push('刺绣');
    return tags;
  }

  private generateId(title: string): string {
    return 'wp_' + title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 40);
  }
}
