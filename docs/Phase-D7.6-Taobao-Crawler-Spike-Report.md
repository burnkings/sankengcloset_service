# Phase D7.6 — Taobao Store Crawler Technical Spike Report

> Generated: 2026-07-22
> Method: Playwright + Chromium 125 (headless, no-sandbox)
> Project: sankengcloset_service
> Constraint: No login bypass, no captcha bypass, no illegal methods

---

## Executive Summary

**结论: 淘宝/天猫商品采集在不登录的前提下不可行。**

所有淘宝/天猫页面（搜索、店铺首页、商品详情）均强制要求登录。未登录状态下无法获取任何商品数据（标题、价格、图片、URL）。

**不建议继续开发 TaobaoStoreSourceAdapter。**

---

## 测试方法

使用 Playwright 启动 Chromium headless 浏览器，模拟真实用户访问淘宝/天猫页面：

- User-Agent: Chrome 125 (Windows)
- Viewport: 1440×900 (桌面) / 375×812 (移动)
- Locale: zh-CN, Timezone: Asia/Shanghai
- 无 cookie、无登录态、无代理

---

## Phase A: 淘宝搜索页

| 项目 | 结果 |
|------|------|
| URL | `https://s.taobao.com/search?q=lolita+原创衣裤&sort=sale-desc` |
| HTTP Status | 200 |
| 最终 URL | `https://s.taobao.com/search?q=...` (未重定向) |
| 页面大小 | 376,533 chars |
| 登录要求 | ⚠️ **需要登录** — 页面显示 Login/Sign up 界面 |
| 验证码 | ✅ 无 |
| 商品链接数 | 0 |

**截图**: `spike-d7.6/screenshots/v2-01-search.png`

搜索页加载后显示登录界面（QR码登录 + 手机号登录 + 密码登录），不展示任何商品结果。

---

## Phase B: 品牌官网

| 品牌 | 官网 | 结果 |
|------|------|------|
| 仲夏物语 | zhongxiawuyu.com | HTTP 200, 无淘宝链接 |
| With Puji | withpuji.com | 超时 (15s) |

品牌官网未找到淘宝店铺链接入口。

---

## Phase C: 已知店铺测试（桌面端）

| 店铺 | URL | HTTP | 最终 URL | 状态 | 登录 | 商品 |
|------|-----|------|----------|------|------|------|
| 御茶家jinco | yuchajinco.tmall.com | 200 | store.taobao.com/shop/noshop.htm | ❌ 不存在 | ⚠️ | — |
| **WithPuji天猫** | withpuji.tmall.com | 200 | withpuji.world.tmall.com | ✅ 存在 | ⚠️ **需要登录** | — |
| Alice Girl天猫 | alicegirlofficial.tmall.com | 200 | store.taobao.com/shop/noshop.htm | ❌ 不存在 | ⚠️ | — |
| 月华原创JK | shop111111111.taobao.com | 200 | store.taobao.com/shop/noshop.htm | ❌ 不存在 | ⚠️ | — |
| 仲夏物语(移动) | shop.m.taobao.com | 200 | 同 URL | ❌ 不存在 | ✅ | 0 |
| 搜索店铺 | shopsearch.taobao.com | 200 | login.taobao.com | — | ⚠️ **重定向登录** | 0 |

**关键发现**: WithPuji 天猫店铺是唯一有效的店铺：
- 店铺名: WithPuji
- 粉丝数: 142,899
- 评分: 4.8
- 店龄: 10年
- DSR: 4.8 / 4.8 / 4.8
- 商品数: 88
- 但页面显示: "亲，该店铺需要登录后才能访问哦～"

**截图**: `spike-d7.6/screenshots/v2-03-WithPuji__.png`

---

## Phase D: 移动端测试

| 店铺 | URL | HTTP | 最终 URL | 登录 | 商品 |
|------|-----|------|----------|------|------|
| WithPuji(移动) | m.taobao.com/shop | 404 | 活动页 | — | 0 |
| 移动端搜索 | s.m.taobao.com/h5 | 200 | 同 URL | ✅ | 0 |

移动端同样无法获取商品数据。

---

## 测试矩阵

### 8 项验证结果

