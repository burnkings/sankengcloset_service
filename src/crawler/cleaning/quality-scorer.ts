// crawler/cleaning/quality-scorer.ts — 质量评分

export interface QualityScore {
  total: number;
  sourceCredibility: number;
  fieldCompleteness: number;
  imageQuality: number;
  freshness: number;
  parserConfidence: number;
  humanReviewed: boolean;
}

export class QualityScorer {
  score(item: {
    sourceType?: string;
    canonicalName?: string;
    brandName?: string;
    category?: string;
    currentPrice?: number;
    description?: string;
    coverUrl?: string;
    images?: string[];
    sourcePublishedAt?: string | null;
    confidence?: number;
    reviewStatus?: string;
  }): QualityScore {
    const sourceCredibility = this.scoreSource(item.sourceType ?? '');
    const fieldCompleteness = this.scoreCompleteness(item);
    const imageQuality = this.scoreImages(item.coverUrl, item.images);
    const freshness = this.scoreFreshness(item.sourcePublishedAt ?? null);
    const parserConfidence = item.confidence ?? 50;
    const humanReviewed = item.reviewStatus === 'APPROVED';

    const total = Math.round(
      sourceCredibility * 0.2 +
      fieldCompleteness * 0.25 +
      imageQuality * 0.15 +
      freshness * 0.1 +
      parserConfidence * 0.2 +
      (humanReviewed ? 100 : 50) * 0.1
    );

    return { total, sourceCredibility, fieldCompleteness, imageQuality, freshness, parserConfidence, humanReviewed };
  }

  private scoreSource(type: string): number {
    const map: Record<string, number> = {
      'ADMIN': 100, 'OFFICIAL': 90, 'USER_SUBMIT': 70,
      'WEIBO': 60, 'WECHAT_MP': 60, 'BILIBILI': 50,
      'TAOBAO': 50, 'TMALL': 50, 'XIAOHONGSHU': 40, 'AI_EXTRACT': 30, 'FIXTURE': 100,
    };
    return map[type] ?? 40;
  }

  private scoreCompleteness(item: { canonicalName?: string; brandName?: string; category?: string; currentPrice?: number; description?: string }): number {
    let score = 0;
    if (item.canonicalName) score += 25;
    if (item.brandName) score += 20;
    if (item.category) score += 15;
    if (item.currentPrice && item.currentPrice > 0) score += 20;
    if (item.description) score += 10;
    if ((item as any).coverUrl) score += 10;
    return score;
  }

  private scoreImages(cover?: string, images?: string[]): number {
    if (!cover) return 0;
    let score = 50;
    if (images && images.length > 1) score += 25;
    if (images && images.length > 3) score += 25;
    return Math.min(100, score);
  }

  private scoreFreshness(iso: string | null): number {
    if (!iso) return 20;
    const age = Date.now() - new Date(iso).getTime();
    if (age < 0) return 100;
    if (age < 30 * 86400000) return 90;
    if (age < 90 * 86400000) return 70;
    if (age < 180 * 86400000) return 50;
    return 30;
  }
}
