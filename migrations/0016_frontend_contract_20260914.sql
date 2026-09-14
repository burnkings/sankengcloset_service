-- 前端 2026-09-13/14 评审后的字段契约。
-- 仅新增字段，不破坏旧数据；user_assets 的 JSONB 仍是当前用户资产 API 的事实存储。

-- 旧衣橱表仍被部分部署/导入脚本使用，补齐汉服形制字段。
ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS silhouette text NOT NULL DEFAULT '';
UPDATE wardrobe_items
SET silhouette = COALESCE(payload_json->>'silhouette', '')
WHERE silhouette = '' AND payload_json ? 'silhouette';
COMMENT ON COLUMN wardrobe_items.silhouette IS '汉服形制/年代；与 style 部件字段并列，非汉服为空';

-- 商品变体的款式属性（JSK/OP/SK 等），与颜色、尺码并列。
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS style_name text NOT NULL DEFAULT '';
COMMENT ON COLUMN product_variants.style_name IS '变体款式属性，如 JSK、OP、SK；无数据为空';
CREATE INDEX IF NOT EXISTS product_variants_product_style_idx ON product_variants(product_id, style_name);
