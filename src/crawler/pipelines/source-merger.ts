// crawler/pipelines/source-merger.ts — 多来源合并器

import type { NormalizedItem } from '../core/types.js';

/** 来源优先级（数字越小优先级越高） */
export const SOURCE_PRIORITY: Record<string, number> = {
  'OFFICIAL': 1,     // 品牌官网
  'ADMIN': 2,        // 管理员录入
  'WECHAT_MP': 3,    // 微信公众号
  'WEIBO': 4,        // 微博品牌账号
  'TAOBAO': 5,       // 淘宝
  'TMALL': 5,        // 天猫
  'USER_SUBMIT': 6,  // 用户提交
  'AI_EXTRACT': 7,   // AI 提取
  'FIXTURE': 100,    // 测试数据
};

export interface MergeCandidate {
  item: NormalizedItem;
  sourceType: string;
  priority: number;
}

export interface MergeResult {
  winner: MergeCandidate;
  losers: MergeCandidate[];
  conflicts: FieldConflict[];
}

export interface FieldConflict {
  field: string;
  winningValue: unknown;
  losingValue: unknown;
  winningSource: string;
  losingSource: string;
  resolution: 'priority' | 'newest' | 'most_complete';
}

export class SourceMerger {
  /** 合并同商品的多个来源 */
  merge(candidates: MergeCandidate[]): MergeResult {
    if (candidates.length === 0) throw new Error('No candidates to merge');
    if (candidates.length === 1) return { winner: candidates[0]!, losers: [], conflicts: [] };

    // 按优先级排序
    const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
    const winner = sorted[0]!!;
    const losers = sorted.slice(1);
    const conflicts: FieldConflict[] = [];

    // 合并字段
    const merged = this.mergeFields(winner, losers, conflicts);

    return { winner: { ...winner, item: merged }, losers, conflicts };
  }

  private mergeFields(
    winner: MergeCandidate,
    losers: MergeCandidate[],
    conflicts: FieldConflict[],
  ): NormalizedItem {
    const result = { ...winner.item };

    for (const loser of losers) {
      // 价格冲突：取更完整的价格（有定金+尾款的优先）
      if (loser.item.depositPrice > 0 && result.depositPrice === 0) {
        conflicts.push({
          field: 'depositPrice',
          winningValue: result.depositPrice,
          losingValue: loser.item.depositPrice,
          winningSource: winner.sourceType,
          losingSource: loser.sourceType,
          resolution: 'priority',
        });
        result.depositPrice = loser.item.depositPrice;
        result.balancePrice = loser.item.balancePrice;
      }

      // 描述冲突：取更长的描述
      if (loser.item.description.length > result.description.length) {
        conflicts.push({
          field: 'description',
          winningValue: result.description.slice(0, 50) + '...',
          losingValue: loser.item.description.slice(0, 50) + '...',
          winningSource: winner.sourceType,
          losingSource: loser.item.sourceUrl,
          resolution: 'most_complete',
        });
        result.description = loser.item.description;
      }

      // 图片冲突：合并图片列表（去重）
      const newImages = loser.item.images.filter(img => !result.images.includes(img));
      if (newImages.length > 0) {
        conflicts.push({
          field: 'images',
          winningValue: `${result.images.length} images`,
          losingValue: `${newImages.length} new images`,
          winningSource: winner.sourceType,
          losingSource: loser.sourceType,
          resolution: 'priority',
        });
        result.images = [...result.images, ...newImages];
        if (!result.coverUrl && loser.item.coverUrl) {
          result.coverUrl = loser.item.coverUrl;
        }
      }

      // 发售时间冲突：取更具体的（有具体时间优先）
      if (!result.sourcePublishedAt && loser.item.sourcePublishedAt) {
        result.sourcePublishedAt = loser.item.sourcePublishedAt;
      }

      // 标签合并
      const newTags = loser.item.tags.filter(t => !result.tags.includes(t));
      result.tags = [...result.tags, ...newTags];
    }

    return result;
  }

  /** 按来源分组 */
  groupByProduct(items: NormalizedItem[]): Map<string, MergeCandidate[]> {
    const groups = new Map<string, MergeCandidate[]>();
    for (const item of items) {
      const key = `${item.normalizedBrandName}::${item.canonicalName.toLowerCase()}`;
      const existing = groups.get(key) ?? [];
      existing.push({
        item,
        sourceType: 'OFFICIAL' as string,
        priority: SOURCE_PRIORITY['OFFICIAL'] ?? 50,
      });
      groups.set(key, existing);
    }
    return groups;
  }

  /** 检查来源是否被禁用 */
  isSourceDisabled(sourceType: string, disabledSources: Set<string>): boolean {
    return disabledSources.has(sourceType);
  }
}
