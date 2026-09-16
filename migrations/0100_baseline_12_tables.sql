-- 0100_baseline_12_tables.sql
-- New 12-table baseline: DROP old business tables, CREATE new schema.
-- This is the new baseline. All old migrations are superseded.

BEGIN;
SET LOCAL search_path TO public;

-- ─── Drop old business tables (explicit names, no CASCADE) ────────────
DROP TABLE IF EXISTS ai_import_confirmations;
DROP TABLE IF EXISTS ai_import_suggestions;
DROP TABLE IF EXISTS community_post_likes;
DROP TABLE IF EXISTS brand_followers;
DROP TABLE IF EXISTS wishlist_items;
DROP TABLE IF EXISTS price_snapshots;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS styles;
DROP TABLE IF EXISTS sale_events;
DROP TABLE IF EXISTS user_identities;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS user_events;
DROP TABLE IF EXISTS sync_operations;
DROP TABLE IF EXISTS aliases;
DROP TABLE IF EXISTS schema_migrations;

-- Also drop any old product/brand columns that no longer exist
-- (handled by CREATE TABLE which defines fresh structure)

-- ─── 1. users ─────────────────────────────────────────────────────────
CREATE TABLE users (
  id text PRIMARY KEY,
  nickname text NOT NULL,
  login_provider text,
  login_subject text,
  preferences_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(preferences_json)='object'),
  budget_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(budget_json)='object'),
  UNIQUE(login_provider,login_subject),
  CHECK ((login_provider IS NULL) = (login_subject IS NULL)),
  avatar_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS '应用账号；与 Directus 管理员账号分离';
COMMENT ON COLUMN users.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN users.nickname IS '昵称';
COMMENT ON COLUMN users.avatar_url IS '头像地址';
COMMENT ON COLUMN users.status IS '账号状态';
COMMENT ON COLUMN users.created_at IS '创建时间';
COMMENT ON COLUMN users.updated_at IS '修改时间';
COMMENT ON COLUMN users.login_provider IS '当前单一登录提供方';
COMMENT ON COLUMN users.login_subject IS '提供方唯一用户标识';
COMMENT ON COLUMN users.preferences_json IS '主题及推荐偏好，不重复存关注关系';
COMMENT ON COLUMN users.budget_json IS '预算配置，金额整数分';

-- ─── 2. user_sessions ─────────────────────────────────────────────────
CREATE TABLE user_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  refresh_token_hash text NOT NULL UNIQUE,
  device_id text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_sessions IS '刷新令牌会话';

-- ─── 3. brands ────────────────────────────────────────────────────────
CREATE TABLE brands (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name))>0),
  name_en text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN ('JK','LOLITA','HANFU','OTHER')),
  logo_url text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  official_url text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  popular_series text[] NOT NULL DEFAULT '{}',
  brand_status text NOT NULL DEFAULT 'active' CHECK (brand_status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE brands IS '品牌目录，不以店铺名自动创建品牌';

-- ─── 4. products ──────────────────────────────────────────────────────
CREATE TABLE products (
  id text PRIMARY KEY,
  title text NOT NULL CHECK(length(btrim(title))>0),
  brand_id text REFERENCES brands(id),
  shop_name text NOT NULL DEFAULT '',
  category text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','OTHER')),
  sub_category text NOT NULL DEFAULT '',
  group_key text,
  images jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(images)='array'),
  variants jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(variants)='array'),
  view_count bigint NOT NULL DEFAULT 0 CHECK(view_count>=0),
  reviewed_by text REFERENCES users(id),
  reviewed_at timestamptz,
  description text NOT NULL DEFAULT '',
  sale_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_status IN ('UPCOMING','ON_SALE','PRE_ORDER','SOLD_OUT','ENDED','UNKNOWN')),
  price_cents integer CHECK(price_cents>=0),
  price_type text NOT NULL DEFAULT 'UNKNOWN' CHECK(price_type IN ('FULL','DEPOSIT','BALANCE','INTENTION','UNKNOWN')),
  original_price_cents integer CHECK(original_price_cents>=0),
  currency text NOT NULL DEFAULT 'CNY',
  source_platform text NOT NULL,
  external_id text,
  canonical_url text NOT NULL,
  color_tags text[] NOT NULL DEFAULT '{}',
  material_tags text[] NOT NULL DEFAULT '{}',
  style_tags text[] NOT NULL DEFAULT '{}',
  season_tags text[] NOT NULL DEFAULT '{}',
  scene_tags text[] NOT NULL DEFAULT '{}',
  element_tags text[] NOT NULL DEFAULT '{}',
  recommended_tags text[] NOT NULL DEFAULT '{}',
  feed_score integer NOT NULL DEFAULT 0,
  visibility_status text NOT NULL DEFAULT 'draft' CHECK(visibility_status IN ('draft','reviewing','published','hidden')),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE products IS '商品介绍主表；一个来源商品链接一个 ID';
