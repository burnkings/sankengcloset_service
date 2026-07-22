// tests/intelligence/brand-intelligence.test.ts — 品牌智能画像测试

import { describe, it, expect } from 'vitest';
import { buildBrandProfile } from '../../src/intelligence/brand-intelligence.js';

describe('Brand Intelligence', () => {
  const baseBrand = { id: 'br_001', name: '兔缝缝', follower_count: 500000 };

  it('should compute heat score for active brand', () => {
    const products = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`, category: '格裙', current_price: 12800,
      created_at: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    const profile = buildBrandProfile(baseBrand, products);
    expect(profile.heat_score).toBeGreaterThan(50);
    expect(profile.brand_status).toBe('active');
  });

  it('should compute avg price correctly', () => {
    const products = [
      { id: 'p1', category: '格裙', current_price: 12800, created_at: '2026-01-01' },
      { id: 'p2', category: '格裙', current_price: 16800, created_at: '2026-02-01' },
    ];
    const profile = buildBrandProfile(baseBrand, products);
    expect(profile.avg_price_cents).toBe(14800);
  });

  it('should compute popular series from categories', () => {
    const products = [
      { id: 'p1', category: '格裙', current_price: 12800, created_at: '2026-01-01' },
      { id: 'p2', category: '格裙', current_price: 12800, created_at: '2026-02-01' },
      { id: 'p3', category: '水手服', current_price: 15800, created_at: '2026-03-01' },
    ];
    const profile = buildBrandProfile(baseBrand, products);
    expect(profile.popular_series[0]).toBe('格裙');
  });

  it('should return inactive for brand with no products', () => {
    const profile = buildBrandProfile(baseBrand, []);
    expect(profile.brand_status).toBe('inactive');
    expect(profile.product_count).toBe(0);
    expect(profile.heat_score).toBeGreaterThanOrEqual(0);
  });

  it('should compute release cycle', () => {
    const products = [
      { id: 'p1', category: '格裙', current_price: 12800, created_at: '2026-01-01' },
      { id: 'p2', category: '格裙', current_price: 12800, created_at: '2026-01-15' },
      { id: 'p3', category: '格裙', current_price: 12800, created_at: '2026-02-01' },
    ];
    const profile = buildBrandProfile(baseBrand, products);
    expect(profile.release_cycle_days).toBeGreaterThan(0);
    expect(profile.release_cycle_days).toBeLessThanOrEqual(20);
  });

  it('should set quiet status for slow-update brand', () => {
    const products = [
      { id: 'p1', category: '格裙', current_price: 12800, created_at: '2026-01-01' },
      { id: 'p2', category: '格裙', current_price: 12800, created_at: '2026-04-01' }, // 90 days gap
    ];
    const profile = buildBrandProfile(baseBrand, products);
    expect(profile.brand_status).toBe('quiet');
  });

  it('should include follower count', () => {
    const profile = buildBrandProfile(baseBrand, []);
    expect(profile.follower_count).toBe(500000);
  });
});
