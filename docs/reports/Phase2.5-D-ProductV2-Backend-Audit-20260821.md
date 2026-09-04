# Phase 2.5-D Product V2 Backend — Stage 0 只读审计报告

- 日期: 2026-08-21
- 审计方式: 100% 只读（information_schema / pg_catalog SELECT + 代码文件读取），未执行任何 DELETE/TRUNCATE/DROP/UPDATE/migration
- 审计对象: 生产库 127.0.0.1:5433 (sankeng-pg_postgres_1) + 后端仓库 /home/admin/projects/sankengcloset_service
- 分支: agent/feed-contract-completion-20260812（import-taobao-products.ts 含未提交工作区修改，已按工作区版本审计）
- 结论: **Stage 0 完成，等待用户确认后进入 Implementation**

---

## 1. 当前真实数据表关系图（以真实 FK 为准）

```
brands (252)                        users (1)
   │ ▲                                │ ▲
   │ │ products.brand_id              │ │ (user 系统 10 张表 FK)
   │ │ styles.brand_id                ▼
   ▼ │                          user_assets(4)/user_sessions/brand_followers(1)/
 styles (1180)                    wishlist_items/user_events/user_settings/
   ▲ │                          user_identities/sync_operations/wardrobe_items/media_objects
   │ └──── products.style_id ─────────┐
   │                                  │
   ▼                                  ▼
  ┌──────────────────── products (3363) ────────────────────┐
  │  product_images (3378)    FK product_id → products.id   │
  │  price_snapshots (3390)   FK product_id → products.id   │
  │  product_releases (0)     FK product_id → products.id   │
  │  product_variants (0)     FK product_id → products.id   │
  │  sale_events (0)          FK product_id + source_id     │
  │  product_tags (0)         FK product_id + tag_id        │
  │  community_posts (0)      product_id 裸列（无 FK，0012）│
  └─────────────────────────────────────────────────────────┘
        │
        ▼
 source_records (3390) ◄── FK raw_data.source_record_id ── raw_data (0)
        │ ▲
        │ └── FK source_records.raw_data_id → raw_data.id（双向循环 FK）
        │
        ▼
 sale_events.source_id（0 行，无实际引用）
```

**关键 FK 事实（34 条 FK 全部列出）：**

| 子表.列 | 父表.列 | 状态 |
|---|---|---|
| products.brand_id | brands.id | ✅ |
| products.style_id | styles.id | ✅ |
| styles.brand_id | brands.id | ✅ |
| product_images.product_id | products.id | ✅ |
| price_snapshots.product_id | products.id | ✅ |
| product_releases.product_id | products.id | ✅ |
| product_variants.product_id | products.id | ✅ |
| sale_events.product_id | products.id | ✅ |
| sale_events.source_id | source_records.id | ✅ |
| product_tags.product_id / tag_id | products.id / tags.id | ✅ |
| raw_data.source_record_id | source_records.id | ✅（**循环**） |
| source_records.raw_data_id | raw_data.id | ✅（**循环**，全 NULL） |
| community_posts.product_id | — | ⚠️ 裸 text 列，**无 FK**（0012 有意设计） |
| price_snapshots.release_id | — | ⚠️ 裸 text 列，**无 FK**（0005） |
| wishlist_items.product_id / release_id | — | ⚠️ 裸列，无 FK |

**⚠️ 双向循环 FK：** raw_data.source_record_id ↔ source_records.raw_data_id 互为外键。插入必须先插一边再 UPDATE 另一边，鸡生蛋问题。实际使用中应只走单向（source_records.raw_data_id → raw_data.id），raw_data.source_record_id 列为死列（0 行、从未填充）。

## 2. 当前每张相关表的数据量（2026-08-21 实时查询）

