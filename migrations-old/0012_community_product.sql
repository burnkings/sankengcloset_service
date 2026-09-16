-- ============================================================
-- 0012_community_product.sql — Phase 2.3-A Community → Product
-- community_posts 增加可空 product_id（Post → Product 最小闭环）
-- 返图/测评属于商品长期资料，不绑定 Release（首发/再贩/现货共存）
-- 纯增量：加列 + 索引，可重复执行（IF NOT EXISTS）
-- ============================================================

-- 1. 商品关联列（nullable：允许普通闲聊/非商品内容）
--    与 wishlist_items.product_id 同风格（裸 text 列，无 FK 约束——
--    products 为软删除，硬 FK 会阻碍商品归档；应用层负责校验存在性）
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS product_id text;

-- 2. 查询热点：商品详情「真实买家」模块按 product_id 拉取
CREATE INDEX IF NOT EXISTS community_posts_product_id_idx
  ON community_posts (product_id)
  WHERE deleted_at IS NULL AND product_id IS NOT NULL;
