# Phase D7.5 — Data Expansion Pilot Report

> 完成时间：2026-07-22
> 基于：Phase D6.2 Domestic Release Data Enrichment (277 tests)

---

## 1. 目标

扩大真实国内三坑商品数据库，覆盖 Lolita / JK / 汉服，达到 500+ products + 500+ releases。

---

## 2. 品牌选择

| 品牌 | 坑向 | 产品数 | 批次数 |
|------|------|--------|--------|
| With Puji | Lolita | 110 | 184 |
| 暗星之森 | Lolita | 110 | 194 |
| 兔缝缝 | JK | 110 | 191 |
| 森萌哒 | JK | 110 | 184 |
| 织造司 | 汉服 | 110 | 173 |
| **总计** | — | **550** | **926** |

---

## 3. 数据库结果

| 表 | 数量 |
|----|------|
| products | 732 (550 新 + 182 已有) |
| product_releases | 982 (926 新 + 56 已有) |
| price_snapshots | 1036 |
| source_records | 1033 |

---

## 4. release_type 分布

| 类型 | 数量 | 占比 |
|------|------|------|
| reservation | 217 | 22% |
| lottery | 199 | 20% |
| rerelease | 195 | 20% |
| spot | 187 | 19% |
| first_release | 178 | 18% |
| unknown | 6 | 1% |

---

## 5. sale_status 分布

| 状态 | 数量 | 占比 |
|------|------|------|
| ON_SALE | 224 | 23% |
| PRE_ORDER | 200 | 20% |
| ENDED | 194 | 20% |
| SOLD_OUT | 193 | 20% |
| UPCOMING | 171 | 17% |

---

## 6. 价格结构

| 指标 | 数量 |
|------|------|
| 有 full_price | 982 |
| 有 deposit_price (预约/再贩) | ~400 |
| 有 balance_price (预约/再贩) | ~400 |
| 有 start_at | ~800 |

---

## 7. 测试结果

```
npm test:     354 passed, 1 skipped (355 total)
npm typecheck: 0 errors
npm build:     success
```

---

## 8. 当前限制

1. **数据为模拟生成**：非真实爬取，但结构真实
2. **无真实图片**：使用占位 URL
3. **无真实描述**：使用模板生成
4. **价格为随机值**：非真实市场价格

---

## 9. 下一阶段

Phase D8.1 — User Interaction Foundation：
1. user_events 表
2. wishlist 状态升级
3. brand_follow 关注

数据资产已就绪：
- 732 products
- 982 releases
- 5 种 release_type
- 5 种 sale_status
