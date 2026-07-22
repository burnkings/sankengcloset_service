# Phase D4.1 — Persistence & Content Review Pipeline Report

> 完成时间：2026-07-22
> 基于：Phase D4 First Data Source Integration (138 tests)

---

## 1. 当前架构

```
Crawler
  ↓
SourceAdapter (fixture / HTTP)
  ↓
Parser (JSON → ParsedItem)
  ↓
Normalizer (品牌别名/类目映射 → NormalizedItem)
  ↓
Validator (字段校验 → ValidationResult)
  ↓
Deduplicator (brand+name / sourceUrl 双重匹配)
  ↓
Persistence (upsert / 价格快照 / 来源记录)
  ↓
Database (PostgreSQL 17)
  ↓
Directus Review (visibility_status: draft → published)
  ↓
Feed API (只读 published)
```

---

## 2. 数据库验证结果

### 采集脚本运行结果

| 指标 | 第一次运行 | 第二次运行（幂等） |
|------|-----------|-------------------|
| 产品新增 | 2 | 0 |
| 产品更新 | 1 | 1 |
| source_records | 2 新增 | 0 新增 |
| price_snapshots | 2 新增 | 0 新增 |
| crawl_jobs | 1 | 1 |

### 字段验证

**crawl_jobs** ✅

| 字段 | 值 |
|------|-----|
| source_type | OFFICIAL |
| status | SUCCESS |
| started_at | 2026-07-22T01:27:17Z |
| finished_at | 2026-07-22T01:27:17Z |
| items_total | 1 |
| items_failed | 0 |

**source_records** ✅

| 字段 | 值 |
|------|-----|
| source_type | OFFICIAL |
| source_url | fixture://brand-tufengfeng-api.json |
| entity_type | product |
| parser_version | v1 |

**products** ✅

| 字段 | 值 |
|------|-----|
| canonical_name | 经典绀色格裙 45cm |
| brand_id | br_001 |
| pit_type | JK |
| sale_status | ON_SALE |
| current_price | 12800 (分) |
| visibility_status | draft |

**price_snapshots** ✅

| 字段 | 值 |
|------|-----|
| product_id | prd_4e3a0e24... |
| price_cents | 12800 |
| source | crawler |
| source_url | fixture://brand-tufengfeng-api.json |

---

## 3. 幂等问题修复记录

### Bug 1: brandName JOIN 缺失

**根因**: `getExistingProducts()` 只返回 `brandId`，不返回 `brandName`。Deduplicator 的 `check()` 用 `normalizedBrandName` 做 key，导致第二次运行无法匹配已有产品。

**修复**: `persistence.ts` 的 `getExistingProducts()` 改为 `LEFT JOIN brands` 返回 `brand_name`。

```sql
SELECT p.id, p.brand_id, b.name as brand_name, p.canonical_name, p.source_url
FROM products p LEFT JOIN brands b ON b.id = p.brand_id
WHERE p.deleted_at IS NULL
```

### Bug 2: source_record 无去重

**根因**: `recordSourceRecord()` 每次直接 INSERT，重复采集产生重复记录。

**修复**: INSERT 前检查 `entity_type + entity_id + source_url` 是否已存在。

### Bug 3: price_snapshot 无去重

**根因**: `recordPriceSnapshot()` 每次直接 INSERT，同价重复采集产生重复快照。

**修复**: INSERT 前检查 `product_id + source + price_cents` 是否已存在。

---

## 4. visibility_status 设计

### 枚举值

| 值 | 含义 | 说明 |
|----|------|------|
| `draft` | 草稿 | 采集数据默认状态，不进入 Feed |
| `reviewing` | 审核中 | 人工审核进行中 |
| `published` | 已发布 | 审核通过，可被 Feed API 读取 |
| `hidden` | 已隐藏 | 审核拒绝或主动下架 |

### 数据流

```
Crawler → INSERT (visibility_status='draft')
    ↓
Directus 审核 / Review API
    ↓
visibility_status='published'
    ↓
Feed API (WHERE visibility_status='published')
```

### Migration

- `migrations/0003_visibility.sql`: 创建 ENUM + 字段 + 索引
- 已有种子数据（review_status=APPROVED）自动标记为 `published`
- 采集数据默认 `draft`，禁止直接进入 Feed

---

## 5. Directus 配置

### Collections（已配置可见性）

