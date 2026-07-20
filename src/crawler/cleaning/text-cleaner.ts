// crawler/cleaning/text-cleaner.ts — 文本清洗

export class TextCleaner {
  /** 去 HTML 标签 */
  stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  /** 去无意义空白 */
  normalizeWhitespace(text: string): string {
    return text
      .replace(/\t/g, ' ')
      .replace(/ {3,}/g, '  ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/gm, '')
      .trim();
  }

  /** 去营销模板文本 */
  stripMarketing(text: string): string {
    const patterns = [
      /(?:限时|特价|秒杀|抢购|清仓|甩卖|包邮|顺丰包邮|全国包邮)[!！]?\s*/g,
      /(?:前\d+名|前\d+位|限量\d+件)\s*(?:.*?赠.*?(?:\n|$))?/g,
      /(?:领券减\d+|满\d+减\d+|用券立减\d+)\s*/g,
      /(?:点击|复制|打开).*?(?:购买|下单|抢购)\s*/g,
      /(?:淘宝|天猫|京东).*?(?:搜索|搜索码|口令)\s*/g,
      /(?:618|双11|双12|年货节|38节).*?(?:活动|大促|特惠)\s*/g,
    ];
    let result = text;
    for (const p of patterns) {
      result = result.replace(p, '');
    }
    return result.trim();
  }

  /** 清洗标题（保留有意义内容） */
  cleanTitle(raw: string): string {
    let title = raw;
    title = this.stripHtml(title);
    title = this.normalizeWhitespace(title);
    title = this.stripMarketing(title);
    // 全角→半角数字和字母
    title = title.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    title = title.replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    return title.trim();
  }

  /** 清洗描述 */
  cleanDescription(raw: string): string {
    let desc = raw;
    desc = this.stripHtml(desc);
    desc = this.normalizeWhitespace(desc);
    desc = this.stripMarketing(desc);
    return desc.trim();
  }

  /** 截断到最大长度 */
  truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + '...';
  }
}
