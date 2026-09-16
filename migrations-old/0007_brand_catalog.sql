-- Phase D7.5: 品牌唯一约束调整（ADMIN 品牌 seed 已移除，品牌数据全部来自导入）
--
-- 品牌可跨品类同名（如婴梵塔同时有 Lolita/JK/汉服线），
-- 原唯一索引仅约束 name 会误杀跨品类同名品牌，改为 (name, category) 复合唯一
DROP INDEX IF EXISTS brands_name_unique;
CREATE UNIQUE INDEX brands_name_unique ON brands (name, category) WHERE deleted_at IS NULL;

-- 统计
SELECT category, count(*) as cnt FROM brands WHERE deleted_at IS NULL GROUP BY category ORDER BY category;
SELECT count(*) as total_brands FROM brands WHERE deleted_at IS NULL;
