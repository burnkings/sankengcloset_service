-- ============================================================
-- 0010_styles.sql — Phase 2.1 Style 实体（三坑款式知识库 MVP）
-- Brand → Style → Product → Release 数据链
-- 纯增量：建 styles 表 + products.style_id（nullable）+ 索引
-- 可重复执行（IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）
-- ============================================================

-- 1. 款式表
CREATE TABLE IF NOT EXISTS styles (
  id             text PRIMARY KEY,
  brand_id       text NOT NULL REFERENCES brands(id),
  canonical_name text NOT NULL,                 -- 款式标准化名称（同品牌内唯一）
  category       pit_type NOT NULL DEFAULT 'OTHER',   -- JK / LOLITA / HANFU / OTHER
  sub_category   text NOT NULL DEFAULT '',      -- 细分类目：格裙/衬衫/JSK/OP/襦裙/马面
  style_tags     text[] NOT NULL DEFAULT '{}',  -- 风格标签：甜系/哥特/日常/茶会
  description    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

COMMENT ON TABLE styles IS '三坑款式（Brand → Style → Product → Release）';

-- 同品牌 + 同款式名唯一（软删除外）
CREATE UNIQUE INDEX IF NOT EXISTS styles_brand_name_unique
  ON styles (brand_id, canonical_name) WHERE deleted_at IS NULL;

-- 2. 商品挂款式（nullable：存量商品不强制归并）
ALTER TABLE products ADD COLUMN IF NOT EXISTS style_id text REFERENCES styles(id);

CREATE INDEX IF NOT EXISTS products_style_idx
  ON products (style_id) WHERE deleted_at IS NULL AND style_id IS NOT NULL;
