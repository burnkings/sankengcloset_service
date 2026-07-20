-- Phase D1: 商品数据模型与采集规范
-- 新增表：brands, source_records, price_snapshots, tags, product_tags,
--         crawl_jobs, crawl_records, raw_data, review_records
-- 修改表：products（扩展字段）

-- ============================================================
-- 1. 枚举类型（PostgreSQL ENUM）
-- ============================================================

-- 坑向
DO $$ BEGIN
  CREATE TYPE pit_type AS ENUM ('JK', 'LOLITA', 'HANFU', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 销售状态
DO $$ BEGIN
  CREATE TYPE sale_status AS ENUM ('UPCOMING', 'ON_SALE', 'PRE_ORDER', 'SOLD_OUT', 'ENDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 数据来源平台
DO $$ BEGIN
  CREATE TYPE data_source AS ENUM (
    'OFFICIAL', 'TAOBAO', 'TMALL', 'WEIBO', 'XIAOHONGSHU',
    'WECHAT_MP', 'BILIBILI', 'USER_SUBMIT', 'ADMIN', 'AI_EXTRACT'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 数据状态
DO $$ BEGIN
  CREATE TYPE data_status AS ENUM ('FRESH', 'STALE', 'DELETED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 审核状态
DO $$ BEGIN
  CREATE TYPE review_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CORRECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 采集任务状态
DO $$ BEGIN
  CREATE TYPE crawl_status AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 发售事件类型
DO $$ BEGIN
  CREATE TYPE event_type AS ENUM (
    'PREVIEW', 'RESERVATION', 'DEPOSIT', 'FINAL_PAYMENT',
    'RELEASE', 'RESTOCK', 'PRICE_DROP'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 发售事件状态
DO $$ BEGIN
  CREATE TYPE event_status AS ENUM ('UPCOMING', 'ACTIVE', 'ENDED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;


-- ============================================================
-- 2. brands — 品牌表
-- ============================================================

CREATE TABLE IF NOT EXISTS brands (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  name_en     text NOT NULL DEFAULT '',
  category    pit_type NOT NULL DEFAULT 'OTHER',
  logo_url    text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  official_url text NOT NULL DEFAULT '',
  source_url  text NOT NULL DEFAULT '',          -- 采集来源 URL
  source_platform data_source NOT NULL DEFAULT 'ADMIN',
  follower_count integer NOT NULL DEFAULT 0,
  data_status data_status NOT NULL DEFAULT 'FRESH',
  review_status review_status NOT NULL DEFAULT 'PENDING',
  confidence  integer NOT NULL DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
  fetched_at  timestamptz,                       -- 最近一次采集时间
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS brands_name_unique ON brands (name) WHERE deleted_at IS NULL;
COMMENT ON TABLE brands IS '三坑品牌（JK/Lolita/汉服）';


-- ============================================================
-- 3. products — 商品表（扩展 0001 版本）
-- ============================================================

-- 先备份旧 products 表（如果有数据）
-- ALTER TABLE products RENAME TO products_legacy_0001;

DROP TABLE IF EXISTS product_images CASCADE;
DROP TABLE IF EXISTS products CASCADE;

CREATE TABLE IF NOT EXISTS products (
  id              text PRIMARY KEY,
  canonical_name  text NOT NULL,                   -- 标准化名称（去空格/统一大小写）
  display_name    text NOT NULL,                   -- 展示名称
  brand_id        text NOT NULL REFERENCES brands(id),
  shop_id         text,                            -- 关联店铺（可选）
  pit_type        pit_type NOT NULL DEFAULT 'OTHER',
  category        text NOT NULL DEFAULT '',         -- 细分类目：格裙/衬衫/JSK/OP/襦裙/马面
  sub_category    text NOT NULL DEFAULT '',         -- 子分类
  style_tags      text[] NOT NULL DEFAULT '{}',     -- 风格标签：甜系/哥特/日常/茶会
  color_tags      text[] NOT NULL DEFAULT '{}',     -- 颜色标签：粉色/蓝色/绀色
  material_tags   text[] NOT NULL DEFAULT '{}',     -- 材质标签：棉/雪纺/涤纶
  sale_status     sale_status NOT NULL DEFAULT 'UPCOMING',
  current_price   integer NOT NULL DEFAULT 0 CHECK (current_price >= 0),   -- 分
  original_price  integer NOT NULL DEFAULT 0 CHECK (original_price >= 0),  -- 分
  deposit_price   integer NOT NULL DEFAULT 0 CHECK (deposit_price >= 0),   -- 定金（分）
  balance_price   integer NOT NULL DEFAULT 0 CHECK (balance_price >= 0),   -- 尾款（分）
  currency        text NOT NULL DEFAULT 'CNY',

  -- 发售时间
  preorder_start_at  timestamptz,
  preorder_end_at    timestamptz,
  balance_start_at   timestamptz,
  balance_end_at     timestamptz,
  release_at         timestamptz,

  -- 来源
  source_url      text NOT NULL DEFAULT '',
  source_platform data_source NOT NULL DEFAULT 'ADMIN',
  external_id     text NOT NULL DEFAULT '',         -- 原始平台 ID
  cover_url       text NOT NULL DEFAULT '',
  images          text[] NOT NULL DEFAULT '{}',
  description     text NOT NULL DEFAULT '',
  raw_description text NOT NULL DEFAULT '',         -- 原始描述（不修改）
  source_published_at timestamptz,                  -- 原始发布时间

  -- 采集元数据
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  collected_at    timestamptz NOT NULL DEFAULT now(),
  data_status     data_status NOT NULL DEFAULT 'FRESH',
  review_status   review_status NOT NULL DEFAULT 'PENDING',
  confidence      integer NOT NULL DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),

  -- 优化
  view_count      integer NOT NULL DEFAULT 0,
  favorite_count  integer NOT NULL DEFAULT 0,

  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS products_brand_idx ON products (brand_id);
CREATE INDEX IF NOT EXISTS products_pit_type_idx ON products (pit_type);
CREATE INDEX IF NOT EXISTS products_sale_status_idx ON products (sale_status);
CREATE INDEX IF NOT EXISTS products_review_status_idx ON products (review_status);
CREATE INDEX IF NOT EXISTS products_source_idx ON products (source_platform, external_id);
CREATE INDEX IF NOT EXISTS products_canonical_idx ON products (canonical_name, brand_id);
CREATE INDEX IF NOT EXISTS products_created_idx ON products (created_at DESC);

COMMENT ON TABLE products IS '三坑商品（核心实体）';


-- ============================================================
-- 4. product_variants — 商品规格变体
-- ============================================================

CREATE TABLE IF NOT EXISTS product_variants (
  id          text PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        text NOT NULL,                      -- "粉色 S" / "蓝色 M"
  sku         text NOT NULL DEFAULT '',
  color       text NOT NULL DEFAULT '',
  size        text NOT NULL DEFAULT '',
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  stock_status text NOT NULL DEFAULT 'IN_STOCK',  -- IN_STOCK / LOW_STOCK / OUT_OF_STOCK / PRE_ORDER
  stock_count integer,                            -- 可选：具体库存数
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, color, size)
);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants (product_id);

COMMENT ON TABLE product_variants IS '商品规格变体（颜色/尺码/库存）';


-- ============================================================
-- 5. product_images — 商品图片
-- ============================================================

CREATE TABLE IF NOT EXISTS product_images (
  id          text PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  object_key  text,                               -- 本地存储 key（可选）
  width       integer,
  height      integer,
  file_size   integer,
  sort_order  integer NOT NULL DEFAULT 0,
  is_cover    boolean NOT NULL DEFAULT false,
  source_url  text NOT NULL DEFAULT '',            -- 原始图片 URL
  phash       text NOT NULL DEFAULT '',            -- 感知哈希（去重用）
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, sort_order)
);
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (product_id);
CREATE INDEX IF NOT EXISTS product_images_phash_idx ON product_images (phash) WHERE phash != '';

COMMENT ON TABLE product_images IS '商品图片（支持去重）';


-- ============================================================
-- 6. source_records — 数据来源追踪
-- ============================================================

CREATE TABLE IF NOT EXISTS source_records (
  id              text PRIMARY KEY,
  source_type     data_source NOT NULL,
  source_name     text NOT NULL DEFAULT '',        -- "星辰猫旗舰店"
  source_url      text NOT NULL,                   -- 原始 URL
  original_id     text NOT NULL DEFAULT '',         -- 原始平台 ID
  raw_data_id     text,                            -- 关联 raw_data 表
  entity_type     text NOT NULL,                   -- 'product' / 'brand' / 'event'
  entity_id       text NOT NULL,                   -- 关联实体 ID
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,                     -- 原始发布时间
  parser_version  text NOT NULL DEFAULT 'v1',      -- 解析器版本
  review_status   review_status NOT NULL DEFAULT 'PENDING',
  confidence      integer NOT NULL DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
  human_modified  boolean NOT NULL DEFAULT false,  -- 是否被人工修改
  reviewer_id     text,                            -- 审核人
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_records_entity_idx ON source_records (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS source_records_source_idx ON source_records (source_type, original_id);
CREATE INDEX IF NOT EXISTS source_records_url_idx ON source_records (source_url);

COMMENT ON TABLE source_records IS '数据来源追踪（每条数据必须可溯源）';


-- ============================================================
-- 7. raw_data — 原始数据存储
-- ============================================================

CREATE TABLE IF NOT EXISTS raw_data (
  id              text PRIMARY KEY,
  source_record_id text REFERENCES source_records(id),
  source_type     data_source NOT NULL,
  source_url      text NOT NULL,
  content_type    text NOT NULL DEFAULT 'text/html',  -- text/html / application/json / text/xml
  raw_content     text NOT NULL,                      -- 原始内容（HTML/JSON/XML）
  parsed_json     jsonb NOT NULL DEFAULT '{}'::jsonb, -- 解析后的结构化数据
  http_status     integer,
  http_headers    jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS raw_data_source_idx ON raw_data (source_record_id);

COMMENT ON TABLE raw_data IS '原始采集数据（不修改，用于审计和重新解析）';


-- ============================================================
-- 8. price_snapshots — 价格快照
-- ============================================================

CREATE TABLE IF NOT EXISTS price_snapshots (
  id          text PRIMARY KEY,
  product_id  text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  original_price_cents integer NOT NULL DEFAULT 0,
  deposit_cents integer NOT NULL DEFAULT 0,
  balance_cents integer NOT NULL DEFAULT 0,
  source      text NOT NULL DEFAULT '',             -- 价格来源描述
  source_url  text NOT NULL DEFAULT '',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_snapshots_product_idx ON price_snapshots (product_id, fetched_at DESC);

COMMENT ON TABLE price_snapshots IS '价格历史快照';


-- ============================================================
-- 9. sale_events — 发售事件（扩展 0001 release_events）
-- ============================================================

DROP TABLE IF EXISTS release_events CASCADE;

CREATE TABLE IF NOT EXISTS sale_events (
  id              text PRIMARY KEY,
  product_id      text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_type      event_type NOT NULL,
  title           text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  start_at        timestamptz,
  end_at          timestamptz,
  deposit_amount  integer NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  balance_amount  integer NOT NULL DEFAULT 0 CHECK (balance_amount >= 0),
  status          event_status NOT NULL DEFAULT 'UPCOMING',
  source_id       text REFERENCES source_records(id),
  data_status     data_status NOT NULL DEFAULT 'FRESH',
  review_status   review_status NOT NULL DEFAULT 'PENDING',
  confidence      integer NOT NULL DEFAULT 100,
  fetched_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sale_events_product_idx ON sale_events (product_id, start_at);
CREATE INDEX IF NOT EXISTS sale_events_status_idx ON sale_events (status);

COMMENT ON TABLE sale_events IS '发售事件（预览/定金/尾款/发售/补货/降价）';


-- ============================================================
-- 10. tags — 标签
-- ============================================================

CREATE TABLE IF NOT EXISTS tags (
  id          text PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  category    text NOT NULL DEFAULT 'style',       -- style / color / material / occasion / custom
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tags IS '标签（风格/颜色/材质/场景）';


-- ============================================================
-- 11. product_tags — 商品-标签关联
-- ============================================================

CREATE TABLE IF NOT EXISTS product_tags (
  product_id  text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id      text NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, tag_id)
);

COMMENT ON TABLE product_tags IS '商品标签关联';


-- ============================================================
-- 12. crawl_jobs — 采集任务
-- ============================================================

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id              text PRIMARY KEY,
  source_type     data_source NOT NULL,
  source_url      text NOT NULL DEFAULT '',         -- 采集目标 URL（可选）
  status          crawl_status NOT NULL DEFAULT 'PENDING',
  started_at      timestamptz,
  finished_at     timestamptz,
  items_total     integer NOT NULL DEFAULT 0,
  items_success   integer NOT NULL DEFAULT 0,
  items_failed    integer NOT NULL DEFAULT 0,
  items_skipped   integer NOT NULL DEFAULT 0,
  error_message   text,
  parser_version  text NOT NULL DEFAULT 'v1',
  trigger         text NOT NULL DEFAULT 'manual',   -- manual / scheduled / retry
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crawl_jobs_status_idx ON crawl_jobs (status, created_at DESC);

COMMENT ON TABLE crawl_jobs IS '采集任务（批次级追踪）';


-- ============================================================
-- 13. crawl_records — 采集记录（单条级追踪）
-- ============================================================

CREATE TABLE IF NOT EXISTS crawl_records (
  id              text PRIMARY KEY,
  job_id          text NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  source_type     data_source NOT NULL,
  source_url      text NOT NULL,
  external_id     text NOT NULL DEFAULT '',
  status          crawl_status NOT NULL DEFAULT 'PENDING',
  entity_type     text,                            -- 创建/更新的实体类型
  entity_id       text,                            -- 创建/更新的实体 ID
  dedup_action    text NOT NULL DEFAULT 'insert',  -- insert / update / skip_dedup / skip_review
  error_message   text,
  fetched_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crawl_records_job_idx ON crawl_records (job_id);
CREATE INDEX IF NOT EXISTS crawl_records_source_idx ON crawl_records (source_type, external_id);

COMMENT ON TABLE crawl_records IS '采集记录（单条级追踪，关联 crawl_jobs）';


-- ============================================================
-- 14. review_records — 审核记录
-- ============================================================

CREATE TABLE IF NOT EXISTS review_records (
  id              text PRIMARY KEY,
  entity_type     text NOT NULL,                   -- 'product' / 'brand' / 'event'
  entity_id       text NOT NULL,
  action          text NOT NULL,                   -- 'approve' / 'reject' / 'correct'
  field_changes   jsonb NOT NULL DEFAULT '{}'::jsonb, -- 修改了哪些字段
  reviewer_id     text,                            -- 审核人（NULL = 系统自动）
  reason          text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_records_entity_idx ON review_records (entity_type, entity_id);

COMMENT ON TABLE review_records IS '审核记录（审计追踪）';


-- ============================================================
-- 15. 去重候选键索引（辅助去重查询）
-- ============================================================

-- platform + externalId 去重
CREATE UNIQUE INDEX IF NOT EXISTS products_platform_external_unique
  ON products (source_platform, external_id)
  WHERE external_id != '' AND deleted_at IS NULL;

-- brand + canonicalName 去重
CREATE UNIQUE INDEX IF NOT EXISTS products_brand_canonical_unique
  ON products (brand_id, canonical_name)
  WHERE deleted_at IS NULL;