| 表 | 行数 | 备注 |
|---|---|---|
| raw_data | **0** | Raw 层完全空壳（v5.27.0 审计结论再次证实） |
| source_records | 3390 | 全部 TAOBAO / entity_type='product'；raw_data_id 全 NULL |
| products | 3363 | 全部 published / ON_SALE / 软删 0 |
| product_images | 3378 | 比 products 多 15（重复导入残留） |
| price_snapshots | 3390 | 与 source_records 一一对应（重复导入也插） |
| brands | 252 | |
| styles | 1180 | products.style_id 非空 1391/3363（41.4%） |
| product_releases | 0 | |
| product_variants | 0 | |
| sale_events / product_tags / tags | 0 | |
| aliases | 31 | |
| community_posts / user_events / wishlist_items | 0 | |
| brand_followers | 1 | 唯一业务用户数据 |

## 3. 当前 Product 数据依赖关系（真实数据）

- **products.external_id = 淘宝 item_id 稳定身份已存在**：3363/3363 条 external_id 均为纯数字淘宝 item_id，distinct 3363 → 无重复。
- **唯一约束已就位**：`products_platform_external_unique (source_platform, external_id) WHERE external_id != '' AND deleted_at IS NULL` → **"同一个 item_id = 同一个 Product"机制已存在**，无需新增。
- 辅助唯一约束 `products_brand_canonical_unique (brand_id, canonical_name)`：同品牌同名不同 item_id 会冲突（import 脚本 catch 分支处理，见 §7 问题 10）。
- **source_records 无幂等约束**：3390 行 vs distinct(original_id, entity_id)=3363 → **27 组重复追加**（v5.27.0 P1 幂等问题实证）。
- **价格无语义**：products.current_price=100（1元）46 条 + =999900（9999元）45 条；标题含"意向金/定金"134 条；price_snapshots 同步污染（每条导入都插快照）。
- **deposit_price / balance_price / original_price 三列存在但全 0**（3363 条 0 使用）——价格拆分列 schema 已就绪，只差 Normalize 写入。
- **images 全单图**：3363/3363 条 `images` 数组长度=1，cover_url == images[1] 100%，product_images 每商品 1 行 is_cover=true。
- **style 关联基于旧数据**：1391 商品挂 1180 styles（Phase 2.5-A 按旧 canonical_name 聚类），重建 Product 后全部失效。

## 4. 实际安全删除顺序（按真实 FK，等用户确认后执行）

```
第 1 步  product_images (3378)   叶子，仅依赖 products
第 2 步  price_snapshots (3390)  叶子，仅依赖 products
第 3 步  product_releases (0)    叶子
第 4 步  product_variants (0)    叶子
第 5 步  sale_events (0)         叶子（依赖 products + source_records，须在 7 前）
第 6 步  product_tags / tags (0) 叶子
第 7 步  raw_data (0)            先于 source_records（它引用 source_records）
第 8 步  source_records (3390)   此时无子引用（sale_events/raw_data 已清）→ 安全
第 9 步  products (3363)         先置 style_id = NULL（或第 10 步前清 styles）
第 10 步 styles (1180)           products.style_id 已断后
第 11 步 brands (252)            【建议保留】店铺即 Brand 基础，Product V2 直接复用
                                 （被 products/styles/brand_followers 引用，最后才可清）
```

**注意：** 全部为数据清理（DELETE/TRUNCATE），**表结构全部保留**——product_releases/product_variants 等空表是后续 Style/Release 阶段的载体。brands 保留原因：252 个店铺是 Product V2 的 Brand 基础，重建商品仍需按 shop_name 关联（品牌变体归并是 Brand Normalize 机制的事，不是删数据的事）。

## 5. 新版 schema 差异

### 保留（结构不动）

| 对象 | 原因 |
|---|---|
| products.external_id + 唯一索引 | item_id 稳定身份机制，已满足要求 |
| products.deposit_price / balance_price / original_price | 价格拆分列已存在，等 Normalize 写入 |
| products.images[] 数组 | 多图容器已存在 |
| product_images 表 | 多图明细（url/sort_order/is_cover/phash），**不需要采集端判断 image_type** |
| price_snapshots.deposit_cents / balance_cents | 快照级定金/尾款列已存在 |
| raw_data 表 | parsed_json jsonb 可存采集 JSON 原文，raw_content 存原文——结构基本适合新版 Raw |
| source_records 表 | 溯源追踪，raw_data_id 列已存在 |
| brands / styles 表结构 | 保留，本阶段不重建 Style |