| Collection | 图标 | 说明 |
|-----------|------|------|
| products | checkroom | 三坑商品（核心实体） |
| brands | business | 品牌信息 |
| source_records | link | 数据来源追踪 |
| crawl_jobs | autorenew | 采集任务记录 |
| price_snapshots | trending_down | 价格快照历史 |
| review_records | rate_review | 审核记录 |
| product_images | image | 商品图片 |
| product_variants | style | 商品变体 |
| tags | label | 标签 |
| product_tags | sell | 商品标签关联 |

### Permissions

- Administrator policy: 9 collections × 4 actions (read/create/update/delete) = 36 permissions
- 字段标签已配置（中文 label + interface + display）

### 审核流程

1. 采集数据以 `draft` 状态写入
2. 管理员在 Directus 或 Review API 中审核
3. 审核通过 → `published` → Feed API 可见
4. 审核拒绝 → `hidden` → Feed API 不可见
5. 审核记录写入 `review_records` 表

---

## 6. 测试结果

```
npm test:     143 passed, 1 skipped (144 total)
npm typecheck: 0 errors
npm build:     success
```

### 新增测试

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| persistence.integration.test.ts | 5 | 首次采集 / 幂等 / 价格变化 / 审核状态 / 状态流转 |
| admin/review.test.ts | 5 | Review API 端点测试 |

### 测试详情

| Case | 描述 | 结果 |
|------|------|------|
| Case 1 | 首次采集：2 个商品 → products + source_records + price_snapshots 创建 | ✅ |
| Case 2 | 重复采集：不新增任何记录 | ✅ |
| Case 3 | 价格变化：product 更新 + 新 price_snapshot | ✅ |
| Case 4 | 审核状态：draft 不在 Feed，published 在 Feed | ✅ |
| Case 4b | 状态流转：draft → reviewing → published → hidden | ✅ |

---

## 7. 新增文件

| 文件 | 说明 |
|------|------|
| `migrations/0003_visibility.sql` | visibility_status 枚举 + 字段 + 索引 |
| `src/routes/review.ts` | 审核 API 路由（单个/批量状态变更 + 查询 + 历史） |
| `tests/crawler/persistence.integration.test.ts` | Persistence 集成测试（5 用例） |
| `scripts/setup-directus-perms.sh` | Directus 权限配置脚本 |

---

## 8. 修改文件

| 文件 | 变更 |
|------|------|
| `src/crawler/storage/persistence.ts` | getExistingProducts JOIN brands + source_record/price_snapshot 幂等 |
| `src/crawler/pipelines/deduplicator.ts` | 无修改（逻辑正确） |
| `scripts/crawler-brand-api.ts` | 幂等性测试逻辑修正（检查数量不变） |
| `tests/crawler/persistence-idempotent.test.ts` | MockPersistence 签名更新（+brandName） |
| `src/repositories/postgres.ts` | listFeed/getProduct 添加 visibility_status='published' 过滤 |
| `src/lib/problem.ts` | 新增 badRequest() |
| `src/app.ts` | 注册 review 路由 + postgres 连接管理 |

---

## 9. 当前限制

1. **Review API 无认证**: 当前未接入 JWT 认证，需后续添加
2. **Directus 无 ICP**: 中国大陆服务器无备案，浏览器可能被 ISP 拦截（API 调用不受影响）
3. **fixture 数据**: 当前采集使用本地 fixture，非真实 HTTP 采集
4. **brands 为空**: 假数据已清理，需通过真实采集或手动导入品牌数据
5. **图片未采集**: Phase D6 图片管道尚未集成到真实采集流程

---

## 10. 下一阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| D4.2 | 第二数据源集成（微博/小红书） | 高 |
| D5 | 数据清洗管道集成到采集流程 | 高 |
| D6 | 图片采集与本地存储 | 中 |
| D7 | 多来源合并去重 | 中 |
| D8 | Review API JWT 认证 | 高 |
| D9 | 定时采集调度 | 中 |

---

## 11. 验证命令

```bash
# 运行采集
DATABASE_URL="postgres://sankeng:<password>@172.21.0.2:5432/sankeng" \
  node --import tsx scripts/crawler-brand-api.ts

# 验证 Directus
curl -s http://127.0.0.1:8055/server/health

# 验证 Review API
curl http://127.0.0.1:8787/api/v1/review/products?status=draft

# 测试
npm test && npm run typecheck && npm run build
```
