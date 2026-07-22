# Phase D5.1 — Release Batch & Product Lifecycle Modeling Report

> 完成时间：2026-07-22
> 基于：Phase D5 Product Intelligence Layer (183 tests)

---

## 1. 为什么需要 Release Batch 模型

三坑商品（尤其 Lolita）按"期数/批次"组织发售：

```
一期预约 → 二期再贩 → 现货掉落 → 尾款阶段 → 售罄结束
```

**问题**：
- 同一商品不同期数不能用 `products.current_price` 完整表达
- 不能把已结束的商品数据删除（历史价值）
- 不能把不同期数误判为重复商品

**解决方案**：引入 `product_releases` 表，建立 Product → Release 一对多关系。

---

## 2. Product 与 Release 的关系

```
products (1) ──── (N) product_releases
     │                    │
     │                    ├── release_no (批次序号)
     │                    ├── release_type (首发/再贩/预约/现货/抽选)
     │                    ├── sale_status (UPCOMING/ON_SALE/PRE_ORDER/SOLD_OUT/ENDED)
     │                    ├── visibility_status (draft/reviewing/published/hidden)
     │                    └── lifecycle_status (upcoming/active/ended/sold_out)
     │
     └── current_price (当前展示价/最新价，保留兼容)
```

**设计原则**：
- `products.current_price` 保留，作为展示价
- `product_releases` 保存批次级完整信息
- 新旧逻辑兼容，无 release 信息的旧商品仍可运行

---

## 3. 数据库变更

### 新增表：product_releases

| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | 批次 ID |
| product_id | text FK | 关联商品 |
| release_name | text | 批次名称（如"一期预约"） |
| release_no | integer | 批次序号（0=未知） |
| release_type | release_type ENUM | first_release/rerelease/reservation/spot/lottery/unknown |
| sale_status | sale_status ENUM | 沿用现有枚举 |
| deposit_price_cents | integer | 定金（分） |
| balance_price_cents | integer | 尾款（分） |
| full_price_cents | integer | 全价（分） |
| start_at / end_at | timestamptz | 预约/开售时间窗口 |
| balance_due_at | timestamptz | 尾款截止时间 |
| ship_at | timestamptz | 预计发货时间 |
| is_rerelease | boolean | 是否再贩 |
| is_sold_out | boolean | 是否售罄 |
| visibility_status | visibility_status | draft/reviewing/published/hidden |
| lifecycle_status | text | upcoming/active/ended/sold_out |

### 修改表：price_snapshots

| 新增字段 | 类型 | 说明 |
|----------|------|------|
| release_id | text nullable | 关联批次（兼容旧数据） |

---

## 4. Release Intelligence 规则

### 批次序号识别

| 文本 | 解析结果 |
|------|----------|
| 一期 / 第1期 / 第1批 | release_no = 1 |
| 二期 / 第2期 / 第2批 | release_no = 2 |
| 三期 / 第3期 / 第3批 | release_no = 3 |
| 第N期 / 第N批 | release_no = N |

### 发售类型识别

| 文本 | release_type |
|------|-------------|
| 再贩 / 返场 / 复刻 / 补货 | rerelease |
| 预约 / 预定 / 定金 | reservation |
| 现货 / 即发 | spot |
| 抽选 / 抽签 | lottery |
| 首发 / 首贩 | first_release |

### 售卖阶段识别

| 文本 | lifecycle_status | sale_status |
|------|-----------------|-------------|
| 售罄 / sold out | sold_out | SOLD_OUT |
| 结束 / 截止 | ended | ENDED |
| 预约 / 定金 | active | PRE_ORDER |
| 现货 / 即发 | active | ON_SALE |
| 即将 / 预告 | upcoming | UPCOMING |

---

## 5. Dedup 调整

### Product 级去重（不变）

```
brand_id + canonical_name → 同一商品
```

### Release 级去重（新增）

```
product_id + release_no + release_type → 同一批次
（release_no > 0 时唯一约束）
```

### 行为

| 场景 | Product | Release |
|------|---------|---------|
| 同商品首次采集 | 创建 | 创建 |
| 同商品不同期 | 复用 | 创建新 release |
| 同批次二次采集 | 复用 | 复用（更新状态） |
| 无批次信息 | 复用 | 允许创建（release_no=0） |

