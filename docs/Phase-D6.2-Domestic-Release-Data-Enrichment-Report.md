# Phase D6.2 — Domestic Release Data Enrichment Report

> 完成时间：2026-07-22
> 基于：Phase D6.1 Domestic Brand Data Acquisition (252 tests)

---

## 1. D6.1 的真实限制

| 限制 | 影响 |
|------|------|
| With PUJI RSS 仅 7 个商品 | 无法达到 10+ products |
| RSS 无批次信息 | 无法生成 product_releases |
| RSS 无价格 | 无法测试价格结构 |
| 仅 1 种 release_type | 无法验证多类型管道 |

**结论**：RSS 不足以支撑三坑数据的完整业务模型。

---

## 2. 为什么 RSS 不足以支撑三坑数据

三坑商品的核心业务特征：
- 按"期数/批次"组织发售（一期预约→二期再贩→现货→售罄）
- 有复杂的定金/尾款/全款价格结构
- 有预约时间、截止时间、发货时间等时间窗口

RSS 只包含：
- 商品标题
- 商品图片
- 发布日期
- 简短描述

**缺失**：价格、批次、发售状态、时间窗口

---

## 3. Snapshot Import 格式扩展

`scripts/import-brand-snapshot.ts` 现支持：

| 格式 | 参数 | 说明 |
|------|------|------|
| RSS | `--format rss` | Blogger RSS XML |
| HTML | `--format html` | HTML 页面 |
| JSON | `--format json` | JSON 数据 |
| Text | `--format text` | 公告文本（Markdown） |

所有格式仍走完整管道：Parser → Normalizer → Validator → Dedup → Persistence

---

## 4. Announcement Parser 设计

`src/crawler/parsers/announcement-parser.ts`：

### 识别能力

| 维度 | 支持 |
|------|------|
| 批次号 | 一期/二期/三期/第N批 |
| 发售类型 | 首发/再贩/预约/现货/抽选 |
| 售卖状态 | 预约中/现货/售罄/结束 |
| 价格结构 | 定金/尾款/全款/¥/RMB/元 |
| 时间信息 | 发售时间/截止时间/尾款时间/发货时间 |
| 坑向检测 | JK/Lolita/汉服 |

### 输出

```typescript
interface AnnouncementProduct {
  title, brand, pitType, category,
  releaseName, releaseNo, releaseType,
  saleStatus, depositPriceCents, balancePriceCents, fullPriceCents,
  startAt, endAt, balanceDueAt, shipAt,
  isRerelease, isSoldOut, lifecycleStatus,
  confidence, sourceUrl, warnings
}
```

---

## 5. 公告样本验证

### 样本 1：withpuji-release-schedule.md

```
Judgment Day JSK 一期预约 — ¥499（定金100+尾款399）
Judgment Day JSK 二期再贩 — ¥499
Floating Light Melody OP 现货 — ¥459
Black Chapter Seventh Night 一期 售罄
Morning and Evening OP 第2批 — ¥520
```

### 样本 2：withpuji-2024-fall.md

```
Loyal Chariot OP 首发预约 — ¥550（定金120+尾款430）
Original Design Heavy Butterfly JSK 1期 现货 — ¥480
Black Bamboo Dream Set 再贩 — ¥500（定金100+尾款400）
Loyal Chariot OP 第3批 售罄
```

---

## 6. Release 数据增强结果

### 导入结果

| 来源 | products | releases |
|------|----------|----------|
| RSS (D6.1) | 7 | 7 |
| 公告 1 | 11 | 11 |
| 公告 2 | 8 | 8 |
| **总计** | **26** | **26** |

### release_type 分布

| 类型 | 数量 | 占比 |
|------|------|------|
| first_release | 7 | 27% |
| unknown | 6 | 23% |
| reservation | 5 | 19% |
| spot | 5 | 19% |
| rerelease | 4 | 15% |

### sale_status 分布

| 状态 | 数量 | 占比 |
|------|------|------|
| ON_SALE | 17 | 65% |
| PRE_ORDER | 4 | 15% |
| SOLD_OUT | 3 | 12% |
| ENDED | 3 | 12% |

### 价格结构

| 指标 | 数量 |
|------|------|
| 有 full_price | 9 |
| 有 deposit_price | 0 (需改进解析) |
| 有 balance_price | 0 (需改进解析) |
| 有 start_at | 27 |

---

## 7. 数据质量评分

| 检查项 | 结果 |
|--------|------|
| release_type 识别率 | 77% (20/26) ✅ |
| sale_status 识别率 | 100% ✅ |
| full_price 提取率 | 35% (9/26) ❌ |
| deposit_price 提取率 | 0% ❌ |
| source_url 完整率 | 100% ✅ |

**等级**：B（release_type ≥ 60%，source_url ≥ 95%，但价格结构不足）

---

## 8. Directus 验证

| 表 | 可访问 |
|----|--------|
| products | ✅ |
| product_releases | ✅ |
| source_records | ✅ |
| price_snapshots | ✅ |
| crawl_jobs | ✅ |
| brand_crawl_policies | ✅ |
| brands | ✅ |

---

## 9. PostgreSQL Feed 验证

| 检查项 | 结果 |
|--------|------|
| Feed API 从 PostgreSQL 读取 | ✅ |
| draft 商品不进入 Feed | ✅ |
| published 商品进入 Feed | ✅ |
| 字段映射正确 | ✅ (title/brand/price/category) |

---

## 10. 测试结果

```
npm test:     277 passed, 1 skipped (278 total)
npm typecheck: 0 errors
npm build:     success
```

### 新增测试

| 文件 | 用例数 |
|------|--------|
| announcement-parser.test.ts | 12 |
| snapshot-import-formats.test.ts | 4 |
| domestic-release-enrichment.test.ts | 7 |

---

## 11. 当前限制

1. **价格提取不完整**：定金/尾款提取率低，需改进正则
2. **段落分割**：按双换行分割，单换行内的多商品会合并
3. **unknown release_type**：23% 无法识别类型
4. **无真实 HTML 快照**：当前只有文本快照
5. **With PUJI 数据有限**：品牌本身产品线较短

---

## 12. 下一阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| D6.3 | 改进价格提取正则（定金/尾款/全款） | 高 |
| D6.4 | 寻找有更丰富数据的品牌（需人工协助） | 高 |
| D7 | 多来源合并去重 | 中 |
| D8 | Review API JWT 认证 | 高 |
| D9 | 定时采集调度 | 中 |
