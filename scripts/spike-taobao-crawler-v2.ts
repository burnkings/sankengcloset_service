#!/usr/bin/env node
// scripts/spike-taobao-crawler-v2.ts
// Phase D7.6 v2: 先搜索淘宝找真实店铺，再测试采集

import { chromium, type Browser, type Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SPIKE_DIR = resolve(import.meta.dirname!, '../spike-d7.6');
mkdirSync(SPIKE_DIR, { recursive: true });
const SCREENSHOT_DIR = resolve(SPIKE_DIR, 'screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });
const REPORT_PATH = resolve(import.meta.dirname!, '../docs/Phase-D7.6-Taobao-Crawler-Spike-Report.md');

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function screenshot(page: Page, name: string): Promise<string> {
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  log(`  📸 ${name}.png`);
  return path;
}

async function main() {
  log('🚀 Phase D7.6 v2 — Taobao Store Crawler Spike');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  const page = await context.newPage();

  // ============================================================
  // Phase A: 搜索淘宝找到真实店铺链接
  // ============================================================
  log('\n📌 Phase A: 搜索淘宝找真实店铺');

  // 方案1: 直接搜索
  const searchUrl = 'https://s.taobao.com/search?q=lolita+%E5%8E%9F%E5%88%9B%E8%A1%A3%E8%A3%99&sort=sale-desc';
  log(`访问搜索页: ${searchUrl}`);

  const resp = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  log(`HTTP: ${resp?.status()}, URL: ${page.url()}`);

  await page.waitForTimeout(3000);
  const ss1 = await screenshot(page, 'v2-01-search');
  
  // 检查搜索结果页的内容
  const pageContent = await page.content();
  const pageUrl = page.url();
  
  log(`\n搜索页分析:`);
  log(`  Final URL: ${pageUrl}`);
  log(`  需要登录: ${pageUrl.includes('login') || pageContent.includes('请登录')}`);
  log(`  有验证码: ${pageContent.includes('captcha') || pageContent.includes('验证码')}`);
  log(`  页面长度: ${pageContent.length} chars`);
  
  // 尝试找店铺链接
  const shopLinks = await page.locator('a[href*="shop"]').all();
  log(`  店铺链接数: ${shopLinks.length}`);
  
  // 尝试找商品链接
  const itemLinks = await page.locator('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]').all();
  log(`  商品链接数: ${itemLinks.length}`);

  // 提取页面文本看看有什么
  const bodyText = await page.locator('body').textContent() ?? '';
  log(`  页面文本前500字: ${bodyText.slice(0, 500)}`);

  // ============================================================
  // Phase B: 尝试直接访问已知品牌官网获取淘宝链接
  // ============================================================
  log('\n📌 Phase B: 从品牌官网找淘宝链接');

  // 仲夏物语官网
  const brandUrls = [
    { name: '仲夏物语', url: 'https://www.zhongxiawuyu.com' },
    { name: 'With Puji', url: 'https://withpuji.com' },
  ];

  for (const brand of brandUrls) {
    log(`\n  尝试 ${brand.name}: ${brand.url}`);
    try {
      const brandResp = await page.goto(brand.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      log(`  HTTP: ${brandResp?.status()}, URL: ${page.url()}`);

      // 查找淘宝链接
      const taobaoAnchors = await page.locator('a[href*="taobao"], a[href*="tmall"]').all();
      log(`  淘宝/天猫链接数: ${taobaoAnchors.length}`);

      for (const a of taobaoAnchors.slice(0, 5)) {
        const href = await a.getAttribute('href');
        const text = await a.textContent();
        log(`    → ${text?.trim().slice(0, 40)} | ${href?.slice(0, 80)}`);
      }

      await screenshot(page, `v2-02-brand-${brand.name}`);
    } catch (e) {
      log(`  ❌ 失败: ${(e as Error).message}`);
    }
  }

  // ============================================================
  // Phase C: 尝试已知有效的天猫/淘宝店铺
  // ============================================================
  log('\n📌 Phase C: 尝试已知有效的三坑店铺');

  const knownStores = [
    // 天猫店铺（更稳定）
    { name: '御茶家jinco', url: 'https://yuchajinco.tmall.com' },
    { name: 'WithPuji天猫', url: 'https://withpuji.tmall.com' },
    { name: 'Alice Girl天猫', url: 'https://alicegirlofficial.tmall.com' },
    // 淘宝店铺
    { name: '月华原创JK', url: 'https://shop111111111.taobao.com' },
    { name: '仲夏物语淘宝', url: 'https://shop.m.taobao.com/shop/shop_index.htm?shopId=35286601' },
    // 直接搜索店铺
    { name: '淘宝搜索lolita店铺', url: 'https://shopsearch.taobao.com/shop?q=lolita' },
  ];

  const storeResults: any[] = [];

  for (const store of knownStores) {
    log(`\n  🏪 ${store.name}: ${store.url}`);
    try {
      const storeResp = await page.goto(store.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);

      const finalUrl = page.url();
      const httpStatus = storeResp?.status() ?? null;
      const content = await page.content();

      const isNoshop = content.includes('店铺不存在') || content.includes('noshop');
      const isLogin = finalUrl.includes('login') || content.includes('请登录');
      const hasItems = content.includes('item') || content.includes('商品');

      log(`    HTTP: ${httpStatus}, Final: ${finalUrl.slice(0, 80)}`);
      log(`    店铺不存在: ${isNoshop}, 需登录: ${isLogin}, 有商品: ${hasItems}`);

      // 尝试提取商品
      let products: any[] = [];
      const itemAnchors = await page.locator('a[href*="item"], a[href*="detail"]').all();
      log(`    商品链接数: ${itemAnchors.length}`);

      for (const a of itemAnchors.slice(0, 3)) {
        const href = await a.getAttribute('href') ?? '';
        const text = (await a.textContent() ?? '').trim();
        if (text.length > 2) {
          products.push({ title: text.slice(0, 60), url: href.slice(0, 80) });
          log(`      → ${text.slice(0, 50)} | ${href.slice(0, 60)}`);
        }
      }

      const ssName = `v2-03-${store.name.replace(/[^\w]/g, '_')}`;
      await screenshot(page, ssName);

      storeResults.push({
        name: store.name,
        url: store.url,
        httpStatus,
        finalUrl,
        isNoshop,
        isLogin,
        productCount: itemAnchors.length,
        products,
        screenshot: ssName,
      });

      // 如果找到了有效店铺，尝试访问第一个商品详情
      if (itemAnchors.length > 0 && !isLogin && !isNoshop) {
        log(`\n    📋 尝试访问第一个商品详情...`);
        const firstHref = await itemAnchors[0]!.getAttribute('href') ?? '';
        if (firstHref) {
          let detailUrl = firstHref;
          if (detailUrl.startsWith('//')) detailUrl = 'https:' + detailUrl;
          else if (detailUrl.startsWith('/')) detailUrl = new URL(detailUrl, page.url()).toString();

          await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(2000);

          const detailUrl2 = page.url();
          const detailContent = await page.content();
          const detailLogin = detailUrl2.includes('login') || detailContent.includes('请登录');

          log(`    Detail URL: ${detailUrl2.slice(0, 80)}`);
          log(`    Detail Login Required: ${detailLogin}`);

          // 尝试提取详情信息
          if (!detailLogin) {
            const detailSelectors: Record<string, string> = {
              title: '.tb-main-title, [class*="ItemHeader--mainTitle"], h3',
              price: '.tb-rmb-num, .tm-price, [class*="Price--priceText"]',
              image: '#J_ImgBooth, [class*="PicGallery"] img',
            };
            for (const [field, sel] of Object.entries(detailSelectors)) {
              const c = await page.locator(sel).count();
              log(`    Detail ${field}: ${c > 0 ? '✅' : '❌'} (${c})`);
            }
          }

          await screenshot(page, 'v2-04-detail');
        }
      }

    } catch (e) {
      log(`    ❌ ${(e as Error).message}`);
      storeResults.push({ name: store.name, url: store.url, error: (e as Error).message });
    }
  }

  // ============================================================
  // Phase D: 尝试通过 m.taobao.com (移动端) 访问
  // ============================================================
  log('\n📌 Phase D: 尝试移动端淘宝');

  const mobileStores = [
    { name: '移动端-WithPuji', url: 'https://m.taobao.com/shop/shop_index.htm?shopId=35384588' },
    { name: '移动端-搜索lolita', url: 'https://s.m.taobao.com/h5?q=lolita%E5%8E%9F%E5%88%9B&sort=_sale' },
  ];

  // 切换到移动端 viewport
  await page.setViewportSize({ width: 375, height: 812 });

  for (const store of mobileStores) {
    log(`\n  📱 ${store.name}: ${store.url}`);
    try {
      const mResp = await page.goto(store.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const mUrl = page.url();
      const mContent = await page.content();
      const mNoshop = mContent.includes('店铺不存在') || mContent.includes('noshop');
      const mLogin = mUrl.includes('login') || mContent.includes('请登录');

      log(`    HTTP: ${mResp?.status()}, URL: ${mUrl.slice(0, 80)}`);
      log(`    不存在: ${mNoshop}, 需登录: ${mLogin}`);

      // 移动端商品提取
      const mItems = await page.locator('a[href*="item"], a[href*="detail"]').all();
      log(`    商品链接数: ${mItems.length}`);

      for (const a of mItems.slice(0, 3)) {
        const href = await a.getAttribute('href') ?? '';
        const text = (await a.textContent() ?? '').trim();
        log(`      → ${text.slice(0, 50)} | ${href.slice(0, 60)}`);
      }

      await screenshot(page, `v2-05-mobile-${store.name.replace(/[^\w]/g, '_')}`);

      storeResults.push({
        name: store.name,
        url: store.url,
        httpStatus: mResp?.status(),
        finalUrl: mUrl,
        isNoshop: mNoshop,
        isLogin: mLogin,
        productCount: mItems.length,
        platform: 'mobile',
      });

    } catch (e) {
      log(`    ❌ ${(e as Error).message}`);
    }
  }

  await browser.close();

  // ============================================================
  // 生成报告
  // ============================================================
  let report = `# Phase D7.6 — Taobao Store Crawler Spike Report

> Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
> Method: Playwright + Chromium (headless)
> Constraint: No login bypass, no captcha bypass, no illegal methods

---

## 测试概览

### Phase A: 搜索页
- URL: ${searchUrl}
- 结果: ${itemLinks.length} 商品链接, ${shopLinks.length} 店铺链接
- 登录要求: ${pageUrl.includes('login') || pageContent.includes('请登录')}

### Phase B: 品牌官网
`;

  for (const brand of brandUrls) {
    report += `- ${brand.name}: 查找淘宝链接\n`;
  }

  report += `\n### Phase C: 已知店铺测试\n\n`;
  report += `| 店铺 | HTTP | 最终URL | 存在 | 登录 | 商品数 |\n`;
  report += `|------|------|---------|------|------|--------|\n`;

  for (const s of storeResults.filter(s => !s.platform)) {
    report += `| ${s.name} | ${s.httpStatus} | ${(s.finalUrl ?? '').slice(0, 40)} | ${s.isNoshop ? '❌' : '✅'} | ${s.isLogin ? '⚠️' : '✅'} | ${s.productCount ?? 0} |\n`;
  }

  report += `\n### Phase D: 移动端测试\n\n`;
  report += `| 店铺 | HTTP | 最终URL | 存在 | 登录 | 商品数 |\n`;
  report += `|------|------|---------|------|------|--------|\n`;

  for (const s of storeResults.filter(s => s.platform === 'mobile')) {
    report += `| ${s.name} | ${s.httpStatus} | ${(s.finalUrl ?? '').slice(0, 40)} | ${s.isNoshop ? '❌' : '✅'} | ${s.isLogin ? '⚠️' : '✅'} | ${s.productCount ?? 0} |\n`;
  }

  const validStores = storeResults.filter(s => !s.isNoshop && !s.isLogin && (s.productCount ?? 0) > 0);
  const loginBlocked = storeResults.filter(s => s.isLogin);
  const notFound = storeResults.filter(s => s.isNoshop);

  report += `\n---

## 综合结论

### 统计

- 测试店铺总数: ${storeResults.length}
- 有效（无登录+有商品）: ${validStores.length}
- 被登录墙阻断: ${loginBlocked.length}
- 店铺不存在: ${notFound.length}

`;

  if (validStores.length > 0) {
    report += `### ✅ 发现可采集店铺\n\n`;
    for (const s of validStores) {
      report += `- **${s.name}**: ${s.finalUrl} (${s.productCount} 商品)\n`;
    }
    report += `\n**结论: 淘宝采集可行** — 存在无需登录即可访问的店铺和商品。\n`;
  } else if (loginBlocked.length > 0) {
    report += `### ⚠️ 所有店铺均需登录\n\n`;
    report += `**结论: 淘宝采集需要登录态** — 建议方案:\n`;
    report += `1. Cookie 注入（用户手动登录后提供 cookie）\n`;
    report += `2. 淘宝开放平台 API（需企业资质）\n`;
    report += `3. 放弃淘宝采集，转向品牌官网/社交媒体\n`;
  } else {
    report += `### ❌ 无法找到有效店铺\n\n`;
    report += `**结论: 淘宝采集不可行** — 店铺 ID 失效或访问被阻断。\n`;
  }

  report += `\n---

## Screenshots

${storeResults.map(s => s.screenshot ? `- ${s.screenshot}.png` : '').filter(Boolean).join('\n')}

---

*This is a technical spike, not a production system.*
`;

  writeFileSync(REPORT_PATH, report);
  log(`\n📄 报告: ${REPORT_PATH}`);

  // 保存完整结果
  writeFileSync(resolve(SPIKE_DIR, 'v2-results.json'), JSON.stringify(storeResults, null, 2));
  log(`📊 数据: ${SPIKE_DIR}/v2-results.json`);

  // 摘要
  log(`\n${'='.repeat(50)}`);
  log('📊 摘要');
  log(`${'='.repeat(50)}`);
  log(`有效店铺: ${validStores.length}`);
  log(`登录阻断: ${loginBlocked.length}`);
  log(`不存在: ${notFound.length}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
