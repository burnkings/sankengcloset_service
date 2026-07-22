# Phase D5 — Product Intelligence Layer Report

> 完成时间：2026-07-22
> 基于：Phase D4.1 Persistence & Review Pipeline (143 tests)

---

## 1. 设计概述

Phase D5 不增加商品数量，而是为每个商品增加**智能维度**。通过规则引擎自动提取标签、聚合品牌画像、计算价格统计、生成 Feed 评分，为后续排序和推荐提供数据基础。

### 架构

```
Product Intelligence Engine
  ├── analyzeProduct(text) → 风格/颜色/季节/场景/材质/元素标签
  ├── recommendTags(intel) → 推荐标签（Top 5）
  └── mergeIntelligence(a, b) → 合并标签（去重）

Brand Intelligence Engine
  └── buildBrandProfile(brand, products) → 品牌画像
      ├── heat_score (0-100)
      ├── update_frequency_days
      ├── avg_price_cents
      ├── popular_series
      ├── release_cycle_days
      └── brand_status (active/quiet/inactive)

Price Intelligence Engine
  ├── computePriceStats(snapshots) → 单品价格统计
  └── computeBatchPriceStats(all) → 批量价格统计
      ├── first/current/min/max_price_cents
      ├── price_change_count
      ├── decrease/increase_count
      └── price_trend (stable/down/up/volatile)

Feed Score Engine
  └── computeFeedScore(input) → 综合评分 (0-100)
      ├── time_score (25%)
      ├── brand_score (20%)
      ├── newness_score (20%)
      ├── price_score (15%)
      └── quality_score (20%)
```

---

## 2. 数据结构

### 新增字段（products 表）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `season_tags` | text[] | `'{}'` | 季节标签（春季/夏季/秋季/冬季/四季） |
| `scene_tags` | text[] | `'{}'` | 场景标签（日常/社交/摄影/演出/仪式/旅行/茶会/节日） |
| `element_tags` | text[] | `'{}'` | 元素标签（蝴蝶结/蕾丝边/褶皱/刺绣/织金等） |
| `recommended_tags` | text[] | `'{}'` | 推荐标签（智能排序 Top 5） |
| `feed_score` | integer | `0` | Feed 综合评分 0-100 |

### 新增字段（brands 表）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `heat_score` | integer | `0` | 品牌热度 0-100 |
| `update_frequency_days` | integer | `0` | 平均更新间隔（天） |
| `avg_price_cents` | integer | `0` | 平均售价（分） |
| `popular_series` | text[] | `'{}'` | 热门系列（Top 3 category） |
| `release_cycle_days` | integer | `0` | 发售周期（天） |
| `brand_status` | text | `'active'` | 品牌状态（active/quiet/inactive） |

### 索引

| 索引 | 用途 |
|------|------|
| `idx_products_feed_score` | Feed 排序（WHERE visibility_status='published'） |
| `idx_brands_heat_score` | 品牌热度排序 |

---

## 3. 标签体系（可扩展）

### Product Intelligence 标签规则

| 维度 | 规则数 | 示例标签 |
|------|--------|----------|
| 风格 | 10 | 甜美/哥特/古典/日常/华丽/清新/学院/国风/欧式古典/街头 |
| 颜色 | 16 | 黑色系/白色系/粉色系/格纹/条纹/碎花/纯色 |
| 季节 | 6 | 春季/夏季/秋季/冬季/四季 |
| 场景 | 8 | 日常/社交/摄影/演出/仪式/旅行/茶会/节日 |
| 材质 | 12 | 涤纶/棉/雪纺/蕾丝/丝绸/欧根纱/皮革/羊毛 |
| 元素 | 14 | 蝴蝶结/蕾丝边/褶皱/刺绣/荷叶边/织金/格纹 |

### 扩展方式

在 `src/intelligence/product-intelligence.ts` 的 `*_RULES` 数组中添加新规则：

```typescript
const STYLE_RULES: { pattern: RegExp; tag: string }[] = [
  // 现有规则...
  { pattern: /新规则正则/, tag: '新标签' },
];
```

---

## 4. Feed Score 权重

| 维度 | 权重 | 评分逻辑 |
|------|------|----------|
| 时间新鲜度 | 25% | 7天内100分，30天后递减，90天后0 |
| 品牌热度 | 20% | 直接使用 brand.heat_score |
| 新品加分 | 20% | UPCOMING/PRE_ORDER=100，ON_SALE=60，7天内+30 |
| 价格信号 | 15% | 降价=80，稳定=50，涨价=30，波动=40 |
| 质量信号 | 20% | APPROVED+published+高置信度=满分 |

---

## 5. 测试结果

```
npm test:     183 passed, 1 skipped (184 total)
npm typecheck: 0 errors
npm build:     success
```

