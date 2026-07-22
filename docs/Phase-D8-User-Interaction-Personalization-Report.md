# Phase D8 — User Interaction & Personalization Foundation Report

## 1. 用户事件设计

### 表结构

```sql
CREATE TABLE user_events (
  id          text PRIMARY KEY,
  user_id     text,                            -- 可空（匿名用户）
  event_type  text NOT NULL CHECK (event_type IN (
    'VIEW_PRODUCT', 'VIEW_RELEASE', 'LIKE_PRODUCT', 'SAVE_PRODUCT',
    'FOLLOW_BRAND', 'SEARCH', 'SHARE', 'CLICK_PRICE_ALERT', 'CLICK_BUY'
  )),
  target_type text NOT NULL,                   -- product / release / brand / search
  target_id   text NOT NULL DEFAULT '',
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### 设计原则

- user_id 可空 → 支持匿名用户行为采集
- metadata JSONB → 灵活存储上下文（搜索词、页面来源等）
- 不保存敏感信息、不记录隐私数据
- 9 种事件类型覆盖核心用户行为路径

### API

```
POST /api/v1/events     → 记录事件（支持匿名）
GET  /api/v1/events     → 查询用户事件列表
```

### 速率限制

- metadata 最大 2KB
- event_type 枚举校验
- 通过 Zod schema 严格验证输入

---

## 2. 收藏设计

### 表升级

```sql
ALTER TABLE wishlist_items ADD COLUMN product_id text;
ALTER TABLE wishlist_items ADD COLUMN release_id text;
ALTER TABLE wishlist_items ADD COLUMN note text NOT NULL DEFAULT '';
ALTER TABLE wishlist_items ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
```

### 状态扩展

| 状态 | 含义 |
|------|------|
| WISH | 默认收藏 |
| WANT | 想要购买 |
| WATCHING | 关注中 |
| WAIT_RELEASE | 等待发售 |
| WAIT_PRICE | 等待降价 |
| PURCHASED | 已购买 |

### API

```
POST   /api/v1/wishlist      → 添加收藏
GET    /api/v1/wishlist      → 列出收藏（支持 status 过滤）
PATCH  /api/v1/wishlist/:id  → 更新收藏状态
DELETE /api/v1/wishlist/:id  → 删除收藏
```

### 兼容性

- 已有 WISH 状态保持不变
- 新增字段全部 nullable/default，不影响现有数据
- 唯一约束：user_id + product_id 防重复

---

## 3. 品牌关注设计

### 表结构

```sql
CREATE TABLE brand_followers (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, brand_id)
);
```

### API

```
POST   /api/v1/brands/follow      → 关注品牌
DELETE /api/v1/brands/:id/follow  → 取消关注
GET    /api/v1/brands/followed    → 查询关注列表
```

### 特性

- 天然幂等：ON CONFLICT DO NOTHING
- 级联删除：用户删除时自动清理
- 支持匿名用户（返回空列表）

---

## 4. Personal Score 规则

### 评分维度

| 维度 | 权重 | 满分 | 数据来源 |
|------|------|------|----------|
| 标签匹配 | 40% | 40 | 收藏标签 + 浏览品类 |
| 品牌匹配 | 30% | 30 | 关注的品牌列表 |
| 品类匹配 | 30% | 30 | 收藏/浏览的品类 |

### 评分公式

```
tag_score = (匹配标签数 / min(商品标签数, 5)) * 40
brand_score = brandId in followedBrands ? 30 : 0
category_score = category in userCategories ? 30 : 0

personal_score = tag_score * 0.4 + brand_score * 0.3 + category_score * 0.3
```

### 用户偏好画像

从以下数据源聚合：

1. **关注的品牌** → brand_followers 表
2. **收藏的品类** → wishlist_items JOIN products
3. **收藏的标签** → wishlist_items JOIN products (season/scene/element_tags)
4. **浏览的品类** → user_events (VIEW_PRODUCT) JOIN products
5. **搜索关键词** → user_events (SEARCH) metadata.q

### 推荐理由

| 条件 | matchReason |
|------|-------------|
| 品牌匹配 + 标签匹配 | "你关注的品牌有你喜欢的{tag}元素" |
| 仅品牌匹配 | "你关注的品牌发布新品" |
| 品类匹配 + 标签匹配 | "与你喜欢的{catName}风格匹配" |
| 仅标签匹配 | "包含你喜欢的{tag}元素" |
| 仅品类匹配 | "与你的偏好品类匹配" |
| 无匹配 | "" |

---

## 5. Feed 变化

### 最终排序分

```
final_score = feed_score * 0.7 + personal_score * 0.3
```

### FeedItem 新增字段

```typescript
interface ContentFeedItem {
  // ... 原有字段 ...
  personalScore: number;     // 0-100 个性化评分
  matchReason: string;       // 推荐理由
  finalScore: number;        // 最终排序分
}
```

### 行为

- **未登录用户**：personalScore=0, matchReason='', finalScore=feedScore
- **登录用户**：根据用户偏好计算 personalScore，按 finalScore 重排
- Feed 保持公共可见，个性化仅影响排序

---

## 6. 测试结果

### 统计

```
Test Files  35 passed | 1 skipped (36)
     Tests  354 passed | 1 skipped (355)
```

### 新增测试（77 tests）

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| personal-score.test.ts | 12 | 评分维度、组合评分、推荐理由、分数上限 |
| interaction-api.test.ts | 25 | 事件记录/查询、收藏CRUD/状态/过滤、品牌关注/取关/幂等、Feed个性化 |

### 质量门禁

- ✅ npm test: 354 passed
- ✅ npm run typecheck: 0 errors
- ✅ npm run build: success

---

## 7. 新增文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| migrations/0008_user_interaction.sql | 新增 | user_events + brand_followers + wishlist 升级 |
| src/intelligence/personal-score.ts | 新增 | 个性化评分引擎 |
| src/routes/interaction.ts | 新增 | 事件/收藏/品牌关注 API |
| src/types.ts | 修改 | 新增 UserEvent/WishlistItem/BrandFollower/PersonalScore 类型 |
| src/repositories/contracts.ts | 修改 | 新增 D8 接口方法 |
| src/repositories/memory.ts | 修改 | 内存模式实现 |
| src/repositories/postgres.ts | 修改 | PostgreSQL 实现 |
| src/routes/content.ts | 修改 | Feed 支持个性化排序 |
| src/app.ts | 修改 | 注册 interaction 路由 |
| tests/content/personal-score.test.ts | 新增 | 评分引擎测试 |
| tests/content/interaction-api.test.ts | 新增 | 交互 API 测试 |
| docs/Phase-D8-User-Interaction-Personalization-Report.md | 新增 | 本报告 |

---

## 8. 下一阶段建议

### D9 — 数据驱动优化

1. **行为数据看板**：事件类型分布、收藏转化率、品牌关注热度
2. **Feed A/B 测试**：对比 0.7/0.3 vs 0.8/0.2 的 feed/personal 权重
3. **标签权重优化**：高频标签 vs 低频标签的差异化权重

### D10 — App 端集成

1. **收藏页面**：展示多状态收藏列表
2. **品牌关注**：关注按钮 + 关注列表
3. **Feed 个性化**：登录后展示 matchReason

### 不做的事情（YAGNI）

- ❌ AI 推荐（规则已足够）
- ❌ 协同过滤（用户量不够）
- ❌ 实时推荐（批处理即可）
- ❌ 推送通知（功能边界外）