COMMENT ON COLUMN products.title IS '唯一正式名称，替代 canonical_name/display_name';
COMMENT ON COLUMN products.images IS '有序图片对象数组，第一张封面';
COMMENT ON COLUMN products.variants IS '展示规格对象数组';
COMMENT ON COLUMN products.group_key IS '同款归组键';

-- ─── 5. product_releases ──────────────────────────────────────────────
CREATE TABLE product_releases (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  release_name text NOT NULL DEFAULT '',
  release_no integer NOT NULL CHECK(release_no>0),
  release_type text NOT NULL DEFAULT 'unknown' CHECK(release_type IN ('first_release','rerelease','reservation','spot','lottery','unknown')),
  sale_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_status IN ('UPCOMING','ON_SALE','PRE_ORDER','SOLD_OUT','ENDED','UNKNOWN')),
  deposit_cents integer CHECK(deposit_cents>=0),
  balance_cents integer CHECK(balance_cents>=0),
  full_price_cents integer CHECK(full_price_cents>=0),
  start_at timestamptz,
  end_at timestamptz,
  balance_due_at timestamptz,
  ship_at timestamptz,
  CHECK(end_at IS NULL OR start_at IS NULL OR end_at>=start_at),
  shipping_note text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  visibility_status text NOT NULL DEFAULT 'draft' CHECK(visibility_status IN ('draft','reviewing','published','hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(id,product_id),
  UNIQUE(product_id,release_no)
);
COMMENT ON TABLE product_releases IS '同一商品的不同发售批次';

-- ─── 6. user_assets ───────────────────────────────────────────────────
CREATE TABLE user_assets (
  user_id text NOT NULL REFERENCES users(id),
  asset_type text NOT NULL CHECK(asset_type IN ('wardrobe','purchase','reminder','wish','notification')),
  id text NOT NULL,
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY(user_id,asset_type,id)
);
COMMENT ON TABLE user_assets IS '个人衣橱/购买/提醒/手写心愿/通知的唯一存储';

-- ─── 7. media_objects ─────────────────────────────────────────────────
CREATE TABLE media_objects (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(id),
  object_key text NOT NULL UNIQUE,
  upload_id text NOT NULL UNIQUE,
  purpose text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK(size_bytes>=0),
  uploaded_at timestamptz,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE media_objects IS '用户上传图片';

-- ─── 8. community_posts ───────────────────────────────────────────────
CREATE TABLE community_posts (
  id text PRIMARY KEY,
  author_user_id text NOT NULL REFERENCES users(id),
  media_id text NOT NULL REFERENCES media_objects(id),
  caption text NOT NULL DEFAULT '' CHECK(length(caption)<=600),
  category text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','MIXED')),
  topic text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
  product_id text REFERENCES products(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE community_posts IS '轻社区动态；当前接口一帖一图';

-- ─── 9. user_interactions ─────────────────────────────────────────────
CREATE TABLE user_interactions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('PRODUCT_FAVORITE','BRAND_FOLLOW','POST_LIKE')),
  product_id text REFERENCES products(id),
  brand_id text REFERENCES brands(id),
  post_id text REFERENCES community_posts(id) ON DELETE CASCADE,
  release_id text,
  intent_status text CHECK(intent_status IN ('WANT','WATCHING','WAIT_RELEASE','WAIT_BALANCE','PURCHASED')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(release_id,product_id) REFERENCES product_releases(id,product_id),
  CHECK (
    (kind='PRODUCT_FAVORITE' AND product_id IS NOT NULL AND brand_id IS NULL AND post_id IS NULL)
    OR (kind='BRAND_FOLLOW' AND brand_id IS NOT NULL AND product_id IS NULL AND post_id IS NULL
        AND release_id IS NULL AND intent_status IS NULL AND note='')
    OR (kind='POST_LIKE' AND post_id IS NOT NULL AND product_id IS NULL AND brand_id IS NULL
        AND release_id IS NULL AND intent_status IS NULL AND note='')
  )
);
COMMENT ON TABLE user_interactions IS '当前三种用户互动';
CREATE UNIQUE INDEX interactions_product_unique ON user_interactions(user_id,product_id) WHERE kind='PRODUCT_FAVORITE';
CREATE UNIQUE INDEX interactions_brand_unique ON user_interactions(user_id,brand_id) WHERE kind='BRAND_FOLLOW';
CREATE UNIQUE INDEX interactions_post_unique ON user_interactions(user_id,post_id) WHERE kind='POST_LIKE';
CREATE INDEX interactions_user ON user_interactions(user_id,kind,created_at DESC,id);
CREATE INDEX interactions_product_count ON user_interactions(product_id) WHERE kind='PRODUCT_FAVORITE';
CREATE INDEX interactions_brand_count ON user_interactions(brand_id) WHERE kind='BRAND_FOLLOW';
CREATE INDEX interactions_post_count ON user_interactions(post_id) WHERE kind='POST_LIKE';

-- ─── 10. ai_import_tasks ──────────────────────────────────────────────
CREATE TABLE ai_import_tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  media_id text REFERENCES media_objects(id) ON DELETE SET NULL,
  state text NOT NULL,
  request_id text NOT NULL,
  task_type text NOT NULL DEFAULT 'purchase_order',
  model_provider text NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL DEFAULT '',
  source_platform text NOT NULL DEFAULT '',
  source_link text NOT NULL DEFAULT '',
  suggestion_json jsonb,
  confidence double precision CHECK(confidence BETWEEN 0 AND 1),
  field_confidence_json jsonb NOT NULL DEFAULT '{}',
  evidence_json jsonb NOT NULL DEFAULT '[]',
  warnings_json jsonb NOT NULL DEFAULT '[]',
  confirmed_json jsonb,
  correction_json jsonb,
  confirmation_op_id text,
  target_id text,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,confirmation_op_id),
  CHECK(confirmation_op_id IS NULL OR length(confirmation_op_id)>0)
);
COMMENT ON TABLE ai_import_tasks IS '合并建议和确认记录';

-- ─── 11. feedback_records ─────────────────────────────────────────────
CREATE TABLE feedback_records (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  type text NOT NULL,
  content text NOT NULL,
  contact text NOT NULL DEFAULT '',
  images text[] NOT NULL DEFAULT '{}',
  target_type text,
  target_id text,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE feedback_records IS '反馈及举报共用';

-- ─── 12. schema_migrations ────────────────────────────────────────────
CREATE TABLE schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE schema_migrations IS '仅记录新基线及后续实际执行过的迁移';

-- ─── Indexes ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX brands_live_name ON brands(name,category) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_live_source ON products(source_platform,external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX products_live_url ON products(canonical_url) WHERE deleted_at IS NULL;
CREATE INDEX products_feed ON products(category,feed_score DESC,id) WHERE deleted_at IS NULL AND visibility_status='published';
CREATE INDEX products_brand ON products(brand_id,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX products_group ON products(group_key) WHERE deleted_at IS NULL;
CREATE INDEX releases_product ON product_releases(product_id,release_no DESC) WHERE deleted_at IS NULL;
CREATE INDEX assets_user ON user_assets(user_id,asset_type,updated_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX assets_purchase_reminders ON user_assets(user_id,(payload_json->>'relatedPurchaseId')) WHERE asset_type='reminder' AND deleted_at IS NULL;
CREATE INDEX community_public ON community_posts(created_at DESC,id DESC) WHERE deleted_at IS NULL AND visibility='public';
CREATE INDEX community_author ON community_posts(author_user_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX community_product ON community_posts(product_id,created_at DESC,id DESC) WHERE deleted_at IS NULL AND visibility='public';
CREATE INDEX sessions_user ON user_sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX ai_user ON ai_import_tasks(user_id,created_at DESC);

COMMIT;