### 新增

| 对象 | 内容 |
|---|---|
| **import_batches 表**（当前不存在） | id / source / crawler_version / file_name / fetched_at / imported_at / total_records / success_records / failed_records / status（按用户 §12 建议） |
| raw_data.import_batch_id 列 | 关联 import_batch（FK），raw_data 可按批次追溯 |
| products.canonical_url 列 | 由 item_id 生成的稳定 URL（`https://item.taobao.com/item.htm?id=<item_id>`），不依赖 tracking URL 身份 |
| products.price_type 列（枚举） | FULL / DEPOSIT / BALANCE / INTENTION / UNKNOWN（用户 §6 要求，1元意向金必须标 INTENTION） |
| source_records 幂等唯一索引 | (source_type, original_id, entity_type, entity_id) 防重复追加（当前 27 组重复实证） |

### 修改

| 对象 | 修改 |
|---|---|
| raw_data.source_record_id | 建议停用（双向循环 FK 的死列），只保留 source_records.raw_data_id 单向引用 |
| import-taobao-products.ts | 全面改造（见 §7/§8） |

### 删除（数据级，表结构保留）

products / product_images / price_snapshots / source_records / styles 全部业务数据（§4 顺序）。**不删除任何表**，不做破坏性 DDL 迁移。

## 6. Raw → Normalize → Product 实际代码数据流（现状 vs 目标）

### 现状（import-taobao-products.ts 实际代码）

```
JSON (旧字段 title/current_price/main_image/product_url)
  → 品牌 upsert（shop_name → brands，ON CONFLICT (name,category)）
  → 商品 upsert（ON CONFLICT (source_platform, external_id)）
      title → canonical_name = display_name（零清洗）
      current_price → current_price（零语义，1元/9999元直接入库）
      main_image → cover_url + images[1] + product_images（单图）
      product_url → source_url（tracking URL 原样）
  → price_snapshots 插入（每次导入都插，含重复商品）
  → source_records 插入（无幂等，重复追加）
  ✗ 不写 raw_data
  ✗ 无 import_batch
  ✗ 无 Normalize 层（价格/标题/URL/购买语义全无）
  ✗ 无 canonical_url
```

### 目标（本阶段实现 Raw → Normalize → Product）

```
采集 JSON（冻结格式，title_raw/price_raw/url_raw/images[]/variants_raw/
           purchase_text_raw/shop_name/query_shop/shop_link/
           fetched_at/crawler_version/source）
  ↓ ① Raw 持久化（零处理、原样保真）
raw_data（parsed_json = 完整原始对象，raw_content = 文件原文 JSON 行，
         import_batch_id 关联批次；source 元数据存 source_type/source_url/fetched_at）
  ↓ ② Normalize（云端唯一业务解释层，纯函数，可重放可升级）
  title_raw        → display_name/canonical_name（清洗【意向金】【跳转】等营销前缀）
  price_raw        → current_price + deposit_price/balance_price/original_price
                     + price_type（FULL/DEPOSIT/BALANCE/INTENTION/UNKNOWN）
                     ⚠️ price_raw="1" + 标题含"意向金" → price_type=INTENTION，非 FULL
  url_raw          → source_url（保留 tracking 参数）+ canonical_url（item_id 生成）
  purchase_text_raw→ sale_status / preorder/balance 时间窗（本阶段至少 sale_status）
  pit_type         → 现有 inferPitType 复用（explicit > 标题正则 > categories）
  shop_name/query_shop → brands 复用/新建（query_shop=shop_name 100% 一致，可只信 shop_name）
  variants_raw     → product_variants（本阶段可留待 Style 阶段，schema 已支持）
  ↓ ③ Product（身份 = external_id=item_id，唯一索引已存在）
products + product_images（images[] 全量多图，is_cover=首图）
       + price_snapshots（含 deposit/balance cents）
       + source_records（raw_data_id 关联 + 幂等）
       + import_batches（批次统计）
```

