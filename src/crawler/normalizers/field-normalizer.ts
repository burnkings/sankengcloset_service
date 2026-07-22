// crawler/normalizers/field-normalizer.ts — 字段标准化

import type { ParsedItem, NormalizedItem } from '../core/types.js';
import type { Normalizer } from '../core/types.js';

/** 品牌名标准化映射 */
const BRAND_ALIASES: Record<string, string> = {
  '兔缝缝': '兔缝缝',
  'tufengfeng': '兔缝缝',
  '星辰猫': '星辰猫',
  'starcat': '星辰猫',
  '星晨猫': '星辰猫',  // 常见错别字
  '花筵': '花筵',
  'huayan': '花筵',
  '花延': '花筵',       // 常见错别字
  '仲夏物语': '仲夏物语',
  '摇篮曲': '摇篮曲',
  'with puji': 'With Puji',
  'With Puji': 'With Puji',
  '婴梵塔': '婴梵塔',
  '表面咒语': '表面咒语',
  '夏日和风铃': '夏日和风铃',
  '十三余': '十三余',
  '明华堂': '明华堂',
  '汉尚华莲': '汉尚华莲',
  '重回汉唐': '重回汉唐',
  '兰若庭': '兰若庭',
  '织造司': '织造司',
  '清欢纪': '清欢纪',
  '钟灵记': '钟灵记',
};

/** 类目标准化映射 */
const CATEGORY_MAP: Record<string, string> = {
  '格裙': '格裙',
  '百褶裙': '格裙',
  '水手服': '水手服',
  '衬衫': '衬衫',
  '关西襟': '衬衫',
  'jsk': 'JSK',
  'op': 'OP',
  'sk': 'SK',
  '半身裙': 'SK',
  '连衣裙': 'OP',
  '背心裙': '背心裙',
  '马面裙': '马面裙',
  '襦裙': '襦裙',
  '袄裙': '袄裙',
  '褙子': '褙子',
  '比甲': '比甲',
  '大袖衫': '大袖衫',
  '对襟': '对襟',
  '圆领袍': '圆领袍',
  '竖领': '竖领',
  '百迭裙': '百迭裙',
  '套装': '套装',
  '配饰': '配饰',
  '鞋': '鞋',
  'kc': 'KC',
  '发饰': '配饰',
};

export class FieldNormalizer implements Normalizer {
  normalize(item: ParsedItem): NormalizedItem {
    const brandName = this.normalizeBrandName(item.brandName);
    const category = this.normalizeCategory(item.category);
    const canonicalName = this.normalizeProductName(item.canonicalName);

    return {
      ...item,
      canonicalName,
      category,
      normalizedBrandName: brandName,
      confidence: this.calculateConfidence(item, brandName, category),
      release: null,
    };
  }

  private normalizeBrandName(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    return BRAND_ALIASES[lower] ?? BRAND_ALIASES[trimmed] ?? trimmed;
  }

  private normalizeCategory(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const lower = trimmed.toLowerCase();
    return CATEGORY_MAP[lower] ?? CATEGORY_MAP[trimmed] ?? trimmed;
  }

  private normalizeProductName(raw: string): string {
    return raw.trim().replace(/\s+/g, ' ');
  }

  private calculateConfidence(item: ParsedItem, brand: string, category: string): number {
    let score = 100;
    if (!brand) score -= 20;
    if (!category) score -= 10;
    if (item.currentPrice <= 0) score -= 15;
    if (!item.description) score -= 5;
    if (!item.coverUrl) score -= 10;
    if (!item.sourceUrl) score -= 10;
    return Math.max(0, score);
  }
}
