-- 0016 已发布，使用后续迁移修正唯一约束，不修改既有迁移历史。
-- 同款式/颜色/尺码唯一；JSK 与 OP 可以共享颜色和尺码。
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_product_id_color_size_key;
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_product_style_color_size_uniq
  ON product_variants(product_id, style_name, color, size);