**重放能力**：Raw 保留原始 JSON → 未来 Normalize 规则升级可全量重放（同 item_id upsert 覆盖）。

## 7. import-taobao-products.ts 当前问题清单（完整代码审计 436 行）

| # | 问题 | 严重度 | 证据 |
|---|---|---|---|
| 1 | **完全不写 raw_data** | 🔴 P0 | 全文件 0 处 raw_data；库内 raw_data 0 行、source_records.raw_data_id 全 NULL |
| 2 | **字段映射是旧格式** | 🔴 P0 | 读 item.title/current_price/main_image/product_url；新版 title_raw/price_raw/url_raw/images[]/variants_raw/purchase_text_raw 未适配 |
| 3 | **标题零清洗** | 🔴 P0 | canonical_name = title 原文；【意向金1元抵10元】直接入库（库内 134 条标题含意向金/定金） |
| 4 | **价格无语义** | 🔴 P0 | current_price 直接落库；46 条 1元=100分、45 条 9999元=999900分；无 price_type 概念 |
| 5 | **单图** | 🟡 P1 | 只读 main_image；images=[main_image]；product_images 只插 1 行 is_cover=true（库内 3363/3363 单图） |
| 6 | **无 import_batch** | 🟡 P1 | 无 import_batches 表、无批次记录 |
| 7 | **非事务** | 🟡 P1 | 逐商品写入无整体事务；中途失败=部分落库（products 3363 vs images 3378 vs source 3390 差异即非原子证据） |
| 8 | **source_records 重复追加** | 🟡 P1 | 无唯一约束；库内 27 组 (original_id,entity_id) 重复（3247 JSON → 3390 records） |
| 9 | **price_snapshots 重复插** | 🟡 P1 | 每次导入都插快照；重复商品也插（3390 = source_records 数） |
| 10 | **catch 分支掩盖真实错误** | 🟡 P1 | `products_brand_canonical_unique` 冲突（同品牌同名不同 item_id）时 catch 只 dbProducts++，**images/snapshot/source 全部丢失且无告警**；source_records_url_idx 分支同样吞错误 |
| 11 | **brands 变体假拆分隐患** | 🟡 P2 | shop_name 直接当品牌名（甜嗑系 7 变体问题根源，v5.26.0）；ON CONFLICT (name,category) 对同店跨品类会新建品牌 |
| 12 | **visibility 硬编码 published** | 🟡 P2 | 工作区未提交 diff 新增 `visibility_status='published'`（导入即发布，无审核流）；review_status 仍 PENDING 自相矛盾 |
| 13 | **无 canonical_url** | 🟡 P2 | 只有 tracking source_url；身份靠 external_id（已 OK），但 canonical URL 未生成 |
| 14 | **--file 参数未实现** | ⚪ P3 | v2.5 文档声称支持 --file，代码只有位置参数 jsonPath |
| 15 | **URL 截断 2000 字符写 source_records** | ⚪ P3 | btree 2704 限制妥协，url_raw 超长时信息丢失（canonical_url 可根治） |

## 8. 是否需要 migration

**需要，1 个新迁移 `0013_product_v2.sql`（纯增量，无 DROP/TRUNCATE）：**

