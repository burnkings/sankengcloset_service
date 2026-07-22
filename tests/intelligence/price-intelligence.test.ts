// tests/intelligence/price-intelligence.test.ts — 价格智能分析测试

import { describe, it, expect } from 'vitest';
import { computePriceStats, computeBatchPriceStats } from '../../src/intelligence/price-intelligence.js';

describe('Price Intelligence', () => {
  describe('computePriceStats', () => {
    it('should return null for empty snapshots', () => {
      expect(computePriceStats([])).toBeNull();
    });

    it('should compute basic stats from single snapshot', () => {
      const stats = computePriceStats([
        { product_id: 'p1', price_cents: 12800, created_at: '2026-01-01' },
      ]);
      expect(stats).not.toBeNull();
      expect(stats!.first_price_cents).toBe(12800);
      expect(stats!.current_price_cents).toBe(12800);
      expect(stats!.min_price_cents).toBe(12800);
      expect(stats!.max_price_cents).toBe(12800);
      expect(stats!.price_change_count).toBe(0);
      expect(stats!.price_trend).toBe('stable');
    });

    it('should detect price decrease', () => {
      const stats = computePriceStats([
        { product_id: 'p1', price_cents: 12800, created_at: '2026-01-01' },
        { product_id: 'p1', price_cents: 9900, created_at: '2026-02-01' },
      ]);
      expect(stats!.decrease_count).toBe(1);
      expect(stats!.increase_count).toBe(0);
      expect(stats!.price_trend).toBe('down');
      expect(stats!.min_price_cents).toBe(9900);
    });

    it('should detect price increase', () => {
      const stats = computePriceStats([
        { product_id: 'p1', price_cents: 9900, created_at: '2026-01-01' },
        { product_id: 'p1', price_cents: 12800, created_at: '2026-02-01' },
      ]);
      expect(stats!.increase_count).toBe(1);
      expect(stats!.price_trend).toBe('up');
      expect(stats!.max_price_cents).toBe(12800);
    });

    it('should detect volatile price (multiple changes)', () => {
      const stats = computePriceStats([
        { product_id: 'p1', price_cents: 12800, created_at: '2026-01-01' },
        { product_id: 'p1', price_cents: 9900, created_at: '2026-02-01' },
        { product_id: 'p1', price_cents: 11800, created_at: '2026-03-01' },
        { product_id: 'p1', price_cents: 8800, created_at: '2026-04-01' },
      ]);
      expect(stats!.price_change_count).toBe(3);
      expect(stats!.decrease_count).toBe(2);
      expect(stats!.increase_count).toBe(1);
      expect(stats!.price_trend).toBe('volatile');
    });

    it('should compute correct min/max across all snapshots', () => {
      const stats = computePriceStats([
        { product_id: 'p1', price_cents: 15000, created_at: '2026-01-01' },
        { product_id: 'p1', price_cents: 8000, created_at: '2026-02-01' },
        { product_id: 'p1', price_cents: 20000, created_at: '2026-03-01' },
        { product_id: 'p1', price_cents: 12000, created_at: '2026-04-01' },
      ]);
      expect(stats!.min_price_cents).toBe(8000);
      expect(stats!.max_price_cents).toBe(20000);
      expect(stats!.current_price_cents).toBe(12000);
    });

    it('should set last_updated_at to latest snapshot', () => {
      const stats = computePriceStats([
        { product_id: 'p1', price_cents: 12800, created_at: '2026-01-01' },
        { product_id: 'p1', price_cents: 9900, created_at: '2026-06-15' },
      ]);
      expect(stats!.last_updated_at).toBe('2026-06-15');
    });
  });

  describe('computeBatchPriceStats', () => {
    it('should compute stats for multiple products', () => {
      const snapshots = [
        { product_id: 'p1', price_cents: 12800, created_at: '2026-01-01' },
        { product_id: 'p1', price_cents: 9900, created_at: '2026-02-01' },
        { product_id: 'p2', price_cents: 25800, created_at: '2026-01-01' },
      ];
      const results = computeBatchPriceStats(snapshots);
      expect(results.size).toBe(2);
      expect(results.get('p1')!.decrease_count).toBe(1);
      expect(results.get('p2')!.price_change_count).toBe(0);
    });

    it('should handle empty input', () => {
      expect(computeBatchPriceStats([]).size).toBe(0);
    });
  });
});
