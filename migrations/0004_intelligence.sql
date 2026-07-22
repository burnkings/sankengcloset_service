-- Phase D5: Product Intelligence Layer
-- 新增字段：商品智能标签、品牌画像、Feed 评分
-- 不修改现有字段，向后兼容

-- ============================================================
-- 1. products 表新增智能标签字段
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS season_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS scene_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS element_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS recommended_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS feed_score integer NOT NULL DEFAULT 0;

-- ============================================================
-- 2. brands 表新增品牌画像字段
-- ============================================================

ALTER TABLE brands ADD COLUMN IF NOT EXISTS heat_score integer NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS update_frequency_days integer NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS avg_price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS popular_series text[] NOT NULL DEFAULT '{}';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS release_cycle_days integer NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS brand_status text NOT NULL DEFAULT 'active';

-- ============================================================
-- 3. 索引
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_products_feed_score ON products (feed_score DESC) WHERE deleted_at IS NULL AND visibility_status = 'published';
CREATE INDEX IF NOT EXISTS idx_brands_heat_score ON brands (heat_score DESC) WHERE deleted_at IS NULL;