### 新增测试

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| intelligence/product-intelligence.test.ts | 15 | 标签提取/合并/推荐 |
| intelligence/brand-intelligence.test.ts | 7 | 热度/均价/系列/周期/状态 |
| intelligence/price-intelligence.test.ts | 9 | 统计/趋势/批量/边界 |
| intelligence/feed-score.test.ts | 9 | 评分/权重/趋势/状态 |

### 测试详情

**Product Intelligence (15)**
- ✅ JK 产品提取学院+日常风格
- ✅ 颜色标签提取（蓝色系/黑色系）
- ✅ 季节标签提取
- ✅ 场景标签提取
- ✅ 材质标签提取
- ✅ 元素标签提取
- ✅ 空文本处理
- ✅ Lolita 风格提取（甜美+清新+茶会+蕾丝边）
- ✅ 哥特风格提取（哥特+蕾丝边）
- ✅ 汉服风格提取（国风+华丽+织金）
- ✅ 标签合并去重
- ✅ 推荐标签优先级
- ✅ 推荐标签数量限制

**Brand Intelligence (7)**
- ✅ 活跃品牌热度计算
- ✅ 平均价格计算
- ✅ 热门系列提取
- ✅ 空产品品牌状态
- ✅ 发售周期计算
- ✅ 慢更新品牌状态
- ✅ 粉丝数包含

**Price Intelligence (9)**
- ✅ 空快照返回 null
- ✅ 单快照基础统计
- ✅ 降价检测
- ✅ 涨价检测
- ✅ 波动检测（多次变化）
- ✅ 最低/最高价计算
- ✅ 最后更新时间
- ✅ 批量计算
- ✅ 空输入处理

**Feed Score (9)**
- ✅ 分数范围 0-100
- ✅ 新品+approved+published 高分
- ✅ 旧+draft 低分
- ✅ 降价加分
- ✅ 高品牌热度加分
- ✅ 分解维度完整
- ✅ PRE_ORDER 新品分 ≥ ON_SALE
- ✅ hidden 质量分低
- ✅ published > reviewing

---

## 6. 新增文件

| 文件 | 说明 |
|------|------|
| `src/intelligence/product-intelligence.ts` | 商品智能标签引擎 |
| `src/intelligence/brand-intelligence.ts` | 品牌智能画像引擎 |
| `src/intelligence/price-intelligence.ts` | 价格智能分析引擎 |
| `src/intelligence/feed-score.ts` | Feed 评分引擎 |
| `migrations/0004_intelligence.sql` | 数据库迁移（新增字段+索引） |
| `tests/intelligence/product-intelligence.test.ts` | 商品智能标签测试（15 用例） |
| `tests/intelligence/brand-intelligence.test.ts` | 品牌智能画像测试（7 用例） |
| `tests/intelligence/price-intelligence.test.ts` | 价格智能分析测试（9 用例） |
| `tests/intelligence/feed-score.test.ts` | Feed 评分测试（9 用例） |

---

## 7. 修改文件

| 文件 | 变更 |
|------|------|
| `migrations/0004_intelligence.sql` | 新增（已执行） |

无修改现有文件，完全向后兼容。

---

## 8. 未来 AI 扩展方案

### Phase 1: 规则引擎（当前）
- 基于正则表达式的标签提取
- 基于聚合的统计计算
- 基于权重的评分

### Phase 2: NLP 增强（可选）
- 使用 LLM 分析商品描述，提取更精准的标签
- 支持模糊匹配（如"小清新"→清新风格）
- 多语言支持（日文/韩文品牌名）

### Phase 3: 协同过滤（可选）
- 基于用户行为（浏览/收藏/购买）调整 Feed Score
- 品牌相似度计算
- 商品推荐（"相似商品"）

### Phase 4: 时序预测（可选）
- 价格趋势预测（降价/涨价概率）
- 发售时间预测
- 库存状态推断

---

## 9. 当前限制

1. **标签规则有限**: 当前约 66 条规则，覆盖常见场景但不完整
2. **Feed Score 无个性化**: 所有用户看到相同排序
3. **品牌热度无实时性**: 基于静态数据计算，不反映实时热度
4. **价格统计无异常检测**: 不区分促销价和正常价
5. **标签未写入数据库**: 当前仅为计算结果，未持久化到 products 表

---

## 10. 下一阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| D5.1 | 将智能标签写入 products 表（持久化） | 高 |
| D5.2 | 品牌画像写入 brands 表（定时更新） | 高 |
| D5.3 | Feed Score 写入 products 表（采集时计算） | 高 |
| D6 | 图片采集与本地存储 | 中 |
| D7 | 多来源合并去重 | 中 |
| D8 | Review API JWT 认证 | 高 |
| D9 | 定时采集调度 | 中 |
