// intelligence/feed-ranker.ts — Feed 排序理由引擎
// 基于规则生成 feed_reason，不使用 AI

import type { ContentFeedItem } from '../types.js';

/**
 * 排序理由优先级（从高到低）：
 * 1. 即将截止预约
 * 2. 热门品牌新品
 * 3. 历史高热再贩
 * 4. 最近降价
 * 5. 首发预售
 * 6. 品牌上新
 * 7. 现货在售
 * 8. 默认
 */

const RELEASE_TYPE_NAMES: Record<string, string> = {
  first_release: '首发',
  rerelease: '再贩',
  reservation: '预约',
  spot: '现货',
  lottery: '抽选',
  unknown: '未知',
};

/**
 * 生成价格摘要 e.g. "¥368.00"
 */
export function formatPriceSummary(priceCents: number): string {
  if (priceCents <= 0) return '价格待定';
  return `¥${(priceCents / 100).toFixed(2)}`;
}

/**
 * 获取 release_type 的中文名
 */
export function getReleaseTypeName(releaseType: string): string {
  return RELEASE_TYPE_NAMES[releaseType] ?? '未知';
}

/**
 * 合并所有标签：season + scene + element + recommended
 */
export function mergeTags(
  seasonTags: string[],
  sceneTags: string[],
  elementTags: string[],
  recommendedTags: string[],
): string[] {
  const all = [...seasonTags, ...sceneTags, ...elementTags, ...recommendedTags];
  return [...new Set(all)]; // 去重
}

/**
 * 生成 feed_reason
 * 基于商品状态、品牌热度、价格变化、发售类型等信号
 */
export function generateFeedReason(params: {
  saleStatus: string;
  releaseType: string;
  isRerelease: boolean;
  isNew: boolean;
  brandHeatScore: number;
  hasPriceDrop: boolean;
  priceTrend: 'stable' | 'down' | 'up' | 'volatile';
  feedScore: number;
  eventEndAt?: string;
  lifecycleStatus?: string;
}): string {
  const {
    saleStatus,
    releaseType,
    isRerelease,
    isNew,
    brandHeatScore,
    hasPriceDrop,
    priceTrend,
    feedScore,
    eventEndAt,
  } = params;

  // 即将截止预约
  if (eventEndAt) {
    const endDate = new Date(eventEndAt);
    const now = new Date();
    const hoursLeft = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursLeft > 0 && hoursLeft <= 72) {
      return '即将截止预约';
    }
  }

  // 热门品牌新品（品牌热度>=70 + 新品/预约状态）
  if (brandHeatScore >= 70 && (isNew || saleStatus === 'UPCOMING' || saleStatus === 'PRE_ORDER')) {
    return '热门品牌新品';
  }

  // 历史高热再贩（feed_score>=60 + 再贩）
  if (feedScore >= 60 && isRerelease) {
    return '历史高热再贩';
  }

  // 最近降价
  if (hasPriceDrop || priceTrend === 'down') {
    return '最近降价';
  }

  // 首发预售
  if (releaseType === 'reservation' && saleStatus === 'PRE_ORDER') {
    return '首发预售';
  }

  // 品牌上新
  if (isNew) {
    return '品牌上新';
  }

  // 再贩
  if (isRerelease) {
    return '再贩返场';
  }

  // 现货在售
  if (saleStatus === 'ON_SALE') {
    return '现货在售';
  }

  // 默认
  return '精选推荐';
}

/**
 * 根据 feed_reason 计算额外排序加权
 * 优先级越高，加权越大
 */
export function reasonBoost(reason: string): number {
  switch (reason) {
    case '即将截止预约': return 30;
    case '热门品牌新品': return 25;
    case '历史高热再贩': return 20;
    case '最近降价': return 18;
    case '首发预售': return 15;
    case '品牌上新': return 12;
    case '再贩返场': return 10;
    case '现货在售': return 5;
    default: return 0;
  }
}

/**
 * 计算最终排序分数 = feed_score + reason_boost
 */
export function computeRankingScore(feedScore: number, reason: string): number {
  return feedScore + reasonBoost(reason);
}