```sql
-- 1. import_batches 表（用户 §12 字段清单）
CREATE TABLE import_batches (
  id              text PRIMARY KEY,
  source          text NOT NULL,              -- 'TAOBAO'
  crawler_version text NOT NULL DEFAULT '',
  file_name       text NOT NULL DEFAULT '',
  fetched_at      timestamptz,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  total_records   integer NOT NULL DEFAULT 0,
  success_records integer NOT NULL DEFAULT 0,
  failed_records  integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. raw_data 关联批次
ALTER TABLE raw_data ADD COLUMN IF NOT EXISTS import_batch_id text
  REFERENCES import_batches(id);

-- 3. products 稳定 URL + 价格语义
ALTER TABLE products ADD COLUMN IF NOT EXISTS canonical_url text NOT NULL DEFAULT '';
-- price_type 枚举（FULL/DEPOSIT/BALANCE/INTENTION/UNKNOWN）
DO $$ BEGIN
  CREATE TYPE price_type AS ENUM ('FULL','DEPOSIT','BALANCE','INTENTION','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_type price_type NOT NULL DEFAULT 'UNKNOWN';

-- 4. source_records 幂等（防重复追加）
CREATE UNIQUE INDEX IF NOT EXISTS source_records_dedup_uniq
  ON source_records (source_type, original_id, entity_type, entity_id);

-- 5. raw_data 检索索引
CREATE INDEX IF NOT EXISTS raw_data_batch_idx ON raw_data (import_batch_id);
```

**不做的 migration：** 无 DROP TABLE / TRUNCATE / 大规模 UPDATE。数据清理走独立脚本（§4 顺序，等用户确认）。

## 9. migration 将修改的具体表和字段

| 表 | 操作 | 字段 |
|---|---|---|
| import_batches | 新建 | 全部 11 列 |
| raw_data | 加列 | import_batch_id (FK) + 索引 |
| products | 加列 | canonical_url、price_type（含新枚举类型 price_type） |
| source_records | 加索引 | source_records_dedup_uniq 唯一索引 |
| （无表被删除/清空） | | |

## 10. 最终 destructive SQL / migration 影响范围

**破坏性操作仅限数据清理（用户确认后单独执行，不进 migration 文件）：**

| 步骤 | 表 | 行数 | 影响 |
|---|---|---|---|
| 1 | product_images | 3378 | Feed 详情图全清，重建后由 images[] 重灌 |
| 2 | price_snapshots | 3390 | 价格历史全清（旧数据无语义价值） |
| 3-6 | product_releases/variants/sale_events/product_tags/tags | 0 | 无影响 |
| 7 | raw_data | 0 | 无影响 |
| 8 | source_records | 3390 | 溯源记录全清（重建时按幂等重插） |
| 9 | products | 3363 | **Feed/搜索/详情商品全清**（用户已明确不保留旧商品数据） |
| 10 | styles | 1180 | Style 聚类全清（旧 canonical_name 聚类，重建 Product 后失效；表结构保留待后续阶段） |
| 11 | brands | 252 | **保留**（店铺=Brand 基础） |

**影响面：**
- API 侧：清理执行期间（或之后重建前）Feed/搜索返回空数组——需在重建脚本完成后统一验证（feed totalHint=0 → 重建后恢复）。
- 用户数据：brand_followers 1 条（品牌保留则不受影响）；user_assets 4 条（独立于商品，不受影响）；wishlist_items 0 条（无影响）。
- 采集端：零修改（update_shops.py / run_detect_all.py / taobao_cli.py 冻结不动）。
- 旧字段垃圾：products 的 category(全空)/sub_category/style_tags 等旧列**保留表结构**但新数据不再依赖（用户 §11 要求不为此保留垃圾——列为空即自然废弃，无需 DDL 删除）。

---

## 待用户确认事项

1. **数据清理方案**：§4 删除顺序 + §10 影响范围（products 3363 / source_records 3390 / price_snapshots 3390 / product_images 3378 / styles 1180 全清，brands 252 保留）——是否确认？
2. **migration 0013**：§8/§9 纯增量方案（import_batches + raw_data.import_batch_id + products.canonical_url/price_type + source_records 幂等索引）——是否确认？
3. **styles 清理**：styles 数据跟随旧商品清空（表结构保留），确认？
4. **import-taobao-products.ts 改造**：§6 目标数据流 + §7 问题修复（Raw 持久化 / Normalize 层 / 多图 / 批次 / 事务 / 幂等 / canonical_url / price_type）——进入 Implementation 后按此执行。

Stage 0 只读审计到此停止，等待确认。
