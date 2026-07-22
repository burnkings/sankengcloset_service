# Phase D7 — Content Data Platform Report

## 1. Feed 架构

### 升级前

```
App → /api/v1/feed → PostgresRepository.listFeed() → 直接读 products 表 → FeedItem
```

FeedItem 字段有限：badgeText、rankingScore 等简单字段，无品牌热度、发售类型、推荐理由。

### 升级后

```
App → /api/v1/feed → PostgresRepository.listFeed() → 聚合查询（products + brands + product_releases + price_snapshots）→ ContentFeedItem
App → /api/v1/search → PostgresRepository.searchProducts() → 全文搜索 + 多维过滤 → ContentFeedItem
App → /api/v1/trends → PostgresRepository.getTrendSummary() → 聚合趋势数据 → TrendSummary
```

### ContentFeedItem 结构

```typescript
interface ContentFeedItem {
  id, feedType, entityId,
  title, subtitle,           // 商品名 + 品牌名
  coverUrl, secondaryCoverUrl,
  brandId, brandName,
  category, pitType,
  price, originalPrice, priceSummary,  // 价格信息
  saleStatus,               // UPCOMING / ON_SALE / PRE_ORDER / SOLD_OUT / ENDED
  releaseType, releaseTypeName,  // first_release / rerelease / reservation / spot / lottery
  tags[],                   // season + scene + element + recommended
  feedScore,                // 0-100 综合评分
  feedReason,               // 推荐理由 e.g. "热门品牌新品"
  eventStartAt, eventEndAt,
  liked, saved,
  sourceLabel,
  publishedAt, createdAt,
}
```

### 数据聚合方式

PostgreSQL 聚合查询（单次查询完成）：

```sql
SELECT p.*, b.name, b.heat_score,
  -- 最新 release（子查询）
  (SELECT pr.release_type FROM product_releases pr ... LIMIT 1),
  -- 最新价格快照（子查询）
  (SELECT ps.price_cents FROM price_snapshots ps ... LIMIT 1)
FROM products p
LEFT JOIN brands b ON b.id = p.brand_id
WHERE p.deleted_at IS NULL AND p.visibility_status = 'published'
ORDER BY p.feed_score DESC, p.created_at DESC
```

- 不复制数据，使用 SQL 子查询实时聚合
- feed_score 排序（降序），优先展示高质量内容
- draft 自动过滤（visibility_status = 'published'）

---

## 2. 数据聚合方式

| 数据源 | 聚合方式 | 用途 |
|--------|----------|------|
| products | 主表 | 商品基础信息 |
| brands | LEFT JOIN | 品牌名 + 热度分数 |
| product_releases | LATERAL 子查询 | 最新发售类型、是否再贩、结束时间 |
| price_snapshots | LATERAL 子查询 | 最新价格、降价检测 |
| product_images | 子查询 | 图片列表 |
| season/scene/element/recommended_tags | 直接读取 | 标签聚合 |

---

## 3. 排序规则

### Feed Score（0-100）

| 维度 | 权重 | 评分逻辑 |
|------|------|----------|
| 时间新鲜度 | 25% | 7天内100分，30天60分，90天后0分 |
| 品牌热度 | 20% | 直接使用品牌 heat_score |
| 新品加分 | 20% | UPCOMING/PRE_ORDER=100，ON_SALE=60 |
| 价格信号 | 15% | 降价=80，稳定=50，涨价=30 |
| 质量审核 | 20% | APPROVED+published+高置信度=满分 |

### Feed Reason（推荐理由）

优先级从高到低：

1. **即将截止预约** — event_end_at 在 72 小时内
2. **热门品牌新品** — 品牌热度>=70 + 新品/预约状态
3. **历史高热再贩** — feed_score>=60 + 再贩
4. **最近降价** — 价格趋势下降
5. **首发预售** — reservation + PRE_ORDER
6. **品牌上新** — 7天内创建
7. **再贩返场** — is_rerelease=true
8. **现货在售** — ON_SALE
9. **精选推荐** — 默认

### Ranking Score

```
最终排序分 = feed_score + reason_boost
```

| Reason | Boost |
|--------|-------|
| 即将截止预约 | +30 |
| 热门品牌新品 | +25 |
| 历史高热再贩 | +20 |
| 最近降价 | +18 |
| 首发预售 | +15 |
| 品牌上新 | +12 |
| 再贩返场 | +10 |
| 现货在售 | +5 |
| 精选推荐 | +0 |

---

## 4. 搜索设计

### API

```
GET /api/v1/search?q=关键词&category=JK&saleStatus=PRE_ORDER&releaseStatus=rerelease&brandId=br_1&minPrice=10000&maxPrice=50000&limit=20&cursor=0
```

### 搜索能力

| 能力 | 实现 |
|------|------|
| 关键词搜索 | pg_trgm % 运算符 + ILIKE 模糊匹配 |
| 分类过滤 | category = 'JK' / 'LOLITA' / 'HANFU' / 'OTHER' |
| 发售状态 | sale_status 过滤 |
| 发售类型 | EXISTS 子查询 product_releases.release_type |
| 品牌过滤 | brand_id 精确匹配 |
| 价格范围 | minPrice / maxPrice |
| 分页 | cursor-based 游标分页 |

### 数据库索引

