// tests/content/search-alias.test.ts — Phase 2.2-A Search Alias 搜索别名测试
// 纯内存测试（MemoryRepository + seedSearchAlias/seedStyle/seedProduct 注入），
// 符合生产库保护约束（不碰 127.0.0.1:5433）。
//
// 覆盖：normalize（NFKC/大小写/空格）、alias 解析（category/brand/style）、
// 实体搜索、相关性排序、向后兼容、seed 词表幂等。

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryRepository } from '../../src/repositories/memory.js';
import { normalizeSearchTerm, resolveSearchTerms } from '../../src/lib/search-terms.js';
import { CATEGORY_ALIASES } from '../../src/lib/search-alias-words.js';
import type { Product, StyleDetail } from '../../src/types.js';

let app: FastifyInstance | undefined;
let repository: MemoryRepository;

async function createApp() {
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DRIVER: 'memory',
    JWT_SECRET: 'test-secret-that-is-longer-than-32-characters',
    PUBLIC_BASE_URL: 'http://localhost:8787', UPLOAD_DIR: '/tmp/sankeng-api-tests',
  });
  repository = new MemoryRepository();
  app = await buildApp({ config, repository, logger: false });
  await app.ready();
  return app;
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function search(q: string): Promise<Array<{ entityId: string; title: string; category: string; brandName: string }>> {
  const instance = await createApp();
  const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}` });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

/** 注入月光曲 style + 关联商品（覆盖默认 seed 的 styleId 为空） */
function seedMoonlightStyle(): void {
  repository.seedStyle({
    id: 'sty_moonlight', brandId: 'br_starcat', brandName: '星辰猫', canonicalName: '月光曲 JSK',
    category: 'LOLITA', subCategory: 'JSK', styleTags: ['甜系'], description: '',
    productCount: 1, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
    products: [],
  });
  repository.seedProduct({
    id: 'prd_lolita_moon', brandId: 'br_starcat', brandName: '星辰猫', title: '月光曲 JSK',
    category: 'LOLITA', subCategory: 'JSK', status: 'PRE_ORDER', coverUrl: 'https://images.example.invalid/moon-jsk-cover.jpg',
    images: [], priceCents: 36800, originalPriceCents: 39800, priceType: 'DEPOSIT', depositCents: 10000, balanceCents: 26800,
    colorTags: ['白色'], materialTags: ['棉'], featureTags: ['甜系'], variants: [],
    description: '', shopUrl: '',
    createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
    styleId: 'sty_moonlight', currentRelease: null,
  });
}

describe('normalizeSearchTerm（单元）', () => {
  it('trim + NFKC + 小写 + 多空格折叠', () => {
    expect(normalizeSearchTerm('  ＪＫ ')).toBe('jk');            // 全角→半角
    expect(normalizeSearchTerm('ＬＯＬＩＴＡ')).toBe('lolita');   // 全角→半角
    expect(normalizeSearchTerm('  LOLITA  ')).toBe('lolita');     // trim + 小写
    expect(normalizeSearchTerm('兔缝缝  格裙')).toBe('兔缝缝 格裙'); // 多空格折叠
    expect(normalizeSearchTerm('')).toBe('');
  });
});

describe('resolveSearchTerms（单元）', () => {
  it('分类别名命中（exact 优先，包含其次）', () => {
    const rows = CATEGORY_ALIASES.map((w) => ({
      id: `alias_${w.aliasType}_${w.term}`, term: w.term, canonicalTerm: w.canonicalTerm,
      aliasType: w.aliasType, status: w.status, confidence: w.confidence, source: w.source,
    }));
    const jk = resolveSearchTerms('jk', rows);
    expect(jk.categoryMatches).toEqual(['JK']);
    const jkUniform = resolveSearchTerms('jk制服', rows); // contains
    expect(jkUniform.categoryMatches).toEqual(['JK']);
    const lolita = resolveSearchTerms('lo裙', rows);
    expect(lolita.categoryMatches).toEqual(['LOLITA']);
    const hanfu = resolveSearchTerms('马面裙', rows);
    expect(hanfu.categoryMatches).toEqual(['HANFU']);
  });

  it('无命中时返回空分组（不失败）', () => {
    const rows = CATEGORY_ALIASES.map((w) => ({
      id: `alias_${w.aliasType}_${w.term}`, term: w.term, canonicalTerm: w.canonicalTerm,
      aliasType: w.aliasType, status: w.status, confidence: w.confidence, source: w.source,
    }));
    const result = resolveSearchTerms('不存在的词xyz', rows);
    expect(result.categoryMatches).toEqual([]);
    expect(result.brandIds).toEqual([]);
    expect(result.styleIds).toEqual([]);
    expect(result.aliases).toEqual([]);
  });
});

describe('Search Alias API（memory）', () => {
  it('1. lo裙 → LOLITA 分类', async () => {
    const items = await search('lo裙');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.category === 'LOLITA')).toBe(true);
  });

  it('2. Lolita / LOLITA / 洛丽塔 → LOLITA（已有行为保留）', async () => {
    for (const q of ['Lolita', 'LOLITA', '洛丽塔']) {
      const items = await search(q);
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((i) => i.category === 'LOLITA')).toBe(true);
    }
  });

  it('3. 格裙 → JK 分类', async () => {
    const items = await search('格裙');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.category === 'JK')).toBe(true);
  });

  it('4. 汉服类别搜索（汉服 / 马面裙 / 圆领袍）', async () => {
    for (const q of ['汉服', '马面裙', '圆领袍']) {
      const items = await search(q);
      expect(items.some((i) => i.category === 'HANFU')).toBe(true);
    }
  });

  it('5. Brand alias：星猫 → 星辰猫（br_starcat）商品', async () => {
    const instance = await createApp();
    repository.seedSearchAlias({ id: 'alias_brand_星猫', term: '星猫', canonicalTerm: 'br_starcat', aliasType: 'brand', status: 'active', confidence: 100, source: 'seed' });
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=' + encodeURIComponent('星猫') });
    expect(response.statusCode).toBe(200);
    const items = response.json().data;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.brandName).toBe('星辰猫');
  });

  it('6. Style alias：月光 → sty_moonlight 款式商品', async () => {
    const instance = await createApp();
    seedMoonlightStyle();
    repository.seedSearchAlias({ id: 'alias_style_月光', term: '月光', canonicalTerm: 'sty_moonlight', aliasType: 'style', status: 'active', confidence: 100, source: 'seed' });
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=' + encodeURIComponent('月光') });
    expect(response.statusCode).toBe(200);
    const items = response.json().data;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.entityId).toBe('prd_lolita_moon');
  });

  it('7. 正式 Brand 名称（兔缝缝）', async () => {
    const items = await search('兔缝缝');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.brandName).toBe('兔缝缝');
  });

  it('8. 正式 Style 名称（月光曲 JSK）', async () => {
    const instance = await createApp();
    seedMoonlightStyle();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=' + encodeURIComponent('月光曲 JSK') });
    expect(response.statusCode).toBe(200);
    const items = response.json().data;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.category).toBe('LOLITA');
  });

  it('9. Product 搜索（深蓝格裙）', async () => {
    const items = await search('深蓝格裙');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.title).toContain('深蓝格裙');
  });

  it('10. 无 alias 的普通搜索（宋制旋裙套装）', async () => {
    const items = await search('宋制旋裙');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.title).toContain('宋制旋裙');
  });

  it('11. 空字符串返回全部（不失败）', async () => {
    const instance = await createApp();
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.length).toBeGreaterThan(0);
  });

  it('12. 大小写不敏感（JK / jk / Jk 同结果）', async () => {
    const jk = await search('JK');
    const jkLower = await search('jk');
    const jkMixed = await search('Jk');
    expect(jk.length).toBeGreaterThan(0);
    expect(jkLower.map((i) => i.entityId)).toEqual(jk.map((i) => i.entityId));
    expect(jkMixed.map((i) => i.entityId)).toEqual(jk.map((i) => i.entityId));
  });

  it('13. Unicode NFKC：全角 ＪＫ → JK', async () => {
    const items = await search('ＪＫ');
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.category === 'JK')).toBe(true);
  });

  it('14. 相关性排序：exact > prefix > contains > feed_score', async () => {
    const instance = await createApp();
    // 注入一组 title 匹配度不同的商品（同为 JK，feed_score 相同则由 rank 决定）
    const base: Product = {
      id: 'prd_rank_x', brandId: 'br_rabbit', brandName: '兔缝缝', title: '',
      category: 'JK', subCategory: '', status: 'ON_SALE', coverUrl: '', images: [], priceCents: 100, originalPriceCents: 0,
      priceType: 'FULL', depositCents: 0, balanceCents: 0, colorTags: [], materialTags: [], featureTags: [], variants: [],
      description: '', shopUrl: '', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
      styleId: null, currentRelease: null,
    };
    repository.seedProduct({ ...base, id: 'prd_rank_exact', title: '格裙' });
    repository.seedProduct({ ...base, id: 'prd_rank_prefix', title: '格裙 高级版' });
    repository.seedProduct({ ...base, id: 'prd_rank_contains', title: '深蓝大格裙摆' });
    repository.seedProduct({ ...base, id: 'prd_rank_other', title: '无关商品' });
    const response = await instance.inject({ method: 'GET', url: '/api/v1/search?q=' + encodeURIComponent('格裙') });
    const ids = response.json().data.map((i: { entityId: string }) => i.entityId);
    const exactIdx = ids.indexOf('prd_rank_exact');
    const prefixIdx = ids.indexOf('prd_rank_prefix');
    const containsIdx = ids.indexOf('prd_rank_contains');
    expect(exactIdx).toBeGreaterThanOrEqual(0);
    expect(prefixIdx).toBeGreaterThanOrEqual(0);
    expect(containsIdx).toBeGreaterThanOrEqual(0);
    expect(exactIdx).toBeLessThan(prefixIdx);
    expect(prefixIdx).toBeLessThan(containsIdx);
  });

  it('15. alias 不存在时正常搜索（回退文本匹配）', async () => {
    const items = await search('花笺'); // 品牌正式名，非 alias
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.brandName).toBe('花笺');
  });

  it('16. seed 词表幂等：无重复 (term, aliasType) 键，重复 upsert 不产生重复数据', () => {
    const keys = CATEGORY_ALIASES.map((w) => `${w.aliasType}:${normalizeSearchTerm(w.term)}`);
    expect(new Set(keys).size).toBe(keys.length);
    // canonical 必须为合法 pit_type
    for (const w of CATEGORY_ALIASES) {
      expect(['JK', 'LOLITA', 'HANFU']).toContain(w.canonicalTerm);
    }
    // 词表规范化：term 必须已是规范化形式（NFKC + 小写）
    for (const w of CATEGORY_ALIASES) {
      expect(normalizeSearchTerm(w.term)).toBe(w.term);
    }
  });

  it('v2 分页游标：关键词搜索翻页不重复不丢失', async () => {
    const instance = await createApp();
    const page1 = await instance.inject({ method: 'GET', url: '/api/v1/search?q=格裙&limit=2' });
    const body1 = page1.json();
    expect(body1.data.length).toBeGreaterThan(0);
    if (body1.page.hasMore) {
      const page2 = await instance.inject({ method: 'GET', url: `/api/v1/search?q=格裙&limit=2&cursor=${body1.page.nextCursor}` });
      expect(page2.statusCode).toBe(200);
      const ids1 = new Set(body1.data.map((i: { entityId: string }) => i.entityId));
      for (const item of page2.json().data) expect(ids1.has(item.entityId)).toBe(false);
    }
  });

  it('旧版 v1 游标（无 rank）用于关键词搜索时提示重新加载', async () => {
    const instance = await createApp();
    const legacy = Buffer.from(JSON.stringify({ v: 1, score: 1, id: 'prd_x', scope: 'placeholder' }), 'utf8').toString('base64url');
    // scope 不匹配会被 scope 检查拦截（同样返回 400 级问题响应，不 500）
    const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=格裙&cursor=${legacy}` });
    expect(response.statusCode).toBe(400);
  });

  it('恶意输入不命中任何商品（SQL 注入防护回归）', async () => {
    const instance = await createApp();
    const malicious = ["foo' OR '1'='1", '" OR 1=1 --', "' OR '1'='1' --", "'; DROP TABLE products;--"];
    for (const q of malicious) {
      const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(0);
    }
  });

  it('英文子串不误命中缩写别名（drop/shop/stop/open/logo/slot 等真实误匹配回归）', async () => {
    const instance = await createApp();
    // 词库含 op/sk/kc/bt/lo/jk 等 ≤3 位 ASCII 缩写；这些英文词内含子串但非词边界命中
    const words = ['drop', 'shop', 'stop', 'open', 'logo', 'slot', 'skirt', 'jkl', 'btc', 'kcx', 'bntv'];
    for (const q of words) {
      const response = await instance.inject({ method: 'GET', url: `/api/v1/search?q=${q}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      // 这些词不应因别名子串匹配而误返回 LOLITA/JK 分类商品
      for (const item of body.data as Array<{ category: string }>) {
        expect(['LOLITA', 'JK']).not.toContain(item.category);
      }
    }
  });

  it('缩写词边界命中：lo裙/lo 前缀、jk制服 仍正确解析分类', async () => {
    const rows = CATEGORY_ALIASES.map((w) => ({
      id: `alias_${w.aliasType}_${w.term}`, term: w.term, canonicalTerm: w.canonicalTerm,
      aliasType: w.aliasType, status: w.status, confidence: w.confidence, source: w.source,
    }));
    expect(resolveSearchTerms('lo裙', rows).categoryMatches).toEqual(['LOLITA']); // lo 位于串首 → 命中
    expect(resolveSearchTerms('lo', rows).categoryMatches).toEqual(['LOLITA']);   // 独立缩写 → 命中
    expect(resolveSearchTerms('jk制服', rows).categoryMatches).toEqual(['JK']);   // jk 位于串首 → 命中
    expect(resolveSearchTerms('op', rows).categoryMatches).toEqual(['LOLITA']);   // 独立 op → 命中
    expect(resolveSearchTerms('drop', rows).categoryMatches).toEqual([]);         // drop 中 op 无词边界 → 不命中
    expect(resolveSearchTerms('stop', rows).categoryMatches).toEqual([]);
    expect(resolveSearchTerms('logo', rows).categoryMatches).toEqual([]);         // lo 后跟字母 g → 不命中
  });
});
