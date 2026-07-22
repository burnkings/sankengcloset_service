-- Phase D4.1: 商品发布状态
-- 新增 visibility_status 枚举和字段
-- 控制商品是否进入 Feed API

-- ============================================================
-- 1. 枚举类型：可见性状态
-- ============================================================

DO $$ BEGIN
  CREATE TYPE visibility_status AS ENUM ('draft', 'reviewing', 'published', 'hidden');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. products 表新增 visibility_status 字段
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS visibility_status visibility_status NOT NULL DEFAULT 'draft';

-- ============================================================
-- 3. 已有种子数据标记为 published（人工审核通过的）
-- ============================================================

UPDATE products SET visibility_status = 'published' WHERE review_status = 'APPROVED' AND source_platform = 'ADMIN';

-- ============================================================
-- 4. 采集数据保持 draft（禁止直接进入 Feed）
-- ============================================================
-- 无需操作，默认值已经是 'draft'

-- ============================================================
-- 5. 索引：按 visibility_status 查询 Feed
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_products_visibility ON products (visibility_status) WHERE deleted_at IS NULL;
