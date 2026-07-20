// crawler/cleaning/advanced-deduplicator.ts — 高级去重

export interface DedupCandidate {
  id: string;
  canonicalName: string;
  brandName: string;
  category: string;
  currentPrice: number;
  sourceUrl: string;
  sourcePlatform: string;
  images: string[];
}

export interface DedupMatch {
  candidate: DedupCandidate;
  matchType: 'exact' | 'multi_source' | 'color_variant' | 'series_variant' | 'update' | 're_release' | 'similar';
  confidence: number;
  reason: string;
}

export class AdvancedDeduplicator {
  private known: DedupCandidate[] = [];

  load(products: DedupCandidate[]): void {
    this.known = [...products];
  }

  /** 查找所有匹配候选 */
  findMatches(item: {
    canonicalName: string;
    brandName: string;
    category: string;
    currentPrice: number;
    sourceUrl: string;
    images: string[];
  }): DedupMatch[] {
    const matches: DedupMatch[] = [];

    for (const c of this.known) {
      // P0: 完全重复（品牌+名称完全一致）
      if (c.brandName === item.brandName && c.canonicalName === item.canonicalName) {
        matches.push({ candidate: c, matchType: 'exact', confidence: 100, reason: '品牌+名称完全一致' });
        continue;
      }

      // P1: 同商品多来源（名称一致，来源不同）
      if (c.canonicalName === item.canonicalName && c.sourcePlatform !== item.sourceUrl) {
        matches.push({ candidate: c, matchType: 'multi_source', confidence: 90, reason: '同名商品不同来源' });
        continue;
      }

      // P2: 同商品不同颜色（名称含颜色差异）
      const nameA = c.canonicalName.replace(/(?:深|浅|黑|白|粉|蓝|红|绿|紫|灰|棕|绀|藏青).+/, '').trim();
      const nameB = item.canonicalName.replace(/(?:深|浅|黑|白|粉|蓝|红|绿|紫|灰|棕|绀|藏青).+/, '').trim();
      if (nameA === nameB && nameA.length > 2) {
        matches.push({ candidate: c, matchType: 'color_variant', confidence: 70, reason: `同款不同色: ${c.canonicalName} vs ${item.canonicalName}` });
        continue;
      }

      // P3: 商品更新（名称一致，价格变化）
      if (c.canonicalName === item.canonicalName && c.currentPrice !== item.currentPrice && c.currentPrice > 0 && item.currentPrice > 0) {
        matches.push({ candidate: c, matchType: 'update', confidence: 85, reason: `价格变化: ¥${c.currentPrice / 100} → ¥${item.currentPrice / 100}` });
        continue;
      }

      // P4: 相似但不是同一商品（名称相似度 > 80%）
      const similarity = this.calculateSimilarity(c.canonicalName, item.canonicalName);
      if (similarity > 0.8 && c.brandName === item.brandName) {
        matches.push({ candidate: c, matchType: 'similar', confidence: Math.round(similarity * 60), reason: `名称相似度 ${(similarity * 100).toFixed(0)}%` });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /** 计算两个字符串的相似度（Jaccard） */
  private calculateSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(''));
    const setB = new Set(b.split(''));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}
