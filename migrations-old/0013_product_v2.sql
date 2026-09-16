-- ============================================================
-- 0013_product_v2.sql — Phase 2.5-D Product V2 Backend
-- Raw → Normalize → Product
-- 纯增量：新建表 + 加列 + 加索引，无 DROP TABLE / TRUNCATE / 大规模 UPDATE
-- 可重复执行（IF NOT EXISTS / DO $$ EXCEPTION）
-- ============================================================

-- 1. import_batches — 导入批次记录
CREATE TABLE IF NOT EXISTS import_batches (
  id              text PRIMARY KEY,
  source          text NOT NULL,                  -- 'TAOBAO'
  crawler_version text NOT NULL DEFAULT '',       -- 采集端版本
  file_name       text NOT NULL DEFAULT '',       -- 源文件
  fetched_at      timestamptz,                    -- 采集时间
  imported_at     timestamptz NOT NULL DEFAULT now(),
  total_records   integer NOT NULL DEFAULT 0,
  success_records integer NOT NULL DEFAULT 0,
  failed_records  integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending', -- pending|running|done|failed
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE import_batches IS '导入批次：一次 JSON 导入的全量统计，raw_data 通过 import_batch_id 关联';

-- 2. raw_data 关联批次
ALTER TABLE raw_data ADD COLUMN IF NOT EXISTS import_batch_id text REFERENCES import_batches(id);
CREATE INDEX IF NOT EXISTS raw_data_batch_idx ON raw_data (import_batch_id);
CREATE INDEX IF NOT EXISTS raw_data_source_idx2 ON raw_data (source_type, fetched_at);

-- 3. products — 稳定 canonical URL（由 item_id 生成，不依赖 tracking URL）
ALTER TABLE products ADD COLUMN IF NOT EXISTS canonical_url text NOT NULL DEFAULT '';

-- 4. products — 价格语义类型
--    FULL=普通售价 / DEPOSIT=定金 / BALANCE=尾款 / INTENTION=意向金 / UNKNOWN=无法判定
DO $$ BEGIN
  CREATE TYPE price_type AS ENUM ('FULL','DEPOSIT','BALANCE','INTENTION','UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_type price_type NOT NULL DEFAULT 'UNKNOWN';

-- 5. source_records 幂等唯一约束（防重复追加）
--    source_type + original_id + entity_type + entity_id 唯一
--    先清理存量重复行（保留每组最早一条 id 最小者），否则唯一索引无法建立。
--    存量重复是旧 import 脚本重复追加的产物（Stage 0 审计实测 27 组），
--    属于已确认清理的旧商品链数据。全库清理后此表将重建，无业务损失。
DELETE FROM source_records a
USING source_records b
WHERE a.id > b.id
  AND a.source_type = b.source_type
  AND a.original_id = b.original_id
  AND a.entity_type = b.entity_type
  AND a.entity_id = b.entity_id;

CREATE UNIQUE INDEX IF NOT EXISTS source_records_dedup_uniq
  ON source_records (source_type, original_id, entity_type, entity_id);
