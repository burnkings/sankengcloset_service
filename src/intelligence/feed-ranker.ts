// intelligence/feed-ranker.ts — Feed 排序理由引擎 (12-table schema)

const RELEASE_TYPE_NAMES: Record<string, string> = {
  first_release: '首发',
  rerelease: '再贩',
  reservation: '预约',
  spot: '现货',
  lottery: '抽选',
  unknown: '未知',
};

export function formatPriceSummary(priceCents: number): string {
  if (priceCents <= 0) return '价格待定';
  return `¥${(priceCents / 100).toFixed(2)}`;
}

export function getReleaseTypeName(releaseType: string): string {
  return RELEASE_TYPE_NAMES[releaseType] ?? '未知';
}

export function mergeTags(...args: unknown[]): string[] {
  const all: string[] = [];
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    for (const key of ['season_tags', 'scene_tags', 'element_tags', 'recommended_tags']) {
      const arr = (args[0] as Record<string, unknown>)[key];
      if (Array.isArray(arr)) all.push(...arr.map(String));
    }
  } else {
    for (const arg of args) {
      if (Array.isArray(arg)) all.push(...(arg as unknown[]).map(String));
    }
  }
  return [...new Set(all)];
}

export function generateFeedReason(row: Record<string, unknown>): string {
  const saleStatus = String(row.sale_status ?? '');
  const feedScore = Number(row.feed_score ?? 0);
  if (saleStatus === 'PRE_ORDER') return '预约中';
  if (saleStatus === 'ON_SALE') return '在售';
  if (feedScore > 50) return '热门商品';
  return '';
}

export function computeRankingScore(params: { feedScore: number; viewCount: number; favoriteCount: number }): number {
  return params.feedScore + params.viewCount * 0.1 + params.favoriteCount * 2;
}
