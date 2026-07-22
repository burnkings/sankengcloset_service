// tests/crawler/announcement-parser.test.ts — Announcement Parser 测试

import { describe, it, expect } from 'vitest';
import { parseAnnouncement, parseMetadata } from '../../src/crawler/parsers/announcement-parser.js';

const baseMeta = { brand: 'With Puji', sourceUrl: 'https://example.com', publishedAt: '2024-06-01', pitType: 'LOLITA' };

describe('Announcement Parser', () => {
  // Case 1: 一期解析
  it('应解析一期预约', () => {
    const result = parseAnnouncement('「Test JSK」一期预约\n定金：100元\n全款：499元', baseMeta);
    expect(result.products.length).toBeGreaterThanOrEqual(1);
    const p = result.products.find(x => x.releaseNo === 1);
    expect(p).toBeDefined();
    expect(p!.releaseType).toBe('reservation');
  });

  // Case 2: 二期再贩
  it('应解析二期再贩', () => {
    const result = parseAnnouncement('「Test JSK」二期再贩\n全款：499元', baseMeta);
    const p = result.products.find(x => x.releaseNo === 2);
    expect(p).toBeDefined();
    expect(p!.releaseType).toBe('rerelease');
    expect(p!.isRerelease).toBe(true);
  });

  // Case 3: 预约识别
  it('应识别预约类型', () => {
    const result = parseAnnouncement('预约开始\n定金100', baseMeta);
    expect(result.products[0]!.releaseType).toBe('reservation');
  });

  // Case 4: 定金/尾款/全款拆分
  it('应拆分定金/尾款/全款', () => {
    const result = parseAnnouncement('商品A\n定金：100元\n尾款：399元\n全款：499元', baseMeta);
    const p = result.products[0]!;
    expect(p.depositPriceCents).toBe(10000);
    expect(p.balancePriceCents).toBe(39900);
    expect(p.fullPriceCents).toBe(49900);
  });

  // Case 5: 售罄/截止/结束
  it('应识别售罄状态', () => {
    const result = parseAnnouncement('商品A 售罄', baseMeta);
    expect(result.products[0]!.isSoldOut).toBe(true);
    expect(result.products[0]!.saleStatus).toBe('SOLD_OUT');
  });

  it('应识别结束状态', () => {
    const result = parseAnnouncement('商品A 已结束', baseMeta);
    expect(result.products[0]!.saleStatus).toBe('ENDED');
  });

  // Case 6: 现货识别
  it('应识别现货类型', () => {
    const result = parseAnnouncement('商品A 现货即发', baseMeta);
    expect(result.products[0]!.releaseType).toBe('spot');
  });

  // Case 7: parser_warnings
  it('无法识别时应生成警告', () => {
    const result = parseAnnouncement('随便一段文字没有任何关键信息', baseMeta);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // Case 8: 元数据解析
  it('应解析文件头元数据', () => {
    const text = 'brand: TestBrand\nsource_url: https://test.com\npublished_at: 2024-01-01\npit_type: JK\n---\n正文内容';
    const { metadata, body } = parseMetadata(text);
    expect(metadata.brand).toBe('TestBrand');
    expect(metadata.sourceUrl).toBe('https://test.com');
    expect(body).toBe('正文内容');
  });

  // Case 9: 批次号解析
  it('应解析第N批', () => {
    const result = parseAnnouncement('商品A 第3批\n现货', baseMeta);
    expect(result.products[0]!.releaseNo).toBe(3);
  });

  // Case 10: 价格¥格式
  it('应解析¥价格', () => {
    const result = parseAnnouncement('商品A\n¥499', baseMeta);
    expect(result.products[0]!.fullPriceCents).toBe(49900);
  });

  // Case 11: 价格"元"格式
  it('应解析N元格式', () => {
    const result = parseAnnouncement('商品A\n499元', baseMeta);
    expect(result.products[0]!.fullPriceCents).toBe(49900);
  });

  // Case 12: 坑向检测
  it('应检测 Lolita 坑向', () => {
    const result = parseAnnouncement('JSK 连衣裙', baseMeta);
    expect(result.products[0]!.pitType).toBe('LOLITA');
  });

  it('应检测 JK 坑向', () => {
    const result = parseAnnouncement('JK 格裙', { ...baseMeta, pitType: '' });
    expect(result.products[0]!.pitType).toBe('JK');
  });
});
