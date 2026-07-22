-- Phase D5.2: Full Crawl / Backfill Strategy
-- 1. crawl_jobs 新增 crawl_mode
-- 2. 新增 brand_crawl_policies 表

-- ============================================================
-- 1. 枚举类型：采集模式
-- ============================================================

DO $$ BEGIN
  CREATE TYPE crawl_mode AS ENUM ('incremental', 'full', 'backfill', 'manual');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. crawl_jobs 新增 crawl_mode 字段
-- ============================================================

ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS crawl_mode crawl_mode NOT NULL DEFAULT 'incremental';

-- ============================================================
-- 3. brand_crawl_policies 表（品牌采集策略）
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_crawl_policies (
  id                        text PRIMARY KEY,
  brand_id                  text NOT NULL REFERENCES brands(id),
  source_type               text NOT NULL DEFAULT 'OFFICIAL',
  source_url                text NOT NULL DEFAULT '',
  crawl_enabled             boolean NOT NULL DEFAULT false,
  incremental_interval_hours integer NOT NULL DEFAULT 24,
  full_interval_days        integer NOT NULL DEFAULT 30,
  backfill_enabled          boolean NOT NULL DEFAULT false,
  priority                  integer NOT NULL DEFAULT 0,
  last_incremental_crawled_at timestamp with time zone,
  last_full_crawled_at      timestamp with time zone,
  last_backfill_crawled_at  timestamp with time zone,
  created_at                timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                timestamp with time zone NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_crawl_policies_brand ON brand_crawl_policies (brand_id);
CREATE INDEX IF NOT EXISTS idx_crawl_policies_enabled ON brand_crawl_policies (crawl_enabled, priority DESC) WHERE crawl_enabled = true;

-- 唯一约束：同品牌 + 同来源类型 不重复
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_policies_unique ON brand_crawl_policies (brand_id, source_type);
