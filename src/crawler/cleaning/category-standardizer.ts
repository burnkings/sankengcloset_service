// crawler/cleaning/category-standardizer.ts — 分类标准化

/** 统一坑向 */
const PIT_MAP: Record<string, string> = {
  'jk': 'JK', 'jk制服': 'JK', 'jk裙': 'JK',
  'lolita': 'LOLITA', 'lo裙': 'LOLITA', 'lo': 'LOLITA', '洛丽塔': 'LOLITA',
  '汉服': 'HANFU', 'hf': 'HANFU',
  '配饰': 'OTHER', '鞋': 'OTHER', '包': 'OTHER', '鞋包': 'OTHER',
};

/** 统一商品类型 */
const TYPE_MAP: Record<string, string> = {
  '格裙': '格裙', '百褶裙': '格裙', 'jk格裙': '格裙',
  '水手服': '水手服', '水手': '水手服',
  '衬衫': '衬衫', '关西襟': '衬衫', '开襟': '衬衫',
  'jsk': 'JSK', 'jsk裙': 'JSK',
  'op': 'OP', 'op裙': 'OP', '连衣裙': 'OP',
  'sk': 'SK', '半身裙': 'SK', '裙子': 'SK',
  '背心裙': '背心裙',
  '马面裙': '马面裙', '马面': '马面裙',
  '襦裙': '襦裙', '齐胸襦裙': '襦裙', '齐腰襦裙': '襦裙',
  '袄裙': '袄裙', '明制袄裙': '袄裙',
  '褙子': '褙子', '宋制褙子': '褙子',
  '比甲': '比甲',
  '大袖衫': '大袖衫',
  '对襟': '对襟', '对襟衫': '对襟',
  '圆领袍': '圆领袍',
  '竖领': '竖领',
  '百迭裙': '百迭裙',
  '旋裙': '旋裙', '宋制旋裙': '旋裙',
  '套装': '套装', '制服套装': '套装',
  '配饰': '配饰', '头饰': '配饰', '发饰': '配饰', 'kc': 'KC',
  '鞋': '鞋', '皮鞋': '鞋',
  '包': '包', '双肩包': '包', '手提包': '包',
};

/** 统一销售状态 */
const STATUS_MAP: Record<string, string> = {
  'on_sale': 'ON_SALE', '在售': 'ON_SALE', '热卖': 'ON_SALE',
  'pre_order': 'PRE_ORDER', '预售': 'PRE_ORDER', '预定': 'PRE_ORDER',
  'upcoming': 'UPCOMING', '即将发售': 'UPCOMING', '未发售': 'UPCOMING',
  'sold_out': 'SOLD_OUT', '售罄': 'SOLD_OUT', '断货': 'SOLD_OUT',
  'ended': 'ENDED', '下架': 'ENDED', '已结束': 'ENDED',
};

export class CategoryStandardizer {
  /** 标准化坑向 */
  standardizePitType(raw: string): string {
    const lower = raw.trim().toLowerCase();
    return PIT_MAP[lower] ?? PIT_MAP[raw.trim()] ?? 'OTHER';
  }

  /** 标准化商品类型 */
  standardizeProductType(raw: string): string {
    const lower = raw.trim().toLowerCase();
    return TYPE_MAP[lower] ?? TYPE_MAP[raw.trim()] ?? raw.trim();
  }

  /** 标准化销售状态 */
  standardizeSaleStatus(raw: string): string {
    const lower = raw.trim().toLowerCase();
    return STATUS_MAP[lower] ?? STATUS_MAP[raw.trim()] ?? 'ON_SALE';
  }

  /** 判断是否需要人工审核 */
  needsReview(pitType: string, category: string): boolean {
    return pitType === 'OTHER' || !TYPE_MAP[category.toLowerCase()];
  }
}