```sql
-- pg_trgm GIN 索引（模糊搜索）
CREATE INDEX idx_products_title_trgm ON products USING gin (title gin_trgm_ops);
CREATE INDEX idx_products_brand_name_trgm ON products USING gin (brand_name gin_trgm_ops);

-- 复合索引
CREATE INDEX idx_products_brand_sale ON products (brand_id, sale_status);
CREATE INDEX idx_products_price ON products (current_price);
CREATE INDEX idx_products_feed_score_published ON products (feed_score DESC);
```

---

## 5. 趋势设计

### API

```
GET /api/v1/trends?period=7d|30d|90d
```

### 品牌趋势（BrandTrend）

```typescript
interface BrandTrend {
  brandId, brandName, period,
  newProductCount,       // 新增商品数
  rereleaseCount,        // 再贩数
  avgPriceCents,         // 平均价格
  priceChangePercent,    // 价格变化百分比
  heatScore,             // 品牌热度
  productCount,          // 总商品数
}
```

计算逻辑：
- 按 period 聚合品牌的商品数、再贩数
- 计算当前均价 vs 历史均价的变化百分比
- 按 heat_score 降序排列，取 top 10

### 商品趋势（ProductTrend）

```typescript
interface ProductTrend {
  productId, productName, brandName, category, period,
  priceChange,           // 价格变化（分）
  priceChangePercent,    // 价格变化百分比
  feedScoreChange,       // 热度变化
  saleStatusChanged,     // 状态是否变化
  currentSaleStatus,     // 当前状态
  previousSaleStatus,    // 之前状态
}
```

---

## 6. API 变化

### 新增端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/search | 商品搜索（关键词+多维过滤） |
| GET | /api/v1/trends | 趋势数据（品牌+商品） |

### 修改端点

| 方法 | 路径 | 变化 |
|------|------|------|
| GET | /api/v1/feed | 返回 ContentFeedItem（替代 FeedItem），排序改为 feed_score 降序 |

### FeedItem → ContentFeedItem 字段映射

| 旧字段 | 新字段 | 说明 |
|--------|--------|------|
| badgeText | saleStatus + releaseTypeName | 状态信息更丰富 |
| rankingScore | feedScore + feedReason | 评分+推荐理由 |
| (无) | priceSummary | "¥368.00" 格式 |
| (无) | tags[] | 聚合标签 |
| (无) | pitType | 品类标签 |
| (无) | publishedAt | 发布时间 |

---

## 7. 测试结果

### 测试统计

```
Test Files  33 passed | 1 skipped (34)
     Tests  326 passed | 1 skipped (327)
```

### 新增测试（49 tests）

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| feed-ranker.test.ts | 15 | 价格格式、类型名、标签合并、推荐理由生成、排序加权 |
| trend-engine.test.ts | 9 | 品牌趋势计算、商品趋势计算、摘要构建 |
| feed-aggregation.test.ts | 6 | ContentFeedItem 字段完整性、feedReason、排序、分类过滤、分页 |
| search-api.test.ts | 10 | 关键词搜索、品牌搜索、分类过滤、价格范围、状态过滤、组合过滤、分页 |
| trends-api.test.ts | 4 | 趋势摘要、period 参数、无效 period 拒绝、结构验证 |

### 质量门禁

- ✅ npm test: 326 passed
- ✅ npm run typecheck: 0 errors
- ✅ npm run build: success

---

## 8. 新增文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| src/intelligence/feed-ranker.ts | 新增 | Feed 排序理由引擎 |
| src/intelligence/trend-engine.ts | 新增 | 趋势数据引擎 |
| src/types.ts | 修改 | 新增 ContentFeedItem、SearchQuery、TrendSummary 等类型 |
| src/repositories/contracts.ts | 修改 | 新增 searchProducts、getTrendSummary 接口 |
| src/repositories/memory.ts | 修改 | 内存模式实现 |
| src/repositories/postgres.ts | 修改 | PostgreSQL 聚合查询实现 |
| src/routes/content.ts | 修改 | 新增 /search、/trends 端点 |
| migrations/0007_content_platform.sql | 新增 | pg_trgm + 搜索索引 + v_content_feed 视图 |
| tests/content/feed-ranker.test.ts | 新增 | 排序理由测试 |
| tests/content/trend-engine.test.ts | 新增 | 趋势引擎测试 |
| tests/content/feed-aggregation.test.ts | 新增 | Feed 聚合测试 |
| tests/content/search-api.test.ts | 新增 | 搜索 API 测试 |
| tests/content/trends-api.test.ts | 新增 | 趋势 API 测试 |
| tests/postgres.integration.test.ts | 修改 | badgeText → saleStatus |

---

## 9. 下一阶段建议

### D8 — 数据规模化

1. **品牌试点扩展**：从 3 个品牌扩展到 5 个，商品从 26 扩展到 100-500
2. **增量更新**：基于 product_releases 的增量采集策略
3. **数据质量监控**：feed_score 分布统计、搜索命中率

### D9 — App 端集成

1. **Feed 页面升级**：使用 ContentFeedItem 的 feedReason 展示推荐理由
2. **搜索页面**：接入 /api/v1/search
3. **趋势页面**：品牌趋势 + 商品趋势可视化

### 不做的事情（YAGNI）

- ❌ AI 推荐（规则已足够）
- ❌ 社区功能
- ❌ 多平台大规模采集
- ❌ Elasticsearch（PostgreSQL pg_trgm 足够）
- ❌ 用户偏好学习（已预留字段，暂不实现）
