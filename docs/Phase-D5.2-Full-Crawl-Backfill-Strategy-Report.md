# Phase D5.2 — Full Crawl / Backfill Strategy Report

> 完成时间：2026-07-22
> 基于：Phase D5.1 Release Batch & Product Lifecycle Modeling (220 tests)

---

## 1. 为什么需要 Full/Backfill

**增量采集的局限**：
- 只能抓到当前在线的商品
- 历史批次（已售罄/下架/再贩结束）会丢失
- 三坑商品可能临时隐藏、售罄、下架、再上架

**Full Crawl**：品牌当前公开商品全量扫描，确保不遗漏在线商品。

**Backfill Crawl**：历史商品/历史批次回填，保留完整生命周期数据。

**设计原则**：
- 不删除旧商品（即使本次未出现）
- 默认 draft，不直接影响 Feed
- 硬上限防止无限抓取

---

## 2. crawl_mode 设计

### 枚举值

| 模式 | 说明 | 默认 maxItems | 硬上限 |
|------|------|--------------|--------|
| `incremental` | 日常增量抓取 | 50 | 500 |
| `full` | 品牌全量扫描 | 200 | 1000 |
| `backfill` | 历史回填 | 100 | 500 |
| `manual` | 人工触发 | 200 | 1000 |

### crawl_jobs 表变更

```sql
ALTER TABLE crawl_jobs ADD COLUMN crawl_mode crawl_mode NOT NULL DEFAULT 'incremental';
```

旧数据自动继承 `incremental` 默认值，向后兼容。

---

## 3. brand_crawl_policies 表设计

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| id | text PK | — | 策略 ID |
| brand_id | text FK | — | 关联品牌 |
| source_type | text | 'OFFICIAL' | 来源类型 |
| source_url | text | '' | 来源 URL |
| crawl_enabled | boolean | false | 是否启用采集 |
| incremental_interval_hours | integer | 24 | 增量采集间隔（小时） |
| full_interval_days | integer | 30 | 全量采集间隔（天） |
| backfill_enabled | boolean | false | 是否启用回填 |
| priority | integer | 0 | 优先级（越高越先执行） |
| last_incremental_crawled_at | timestamptz | null | 上次增量采集时间 |
| last_full_crawled_at | timestamptz | null | 上次全量采集时间 |
| last_backfill_crawled_at | timestamptz | null | 上次回填时间 |

**安全设计**：
- `crawl_enabled` 默认 false，不自动启用
- `backfill_enabled` 默认 false，不自动回填
- 需要人工确认后才开始采集

---

## 4. CrawlPolicyPlanner 逻辑

```
输入: brand_crawl_policies + 当前时间
  ↓
遍历每个 policy:
  ├── crawl_enabled = false → 跳过
  ├── incremental 到期？ → 生成 incremental plan
  ├── full 到期？ → 生成 full plan
  └── backfill_enabled + 未执行过？ → 生成 backfill plan
  ↓
按 priority 降序排序
  ↓
限制 maxPlans 数量
  ↓
输出: CrawlPlan[]
```

**Planner 只负责计划，不执行采集。**

---

## 5. Full Crawl 行为边界

| 行为 | 规则 |
|------|------|
| 限制 maxItems | ✅ 硬上限 1000 |
| 结果默认 draft | ✅ visibility_status = 'draft' |
| 不直接 published | ✅ 需人工审核 |
| 不删除旧商品 | ✅ 只记录本次看到的商品 |
| 不判定下架 | ✅ 旧商品未出现不处理 |
| 记录 release 批次 | ✅ 支持 release 信息 |

---

## 6. Backfill Crawl 行为边界

| 行为 | 规则 |
|------|------|
| 参数支持 | brand-id, date-from, date-to, keyword, series-name, max-items |
| 生成 historical release | ✅ release_type 可标记为历史 |
| 默认 draft | ✅ 不影响 published Feed |
| source_records 记录 | ✅ 必须记录来源 |
| price_snapshots 记录 | ✅ 可记录历史价格 |
| 无 date range 支持时 | 保留参数结构，后续接入 |

