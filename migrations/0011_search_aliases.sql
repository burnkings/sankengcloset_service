-- ============================================================
-- 0011_search_aliases.sql — Phase 2.2-A 搜索别名词库
-- 数据驱动别名：category（坑向）/ brand（品牌简称旧称）/ style（款式俗称）
-- 替代 postgres.ts / memory.ts 中硬编码的 resolveAliasCategory()
-- 纯增量：建 aliases 表 + 索引，可重复执行（IF NOT EXISTS）
-- ============================================================

-- 1. 别名词库表
CREATE TABLE IF NOT EXISTS aliases (
  id             text PRIMARY KEY,              -- 确定性 id（seed 幂等键）：alias_<type>_<term>
  term           text NOT NULL,                 -- 别名词（规范化后：NFKC + 小写，如 lo裙/中牌/月光曲）
  canonical_term text NOT NULL,                 -- 规范目标：category→pit_type（JK/LOLITA/HANFU）；brand/style→实体 id
  alias_type     text NOT NULL CHECK (alias_type IN ('category', 'brand', 'style')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'review')),
  confidence     integer NOT NULL DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
  source         text NOT NULL DEFAULT 'seed',  -- seed | operator
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

COMMENT ON TABLE aliases IS '三坑搜索别名词库（category/brand/style，Phase 2.2-A Search Alias）';

-- 2. 索引（仅面向实际查询：term 精确/包含查找 + canonical 反向过滤）

-- 幂等 seed 的冲突目标：同 term + 同类型唯一（软删除外）
CREATE UNIQUE INDEX IF NOT EXISTS aliases_term_type_unique
  ON aliases (term, alias_type) WHERE deleted_at IS NULL;

-- 查询热点：resolveSearchAliases 按 term 精确/包含匹配（status=active 生效词）
CREATE INDEX IF NOT EXISTS aliases_lookup_idx
  ON aliases (term) WHERE status = 'active' AND deleted_at IS NULL;

-- 反向查找：canonical_term 命中时过滤商品（category→pit_type 用商品列，brand/style→实体 id 走商品外键，索引供未来运营查询）
CREATE INDEX IF NOT EXISTS aliases_canonical_idx
  ON aliases (canonical_term, alias_type) WHERE status = 'active' AND deleted_at IS NULL;
