-- Phase D5.1: Release Batch & Product Lifecycle Modeling
-- 新增表：product_releases（发售批次）
-- 修改表：price_snapshots（新增 release_id 关联）

-- ============================================================
-- 1. 枚举类型
-- ============================================================

DO $$ BEGIN
  CREATE TYPE release_type AS ENUM ('first_release', 'rerelease', 'reservation', 'spot', 'lottery', 'unknown');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. product_releases 表
-- ============================================================

CREATE TABLE IF NOT EXISTS product_releases (
  id                text PRIMARY KEY,
  product_id        text NOT NULL REFERENCES products(id),
  release_name      text NOT NULL DEFAULT '',
  release_no        integer NOT NULL DEFAULT 0,          -- 批次序号（0=未知）
  release_type      release_type NOT NULL DEFAULT 'unknown',
  sale_status       sale_status NOT NULL DEFAULT 'UPCOMING',
  deposit_price_cents integer NOT NULL DEFAULT 0,        -- 定金（分）
  balance_price_cents integer NOT NULL DEFAULT 0,        -- 尾款（分）
  full_price_cents  integer NOT NULL DEFAULT 0,          -- 全价（分）
  start_at          timestamp with time zone,             -- 预约/开售开始时间
  end_at            timestamp with time zone,             -- 预约/开售结束时间
  balance_due_at    timestamp with time zone,             -- 尾款截止时间
  ship_at           timestamp with time zone,             -- 预计发货时间
  is_rerelease      boolean NOT NULL DEFAULT false,      -- 是否再贩
  is_sold_out       boolean NOT NULL DEFAULT false,      -- 是否售罄
  source_url        text NOT NULL DEFAULT '',
  visibility_status visibility_status NOT NULL DEFAULT 'draft',
  review_status     review_status NOT NULL DEFAULT 'PENDING',
  confidence        integer NOT NULL DEFAULT 100,
  lifecycle_status  text NOT NULL DEFAULT 'unknown',     -- upcoming/active/ended/sold_out
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at        timestamp with time zone
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_releases_product ON product_releases (product_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_releases_status ON product_releases (visibility_status, sale_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_releases_lifecycle ON product_releases (lifecycle_status) WHERE deleted_at IS NULL;

-- 唯一约束：同 product + 同 release_no + 同 release_type 不重复
-- 注意：release_no=0 时允许重复（未知批次）
CREATE UNIQUE INDEX IF NOT EXISTS idx_releases_dedup
  ON product_releases (product_id, release_no, release_type)
  WHERE deleted_at IS NULL AND release_no > 0;

-- ============================================================
-- 3. price_snapshots 新增 release_id
-- ============================================================

ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS release_id text;

-- 索引：按 release 查询价格快照
CREATE INDEX IF NOT EXISTS idx_snapshots_release ON price_snapshots (release_id) WHERE release_id IS NOT NULL;
