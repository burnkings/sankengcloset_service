-- Phase D7: Content Data Platform
-- 搜索支持 + 内容聚合视图 + 趋势数据查询基础

-- ============================================================
-- 1. 全文搜索支持（pg_trgm）
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 商品名 + 品牌名 的 GIN 索引，用于模糊搜索
-- (0002 重建的 products 无 title/brand_name 列，按实际查询列对齐)
CREATE INDEX IF NOT EXISTS idx_products_title_trgm
  ON products USING gin (canonical_name gin_trgm_ops)
  WHERE deleted_at IS NULL AND visibility_status = 'published';

CREATE INDEX IF NOT EXISTS idx_brands_name_trgm
  ON brands USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ============================================================
-- 2. 内容聚合视图（product + brand + release + price + score）
-- ============================================================

CREATE OR REPLACE VIEW v_content_feed AS
SELECT
  p.id AS product_id,
  p.brand_id,
  COALESCE(b.name, p.canonical_name) AS brand_name,
  p.canonical_name AS title,
  p.category,
  p.cover_url,
  p.shop_id,
  p.current_price AS price_cents,
  p.original_price AS original_price_cents,
  p.sale_status,
  p.feed_score,
  p.season_tags,
  p.scene_tags,
  p.element_tags,
  p.recommended_tags,
  p.visibility_status,
  p.review_status,
  p.created_at,
  p.updated_at,
  -- 最新 release 信息
  r.id AS release_id,
  r.release_type,
  r.release_name,
  r.deposit_price_cents,
  r.balance_price_cents,
  r.full_price_cents,
  r.start_at AS release_start_at,
  r.end_at AS release_end_at,
  r.is_rerelease,
  r.is_sold_out,
  r.lifecycle_status AS release_lifecycle,
  -- 最新价格快照
  ps.price_cents AS snapshot_price,
  ps.fetched_at AS price_captured_at
FROM products p
LEFT JOIN brands b ON b.id = p.brand_id
LEFT JOIN LATERAL (
  SELECT *
  FROM product_releases pr
  WHERE pr.product_id = p.id AND pr.deleted_at IS NULL
  ORDER BY pr.created_at DESC
  LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT *
  FROM price_snapshots
  WHERE product_id = p.id
  ORDER BY fetched_at DESC
  LIMIT 1
) ps ON true
WHERE p.deleted_at IS NULL
  AND p.visibility_status = 'published';

-- ============================================================
-- 3. 搜索索引优化
-- ============================================================

-- 品牌ID + 发售状态复合索引
CREATE INDEX IF NOT EXISTS idx_products_brand_sale
  ON products (brand_id, sale_status)
  WHERE deleted_at IS NULL AND visibility_status = 'published';

-- 价格范围查询索引
CREATE INDEX IF NOT EXISTS idx_products_price
  ON products (current_price)
  WHERE deleted_at IS NULL AND visibility_status = 'published' AND current_price > 0;

-- feed_score 排序索引（已有，确认存在）
CREATE INDEX IF NOT EXISTS idx_products_feed_score_published
  ON products (feed_score DESC)
  WHERE deleted_at IS NULL AND visibility_status = 'published';
