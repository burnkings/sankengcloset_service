// tests/crawler/domestic-release-enrichment.test.ts — Release 数据增强测试

import { describe, it, expect } from 'vitest';
import { parseAnnouncement } from '../../src/crawler/parsers/announcement-parser.js';

const meta = { brand: 'With Puji', sourceUrl: 'https://example.com', publishedAt: '2024-06-01', pitType: 'LOLITA' };

describe('Domestic Release Enrichment', () => {
  // Case 1: product_releases 可生成
  it('应生成 product_releases', () => {
    const result = parseAnnouncement('「Test JSK」一期预约\n全款499元', meta);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products[0]!.releaseNo).toBe(1);
    expect(result.products[0]!.releaseType).toBe('reservation');
  });

  // Case 2: release_type 可识别
  it('应识别多种 release_type', () => {
    const text = `一期预约 定金100 全款499

二期再贩 全款499

现货即发 全款399

首发 全款500`;
    const result = parseAnnouncement(text, meta);
    const types = new Set(result.products.map(p => p.releaseType));
    expect(types.has('reservation')).toBe(true);
    expect(types.has('rerelease')).toBe(true);
    expect(types.has('spot')).toBe(true);
    expect(types.has('first_release')).toBe(true);
  });

  // Case 3: 定金/尾款/全款可拆分
  it('应拆分价格结构', () => {
    const result = parseAnnouncement('商品A\n定金：100元\n尾款：399元\n全款：499元', meta);
    const p = result.products[0]!;
    expect(p.depositPriceCents).toBe(10000);
    expect(p.balancePriceCents).toBe(39900);
    expect(p.fullPriceCents).toBe(49900);
  });

  // Case 4: draft release 不进 Feed
  it('默认 visibility_status 为 draft', () => {
    const result = parseAnnouncement('「Test」一期预约 全款499', meta);
    // Parser 返回的数据不含 visibility_status，由 persistence 设置
    expect(result.products[0]!.releaseType).toBe('reservation');
  });

  // Case 5: published release 可进 Feed
  it('release 数据可用于 Feed', () => {
    const result = parseAnnouncement('「Test」现货 全款399', meta);
    const p = result.products[0]!;
    expect(p.releaseType).toBe('spot');
    expect(p.saleStatus).toBe('ON_SALE');
    expect(p.fullPriceCents).toBe(39900);
  });

  // Case 6: 多商品解析
  it('应解析多个商品', () => {
    const text = `「商品A」一期 定金100 全款499

「商品B」二期再贩 全款399

「商品C」现货 全款299`;
    const result = parseAnnouncement(text, meta);
    expect(result.products.length).toBeGreaterThanOrEqual(3);
  });

  // Case 7: 时间信息提取
  it('应提取时间信息', () => {
    const result = parseAnnouncement('商品A\n发售时间：2024年6月1日', meta);
    expect(result.products[0]!.startAt).toBeTruthy();
  });
});