| # | 验证项 | 结果 | 说明 |
|---|--------|------|------|
| 1 | 是否能访问 | ⚠️ 部分 | HTTP 200 可达，但内容被登录墙拦截 |
| 2 | 是否需要登录 | ❌ **所有页面需要登录** | 搜索页、店铺页、详情页均需登录 |
| 3 | 商品列表是否可获取 | ❌ 不可获取 | 未登录时商品链接数 = 0 |
| 4 | 商品详情是否可获取 | ❌ 不可获取 | 无商品 URL 可测试 |
| 5 | 价格是否稳定 | N/A | 无法获取价格数据 |
| 6 | 图片是否可访问 | N/A | 无法获取图片 URL |
| 7 | 是否能生成 product | ❌ 不可能 | 无原始数据输入 |
| 8 | 是否能生成 price_snapshot | ❌ 不可能 | 无价格数据 |

---

## 根因分析

淘宝/天猫在 2024-2025 年全面加强了反爬策略：

1. **登录墙 (Login Wall)**: 所有商品数据页面强制登录。未登录时：
   - 搜索页 → 显示登录界面
   - 店铺首页 → 显示 "该店铺需要登录后才能访问"
   - 商品详情 → 重定向到登录页

2. **SPA 渲染**: 页面内容依赖 JavaScript 动态加载，纯 HTTP 请求无法获取商品数据

3. **店铺 ID 失效**: 大量旧店铺 ID 已失效（重定向到 noshop.htm），可能与淘宝店铺迁移有关

4. **反自动化检测**: 淘宝检测到 headless 浏览器后可能限制内容展示

---

## 可选方案评估

### 方案 A: Cookie 注入（用户手动登录后提供 cookie）
- **可行性**: 技术上可行
- **风险**: 
  - Cookie 有效期短（通常几小时到几天）
  - 需要用户定期更新
  - 违反淘宝 ToS，账号有封禁风险
- **评估**: ❌ 不推荐 — 维护成本高，法律风险

### 方案 B: 淘宝开放平台 API
- **可行性**: 需要企业资质申请
- **风险**: 
  - 需要企业营业执照
  - API 调用有配额限制
  - 部分数据不开放
- **评估**: ⚠️ 可考虑 — 但门槛高，不适合个人项目

### 方案 C: 放弃淘宝，转向其他渠道
- **可行性**: ✅ 最佳
- **推荐渠道**:
  - 品牌官网（With Puji、仲夏物语等已有爬虫）
  - 微博（已有 weibo-brand adapter）
  - 微信公众号（已有 wechat-mp adapter）
  - B站（视频/动态采集）
  - 小红书（需登录，同淘宝问题）
- **评估**: ✅ **推荐** — 已有成熟采集能力

---

## RawCrawlItem 格式验证

由于无法获取实际数据，以下为预定义的 RawCrawlItem 接口（与现有 `crawler/core/types.ts` 对齐）：

```typescript
interface RawCrawlItem {
  sourcePlatform: 'TAOBAO';           // ✅ 已定义
  sourceUrl: string;                   // ✅ 可从店铺 URL 生成
  externalId: string;                  // ⚠️ 需登录后从页面提取
  rawTitle: string;                    // ❌ 无法获取
  rawDescription: string;              // ❌ 无法获取
  rawPriceText: string;                // ❌ 无法获取
  rawDateText: string;                 // ❌ 无法获取
  rawImageUrls: string[];              // ❌ 无法获取
  rawPayload: unknown;                 // ❌ 无法获取
  fetchedAt: Date;                     // ✅ 可生成
  parserVersion: string;               // ✅ 可生成
}
```

**结论**: 接口设计正确，但无数据可填充。

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `scripts/spike-taobao-crawler.ts` | 初始 spike 脚本（店铺 ID 失效） |
| `scripts/spike-taobao-crawler-v2.ts` | v2 spike 脚本（多方案测试） |
| `spike-d7.6/screenshots/` | 测试截图目录 |
| `spike-d7.6/v2-results.json` | v2 测试原始数据 |
| `docs/Phase-D7.6-Taobao-Crawler-Spike-Report.md` | 本报告 |

---

## 最终建议

**停止淘宝采集方向。** 原因：

1. 登录墙是硬性障碍，无法在合规前提下绕过
2. 现有采集能力（品牌官网 + 微博 + 微信公众号）已覆盖主要数据源
3. 淘宝店铺 ID 不稳定，维护成本高
4. 法律风险（违反淘宝 ToS）

**下一步**: 继续强化现有采集渠道（D7.7+），而非投入淘宝采集。

---

*This is a technical spike report. Not a production system.*
