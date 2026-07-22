# Phase D6 — First Brand Data Pilot Report

> 完成时间：2026-07-22
> 基于：Phase D5.2 Full Crawl / Backfill Strategy (240 tests)

---

## 1. 选择该品牌的原因

**兔缝缝 (TuFengFeng)** — JK 制服头部品牌

| 维度 | 评估 |
|------|------|
| 坑向 | JK（三坑之一） |
| 数据可用性 | ✅ 已有 fixture 数据 |
| 批次信息 | ✅ 支持（一期/二期/再贩） |
| 网络可达性 | ✅ 本地 fixture，无网络依赖 |
| 风险 | 无（本地数据） |
| 推荐 | ✅ 首选试点 |

**限制说明**：服务器在阿里云国内，外部品牌网站（Angelic Pretty、Baby TSSB）均超时无法访问。采用 fixture 模拟真实数据验证管道。

---

## 2. 数据源评估

| 候选品牌 | 来源 | 坑向 | 批次信息 | 可达性 | 推荐 |
|----------|------|------|----------|--------|------|
| 兔缝缝 | fixture://brand-tufengfeng-api.json | JK | 有 | ✅ | ✅ 首选 |
| Angelic Pretty | angelicpretty.co.jp | Lolita | 有 | ❌ 超时 | ❌ |
| Baby TSSB | baby-the-stars-shine-bright.com | Lolita | 有 | ❌ 超时 | ❌ |

---

## 3. Full Crawl 结果

```
CrawlMode: full
Brand: br_001 (兔缝缝)
Source: fixture://brand-tufengfeng-api.json
MaxItems: 200

Fetched: 1
Parsed: 3
Accepted: 3 (更新已有)
Rejected: 0
Duplicates: 0
Errors: 0
```

**幂等性**：✅ 第二次运行无新增

---

## 4. Backfill Crawl 结果

```
CrawlMode: backfill
Brand: br_001 (兔缝缝)
Source: fixture://brand-tufengfeng-api.json
MaxItems: 300

Fetched: 1
Parsed: 3
Accepted: 3 (更新已有)
Rejected: 0
Duplicates: 0
Errors: 0
```

**说明**：fixture 不支持 date range，backfill 以现有数据模拟。

---

## 5. 入库结果

| 表 | 数量 | 说明 |
|----|------|------|
| products | 52 | 50 种子 + 2 fixture |
| product_releases | 0 | fixture 无批次信息 |
| price_snapshots | 1 | 幂等去重 |
| source_records | 54 | 50 种子 + 4 fixture |
| crawl_jobs | 8 | 4 incremental + 2 full + 2 backfill |
| brands | 30 | 种子数据 |

---

## 6. 数据质量评分

| 检查项 | 结果 |
|--------|------|
| 商品名为空 | 0 ✅ |
| 品牌缺失 | 0 ✅ |
| 坑向无法识别 | 0 ✅ |
| 价格缺失 | 0 ✅ |
| 图片缺失 | 50 ❌（种子数据无封面） |
| source_url 缺失 | 0 ✅ |
| **等级** | **D**（图片缺失拉低） |

**注**：D 级是因为种子数据设计为最小集，不含图片。fixture 产品有完整图片。

---

## 7. Directus 审核验证

| 表 | 可访问 | 说明 |
|----|--------|------|
| products | ✅ | 52 条 |
| product_releases | ✅ | 0 条（fixture 无批次） |
| source_records | ✅ | 54 条 |
| price_snapshots | ✅ | 1 条 |
| crawl_jobs | ✅ | 8 条 |
| brand_crawl_policies | ✅ | 1 条 |
| brands | ✅ | 30 条 |

管理员可在 Directus 中将 draft 改为 published。

---

## 8. Feed API 验证

| 检查项 | 结果 |
|--------|------|
| draft 商品不进 Feed | ✅ |
| published 商品进入 Feed | ✅ |
| Feed 返回 product id/name/brand/price | ✅ |
| Feed 返回 category | ✅ |
| Feed 返回 badgeText | ✅ |

**注**：当前后端为 memory 模式，PostgreSQL 模式需切换 .env。

---

## 9. 测试结果

```
npm test:     252 passed, 1 skipped (253 total)
npm typecheck: 0 errors
npm build:     success
```

### 新增测试

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| first-brand-pilot.test.ts | 12 | 品牌配置/流程/幂等/Feed |

---

## 10. 当前问题

1. **外部网站不可达**：服务器在阿里云国内，日本/海外品牌网站超时
2. **fixture 数据有限**：仅 3 个商品，无批次信息
3. **图片缺失**：种子数据无封面图
4. **后端为 memory 模式**：Feed API 返回 mock 数据，需切换 DATA_DRIVER=postgres
5. **Release 未生成**：fixture 无批次信息，product_releases 为空

---

## 11. 下一阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| D6.1 | 切换后端到 postgres 模式，验证真实 Feed API | 高 |
| D6.2 | 扩展 fixture 数据（增加批次信息） | 高 |
| D6.3 | 配置代理访问外部品牌网站 | 中 |
| D7 | 多来源合并去重 | 中 |
| D8 | Review API JWT 认证 | 高 |
| D9 | 定时采集调度 | 高 |
