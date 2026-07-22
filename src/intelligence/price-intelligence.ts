// intelligence/price-intelligence.ts — 价格智能分析引擎
// 基于 price_snapshots 计算价格统计，不覆盖历史

export interface PriceStats {
  product_id: string;
  first_price_cents: number;     // 首次价格
  current_price_cents: number;   // 当前价格（最新快照）
  min_price_cents: number;       // 历史最低价
  max_price_cents: number;       // 历史最高价
  price_change_count: number;    // 价格变化次数
  decrease_count: number;        // 降价次数
  increase_count: number;        // 涨价次数
  last_updated_at: string;       // 最后更新时间
  price_trend: 'stable' | 'down' | 'up' | 'volatile'; // 价格趋势
}

interface SnapshotRow {
  product_id: string;
  price_cents: number;
  created_at: string;
}

// ────────────────────────────────────────────────
// 计算引擎
// ────────────────────────────────────────────────

/**
 * 从 price_snapshots 计算价格统计
 * @param snapshots - 按 created_at ASC 排序的价格快照
 */
export function computePriceStats(snapshots: SnapshotRow[]): PriceStats | null {
  if (snapshots.length === 0) return null;

  const prices = snapshots.map(s => s.price_cents);
  const firstPrice = prices[0]!;
  const currentPrice = prices[prices.length - 1]!;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // 计算变化次数
  let decreaseCount = 0;
  let increaseCount = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i]! < prices[i - 1]!) decreaseCount++;
    else if (prices[i]! > prices[i - 1]!) increaseCount++;
  }
  const changeCount = decreaseCount + increaseCount;

  // 判断趋势
  let trend: PriceStats['price_trend'] = 'stable';
  if (changeCount === 0) {
    trend = 'stable';
  } else if (changeCount >= 3 && decreaseCount > 0 && increaseCount > 0) {
    trend = 'volatile';
  } else if (currentPrice < firstPrice) {
    trend = 'down';
  } else if (currentPrice > firstPrice) {
    trend = 'up';
  }

  return {
    product_id: snapshots[0]!.product_id,
    first_price_cents: firstPrice,
    current_price_cents: currentPrice,
    min_price_cents: minPrice,
    max_price_cents: maxPrice,
    price_change_count: changeCount,
    decrease_count: decreaseCount,
    increase_count: increaseCount,
    last_updated_at: snapshots[snapshots.length - 1]!.created_at,
    price_trend: trend,
  };
}

/**
 * 批量计算多个商品的价格统计
 */
export function computeBatchPriceStats(
  allSnapshots: SnapshotRow[],
): Map<string, PriceStats> {
  // 按 product_id 分组
  const grouped = new Map<string, SnapshotRow[]>();
  for (const s of allSnapshots) {
    const list = grouped.get(s.product_id) || [];
    list.push(s);
    grouped.set(s.product_id, list);
  }

  // 每组按时间排序后计算
  const results = new Map<string, PriceStats>();
  for (const [productId, snaps] of grouped) {
    snaps.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const stats = computePriceStats(snaps);
    if (stats) results.set(productId, stats);
  }
  return results;
}