---

## 7. Scheduler 集成方式

```
Scheduler
  ↓
读取 brand_crawl_policies
  ↓
调用 crawl-policy-planner.buildCrawlPlans()
  ↓
遍历 CrawlPlan:
  ├── 创建 crawl_jobs (crawl_mode = plan.crawlMode)
  ├── 执行现有 crawler pipeline
  └── 更新 last_xxx_crawled_at
```

**安全措施**：
- Scheduler 可以先以 dry-run 模式验证 plans
- 不默认启动真实采集
- 每次采集后更新时间戳

---

## 8. 测试结果

```
npm test:     240 passed, 1 skipped (241 total)
npm typecheck: 0 errors
npm build:     success
```

### 新增测试

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| crawl-policy-planner.test.ts | 11 | 策略计划/优先级/限制/手动 |
| crawl-mode.integration.test.ts | 9 | 模式/硬上限/draft/Feed兼容 |

### 覆盖场景

| # | 场景 | 结果 |
|---|------|------|
| 1 | disabled policy 不生成 plan | ✅ |
| 2 | incremental 到期生成 plan | ✅ |
| 3 | incremental 未到期不生成 | ✅ |
| 4 | full 到期生成 plan | ✅ |
| 5 | backfill_enabled 生成 plan | ✅ |
| 6 | backfill 已执行过不生成 | ✅ |
| 7 | priority 高的排前面 | ✅ |
| 8 | max plan 数量限制 | ✅ |
| 9 | 首次采集生成 plan | ✅ |
| 10 | 手动计划最高优先级 | ✅ |
| 11 | 手动计划受硬上限限制 | ✅ |
| 12 | crawl_mode 枚举值正确 | ✅ |
| 13 | full crawl 默认 draft | ✅ |
| 14 | backfill 默认 draft | ✅ |
| 15 | full crawl 有硬上限 | ✅ |
| 16 | backfill 有硬上限 | ✅ |
| 17 | 硬上限阻止无限抓取 | ✅ |
| 18 | incremental maxItems 合理 | ✅ |
| 19 | full 不影响 published Feed | ✅ |
| 20 | backfill 不影响 published Feed | ✅ |

---

## 9. 新增文件

| 文件 | 说明 |
|------|------|
| `migrations/0006_crawl_strategy.sql` | crawl_mode 枚举 + brand_crawl_policies 表 |
| `src/crawler/strategy/types.ts` | CrawlMode/CrawlPolicy/CrawlPlan 类型 |
| `src/crawler/strategy/crawl-policy-planner.ts` | 策略计划器 |
| `tests/crawler/crawl-policy-planner.test.ts` | 策略计划器测试（11 用例） |
| `tests/crawler/crawl-mode.integration.test.ts` | 模式集成测试（9 用例） |

## 修改文件

| 文件 | 变更 |
|------|------|
| `scripts/crawler-brand-api.ts` | 支持 --mode/--brand-id/--max-items 参数 |

---

## 10. 当前限制

1. **Planner 未集成到 Scheduler**：当前为独立模块，需手动调用
2. **Backfill 无真实数据源**：fixture 模式不支持 date range
3. **brand_crawl_policies 无自动填充**：需手动写入策略
4. **采集脚本未写入 crawl_mode**：crawl_jobs.crawl_mode 需在 pipeline 层设置
5. **无采集监控/告警**：采集失败无通知

---

## 11. 下一阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| D5.3 | Scheduler 集成 CrawlPolicyPlanner（自动触发采集） | 高 |
| D5.4 | 采集监控/告警（失败通知） | 中 |
| D6 | 图片采集与本地存储 | 中 |
| D7 | 多来源合并去重 | 中 |
| D8 | Review API JWT 认证 | 高 |
| D9 | 定时采集调度 | 高 |