---

## 6. Persistence 调整

采集写入流程改为：

```
1. upsertProduct(item, brandId)     → product_id
2. upsertRelease(productId, release) → release_id (如果有 release 信息)
3. recordPriceSnapshot(productId, price, ..., releaseId)  → price_snapshot
4. recordSourceRecord(...)           → source_record
```

新增方法：
- `upsertRelease()` — 幂等创建/更新 release
- `recordPriceSnapshotWithRelease()` — 带 release_id 的价格快照
- `getExistingReleases()` — 用于 dedup 加载

---

## 7. Feed API 兼容策略

### 不大改 Feed API

`listFeed` 和 `getProduct` 返回格式不变。

### 新增 latest_release 字段

在 Feed item 中可选附加：

```json
{
  "latest_release": {
    "release_type": "rerelease",
    "sale_status": "ON_SALE",
    "deposit_price": 10000,
    "balance_price": 2800,
    "full_price": 12800,
    "start_at": "2026-01-01T00:00:00Z",
    "end_at": "2026-01-15T00:00:00Z",
    "is_rerelease": true,
    "is_sold_out": false
  }
}
```

### 规则

- 只返回 `visibility_status = 'published'` 的 release
- 取 `release_no` 最大的 published release
- 无 published release 时不返回 latest_release

---

## 8. 测试结果

```
npm test:     220 passed, 1 skipped (221 total)
npm typecheck: 0 errors
npm build:     success
```

### 新增测试

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| intelligence/release-intelligence.test.ts | 28 | 批次解析/类型/阶段/生命周期 |
| crawler/release-persistence.test.ts | 9 | 持久化/去重/Feed兼容 |

### 覆盖场景

| # | 场景 | 结果 |
|---|------|------|
| 1 | 一期商品解析 | ✅ |
| 2 | 二期再贩解析 | ✅ |
| 3 | 预约/定金/尾款识别 | ✅ |
| 4 | 售罄/结束识别 | ✅ |
| 5 | 同商品不同期不重复 product | ✅ |
| 6 | 同商品不同期生成多个 release | ✅ |
| 7 | 同批次二次采集不重复 release | ✅ |
| 8 | price_snapshots 可关联 release | ✅ |
| 9 | draft release 不进入 Feed | ✅ |
| 10 | published release 可进入 Feed | ✅ |

---

## 9. 新增文件

| 文件 | 说明 |
|------|------|
| `migrations/0005_product_releases.sql` | product_releases 表 + price_snapshots.release_id |
| `src/intelligence/release-intelligence.ts` | 发售批次智能识别引擎 |
| `tests/intelligence/release-intelligence.test.ts` | Release Intelligence 测试（28 用例） |
| `tests/crawler/release-persistence.test.ts` | Release 持久化 + 去重 + Feed 测试（9 用例） |

## 修改文件

| 文件 | 变更 |
|------|------|
| `src/crawler/core/types.ts` | NormalizedItem + release: ReleaseInfo \| null |
| `src/crawler/normalizers/field-normalizer.ts` | 默认 release: null |
| `src/crawler/storage/persistence.ts` | upsertRelease + recordPriceSnapshotWithRelease + getExistingReleases |
| `tests/crawler/*.test.ts` | 7 个测试文件添加 release: null |

---

## 10. 当前限制

1. **Release Intelligence 未集成到采集管道**：当前为独立引擎，未自动在 normalize 阶段调用
2. **Feed API 未实际返回 latest_release**：需要在 postgres.ts 的 listFeed/getProduct 中 JOIN product_releases
3. **Release 批次号仅支持中文数字**：第10期以上需扩展
4. **无跨平台批次合并**：同一商品在不同来源的批次未做关联
5. **lifecycle_status 未自动更新**：需定时任务根据时间戳更新

---

## 11. 下一阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| D5.2 | 将 Release Intelligence 集成到采集管道（normalize 阶段自动识别） | 高 |
| D5.3 | Feed API 返回 latest_release（JOIN product_releases） | 高 |
| D5.4 | lifecycle_status 定时更新（upcoming→active→ended） | 中 |
| D6 | 图片采集与本地存储 | 中 |
| D7 | 多来源合并去重 | 中 |
| D8 | Review API JWT 认证 | 高 |
| D9 | 定时采集调度 | 中 |
