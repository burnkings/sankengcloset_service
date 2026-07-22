// tests/crawler/snapshot-import-formats.test.ts — Snapshot Import 多格式测试

import { describe, it, expect } from 'vitest';
import { parseAnnouncement, parseMetadata } from '../../src/crawler/parsers/announcement-parser.js';

describe('Snapshot Import Formats', () => {
  // Case 7: text snapshot 可导入
  it('text snapshot 可解析', () => {
    const text = 'brand: TestBrand\nsource_url: https://test.com\n---\n「Test JSK」一期预约\n定金100元\n全款499元';
    const { metadata, body } = parseMetadata(text);
    expect(metadata.brand).toBe('TestBrand');
    const result = parseAnnouncement(body, metadata);
    expect(result.products.length).toBeGreaterThan(0);
  });

  // Case 8: html snapshot 可解析
  it('html snapshot 可解析（作为 text 处理）', () => {
    const html = '<h1>Test Product</h1><p>一期预约 定金100 全款499</p>';
    const result = parseAnnouncement(html, { brand: 'Test', sourceUrl: '', publishedAt: '', pitType: '' });
    expect(result.products.length).toBeGreaterThan(0);
  });

  // Case 9: parser_warnings 可记录
  it('parser_warnings 可记录', () => {
    const result = parseAnnouncement('没有关键信息的文本', { brand: 'Test', sourceUrl: '', publishedAt: '', pitType: '' });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // Case 10: 无元数据时使用默认值
  it('无元数据时使用默认值', () => {
    const result = parseAnnouncement('「Test」一期 全款499元', { brand: '', sourceUrl: '', publishedAt: '', pitType: '' });
    expect(result.products[0]!.brand).toBe('');
  });
});
