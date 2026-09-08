-- 商品介绍沿用现有 products；店铺并不必然等于品牌。
ALTER TABLE products ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_name text NOT NULL DEFAULT '';
COMMENT ON COLUMN products.shop_name IS '来源店铺名称；未核实品牌时不自动创建品牌';
ALTER TYPE sale_status ADD VALUE IF NOT EXISTS 'UNKNOWN';
