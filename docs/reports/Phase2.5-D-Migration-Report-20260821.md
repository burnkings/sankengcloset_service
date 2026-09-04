# Phase 2.5-D Migration Report — 0013_product_v2.sql

- 日期: 2026-08-21
- 数据库: 生产库 127.0.0.1:5433 (sankeng-pg_postgres_1)
- 前置备份: /tmp/sankeng-pre-0013.dump (pg_dump -Fc, 2.4MB)
- 状态: ✅ 已应用并验证

## 1. 变更内容

| 变更 | 对象 | 详情 |
|---|---|---|
| 新建表 | import_batches | id/source/crawler_version/file_name/fetched_at/imported_at/total_records/success_records/failed_records/status/created_at |
| 加列 | raw_data.import_batch_id | FK → import_batches(id)，关联导入批次 |
| 加列 | products.canonical_url | 由 item_id 生成的稳定 URL（text NOT NULL DEFAULT ''） |
| 加列 | products.price_type | 新枚举 price_type: FULL/DEPOSIT/BALANCE/INTENTION/UNKNOWN，默认 UNKNOWN |
| 新枚举 | price_type | FULL / DEPOSIT / BALANCE / INTENTION / UNKNOWN |
| 唯一索引 | source_records_dedup_uniq | (source_type, original_id, entity_type, entity_id) 防重复追加 |
| 普通索引 | raw_data_batch_idx | raw_data(import_batch_id) |
| 普通索引 | raw_data_source_idx2 | raw_data(source_type, fetched_at) |

## 2. 执行记录

1. `sudo docker exec sankeng-pg_postgres_1 pg_dump ... -Fc -f /tmp/sankeng-pre-0013.dump` → 备份成功 (2.4MB)
2. 首次执行 `node --env-file=.env.production --import tsx scripts/migrate.ts` → **失败 23505**：唯一索引与存量 27 组重复 source_records 冲突（Stage 0 已审计发现的重复追加问题）。migration 事务回滚，schema_migrations 未记录。
3. 修复：在 0013 建唯一索引前增加去重步骤（`DELETE ... USING ... WHERE a.id > b.id AND 四键相等`，保留每组最早一条）。这 27 条重复属于已确认清理的旧商品链数据（用户确认清理 source_records 3390 行），无业务损失。
4. 重新执行 → ✅ Applied migrations/0013_product_v2.sql

## 3. 验证结果（真实查询）

| 检查项 | 结果 |
|---|---|
| schema_migrations 记录 0013 | ✅ |
| import_batches 表存在 | ✅ |
| raw_data.import_batch_id 列 | ✅ |
| products.canonical_url 列 | ✅ |
| products.price_type 列 | ✅ |
| price_type 枚举 5 值 | ✅ FULL/DEPOSIT/BALANCE/INTENTION/UNKNOWN |
| source_records_dedup_uniq | ✅ |
| raw_data_batch_idx / raw_data_source_idx2 | ✅ |
| 去重后 source_records | 3390 → 3363（重复组 0） |

## 4. 与 Stage 0 报告差异

- Stage 0 方案与实施一致，仅一处补充：唯一索引建立前需先清存量重复行（27 条），已在 migration 内以幂等去重实现，不改变表结构方案。

## 5. 数据清理（用户确认项 1 + 3）

按确认的 FK 顺序单事务 DELETE 执行：

| 表 | 清理前 | 清理后 |
|---|---|---|
| product_images | 3378 | 0 |
| price_snapshots | 3390 | 0 |
| product_releases | 0 | 0 |
| product_variants | 0 | 0 |
| sale_events | 0 | 0 |
| product_tags / tags | 0 | 0 |
| raw_data | 0 | 0 |
| source_records | 3363 | 0 |
| products | 3363 | 0 |
| styles | 1180 | 0 |

保护数据（清理前后不变，验证通过）：
- brands: 252 ✅
- brand_followers: 1 ✅
- user_assets: 4 ✅
- users: 1 ✅

表结构全部保留（styles/product_releases/product_variants 等为后续 Style/Release 阶段载体）。
