# Phase D1：商品数据模型与采集规范

## 1. ER 实体关系

```
brands 1──N products
products 1──N product_variants
products 1──N product_images
products 1──N price_snapshots
products 1──N sale_events
products N──N tags (via product_tags)
source_records N──1 raw_data
crawl_jobs 1──N crawl_records
review_records ──1 entities (polymorphic)
```

## 2. 数据字典

### brands
| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | br_{uuid} |
| name | text UNIQUE | 品牌名（兔缝缝） |
| name_en | text | 英文名 |
| category | pit_type | JK/LOLITA/HANFU/OTHER |
| logo_url | text | logo URL |
| description | text | 品牌描述 |
| official_url | text | 品牌官网 |
| source_url | text | 采集来源 URL |
| source_platform | data_source | 采集平台 |
| follower_count | integer | 关注数 |
| data_status | data_status | FRESH/STALE/DELETED/ARCHIVED |
| review_status | review_status | PENDING/APPROVED/REJECTED/CORRECTED |
| confidence | integer 0-100 | 数据可信度 |
| fetched_at | timestamptz | 最近采集时间 |

### products
| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | prd_{uuid} |
| canonical_name | text | 标准化名称（去重键之一） |
| display_name | text | 展示名称 |
| brand_id | text FK→brands | 所属品牌 |
| shop_id | text FK | 店铺（可选） |
| pit_type | pit_type | 坑向 |
| category | text | 细分类目（格裙/JSK/OP） |
| sub_category | text | 子分类 |
| style_tags | text[] | 风格标签 |
| color_tags | text[] | 颜色标签 |
| material_tags | text[] | 材质标签 |
| sale_status | sale_status | 销售状态 |
| current_price | integer | 当前价格（分） |
| original_price | integer | 原价（分） |
| deposit_price | integer | 定金（分） |
| balance_price | integer | 尾款（分） |
| currency | text | 货币（CNY） |
| preorder_start_at | timestamptz | 预售开始 |
| preorder_end_at | timestamptz | 预售结束 |
| balance_start_at | timestamptz | 尾款开始 |
| balance_end_at | timestamptz | 尾款结束 |
| release_at | timestamptz | 发售日期 |
| source_url | text | 采集来源 URL |
| source_platform | data_source | 采集平台 |
| external_id | text | 原始平台 ID |
| cover_url | text | 封面图 |
| images | text[] | 图片列表 |
| description | text | 标准化描述 |
| raw_description | text | 原始描述（不修改） |
| source_published_at | timestamptz | 原始发布时间 |
| first_seen_at | timestamptz | 首次发现时间 |
| last_seen_at | timestamptz | 最近确认存在时间 |
| collected_at | timestamptz | 采集时间 |
| data_status | data_status | 数据状态 |
| review_status | review_status | 审核状态 |
| confidence | integer 0-100 | 可信度 |

### price_snapshots
| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | ps_{uuid} |
| product_id | text FK→products | 关联商品 |
| price_cents | integer | 价格（分） |
| original_price_cents | integer | 原价（分） |
| deposit_cents | integer | 定金（分） |
| balance_cents | integer | 尾款（分） |
| source | text | 价格来源描述 |
| source_url | text | 来源 URL |
| fetched_at | timestamptz | 采集时间 |

### source_records
| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | src_{uuid} |
| source_type | data_source | 来源平台 |
| source_name | text | 来源名称 |
| source_url | text | 原始 URL |
| original_id | text | 平台 ID |
| raw_data_id | text FK→raw_data | 原始数据 |
| entity_type | text | 实体类型 |
| entity_id | text | 实体 ID |
| parser_version | text | 解析器版本 |
| human_modified | boolean | 是否人工修改 |

### crawl_jobs
| 字段 | 类型 | 说明 |
|------|------|------|
| id | text PK | job_{uuid} |
| source_type | data_source | 采集平台 |
| source_url | text | 目标 URL |
| status | crawl_status | 状态 |
| items_total | integer | 总数 |
| items_success | integer | 成功数 |
| items_failed | integer | 失败数 |
| items_skipped | integer | 跳过数 |
| trigger | text | 触发方式 |

## 3. 数据库选型结论

**PostgreSQL 17**，不混合其他数据库。

理由：
- JSONB 支持原始数据存储（raw_data.parsed_json）
- 数组类型支持标签（products.style_tags/color_tags/material_tags）
- 部分唯一索引支持去重（platform+externalId、brand+canonicalName）
- 全文搜索支持 Feed 排序
- 与现有 0001 migration 完全兼容
- 服务器 2G 内存足够

## 4. 去重规则

| 候选键 | 优先级 | 说明 |
|--------|--------|------|
| platform + externalId | P0 | 同平台同 ID 必定重复 |
| brand + canonicalName | P1 | 同品牌同名必定重复 |
| sourceUrl | P2 | 同 URL 跳过 |
| image phash | P3 | 图片级去重（预留） |
| 名称相似度 | P4 | 模糊去重（预留） |

去重流程：
1. 先查 platform + externalId → 命中则 update
2. 再查 brand + canonicalName → 命中则 update
3. 未命中则 insert（新商品）
4. 所有操作记录到 crawl_records（dedup_action 字段）

## 5. 数据生命周期

```
采集 → raw_data（原始存储）
     → source_records（来源追踪）
     → products（标准化数据，review_status=PENDING）
     → 审核（review_status=APPROVED/REJECTED）
     → Feed 展示（仅 APPROVED 数据进入 Feed）
     → 价格快照（每次采集记录价格变化）
     → 数据过期（last_seen_at 超过 30 天标记 STALE）
```

## 6. 来源追踪机制

每条数据必须回答：
1. **从哪里采集** → source_records.source_type + source_url
2. **原始 URL** → products.source_url / source_records.source_url
3. **什么时候采集** → products.collected_at / source_records.fetched_at
4. **原始内容** → raw_data.raw_content
5. **使用哪个解析器** → source_records.parser_version
6. **是否人工修改** → source_records.human_modified
7. **谁审核过** → review_records.reviewer_id
8. **最近更新** → products.updated_at

## 7. 校验规则

所有输入通过 Zod 校验（src/lib/validators.ts）：
- 价格：≥0，≤100,000,000（100万元）
- 可信度：0-100
- URL：合法 URL 或空字符串
- 名称：1-200 字符
- 标签数组：最多 20 个，每个最多 50 字符

## 8. 示例数据标记

数据库中的种子数据标记为：
- source_platform = 'ADMIN'
- review_status = 'APPROVED'
- confidence = 100

fixture 数据（测试用）使用前缀 `fixture_`。

## 9. 文件清单

| 文件 | 用途 |
|------|------|
| `migrations/0002_scrapers.sql` | 数据库 schema |
| `src/types/crawler.ts` | TypeScript 类型 |
| `src/lib/validators.ts` | Zod 校验规则 |
| `src/repositories/contracts-crawler.ts` | Repository 接口 |
