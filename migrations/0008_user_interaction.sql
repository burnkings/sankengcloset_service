-- Phase D8: User Interaction & Personalization Foundation
-- 用户行为事件 + 品牌关注 + 收藏升级 + 个性化评分

-- ============================================================
-- 1. 用户行为事件表
-- ============================================================

CREATE TABLE IF NOT EXISTS user_events (
  id          text PRIMARY KEY,
  user_id     text,                            -- 可空（匿名用户）
  event_type  text NOT NULL CHECK (event_type IN (
    'VIEW_PRODUCT', 'VIEW_RELEASE', 'LIKE_PRODUCT', 'SAVE_PRODUCT',
    'FOLLOW_BRAND', 'SEARCH', 'SHARE', 'CLICK_PRICE_ALERT', 'CLICK_BUY'
  )),
  target_type text NOT NULL,                   -- product / release / brand / search
  target_id   text NOT NULL DEFAULT '',
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 按用户+事件类型查询（个性化评分用）
CREATE INDEX IF NOT EXISTS idx_events_user_type
  ON user_events (user_id, event_type, created_at DESC)
  WHERE user_id IS NOT NULL;

-- 按目标查询（热度统计用）
CREATE INDEX IF NOT EXISTS idx_events_target
  ON user_events (target_type, target_id, created_at DESC);

-- 匿名事件（无 user_id）
CREATE INDEX IF NOT EXISTS idx_events_anon
  ON user_events (event_type, created_at DESC)
  WHERE user_id IS NULL;

-- ============================================================
-- 2. 品牌关注表
-- ============================================================

CREATE TABLE IF NOT EXISTS brand_followers (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_brand_followers_brand
  ON brand_followers (brand_id, created_at DESC);

-- ============================================================
-- 3. 收藏体系升级（wishlist_items 新增字段）
-- ============================================================

ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS release_id text;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 状态扩展：兼容已有 WISH，新增 WANT / WATCHING / WAIT_RELEASE / WAIT_PRICE / PURCHASED
-- 已有 CHECK 限制，需要先 drop 再 add
DO $$ BEGIN
  ALTER TABLE wishlist_items DROP CONSTRAINT IF EXISTS wishlist_items_status_check;
  ALTER TABLE wishlist_items ADD CONSTRAINT wishlist_items_status_check
    CHECK (status IN ('WISH', 'WANT', 'WATCHING', 'WAIT_RELEASE', 'WAIT_PRICE', 'PURCHASED'));
EXCEPTION WHEN undefined_object THEN null;
END $$;

-- 按 product_id 查询（判断是否已收藏）
CREATE INDEX IF NOT EXISTS idx_wishlist_product
  ON wishlist_items (user_id, product_id)
  WHERE product_id IS NOT NULL;

-- ============================================================
-- 4. Personal Score 辅助索引
-- ============================================================

-- 用户关注的品牌
CREATE INDEX IF NOT EXISTS idx_followed_brands
  ON brand_followers (user_id)
  WHERE user_id IS NOT NULL;
