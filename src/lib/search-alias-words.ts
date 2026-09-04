// src/lib/search-alias-words.ts — Phase 2.2-A 搜索别名词表（确定性数据源）
//
// 词表原则（审计报告 §4-§6）：
//   - 只收录审计确认的「✅ 稳定」系统词；
//   - 歧义词（跨坑向，如「衬衫」「半裙」「背心裙」同时是 JK/LOLITA 商品类型）不入词表，
//     继续走 ILIKE 文本匹配，避免错误归类；
//   - 俗称（「海苔」「草莓柄」等）需运营确认，不入 seed；
//   - term 一律存储规范化形式（NFKC + 小写，与 normalizeSearchTerm 输出一致）。
//
// 本模块不连数据库：seed 脚本（scripts/seed-search-aliases.ts）与内存仓库
// （MemoryRepository 默认分类词）共用，保证词库单一事实源。

export type SeedAliasType = 'category' | 'brand' | 'style';

export interface SeedAliasWord {
  term: string;
  canonicalTerm: string;
  aliasType: SeedAliasType;
  status: 'active' | 'disabled' | 'review';
  confidence: number;
  source: 'seed';
}

/** 坑向分类别名：canonical_term = pit_type 枚举 */
export const CATEGORY_ALIASES: SeedAliasWord[] = [
  // LOLITA（审计 §5 A/B/D 类稳定词；JK 语境不使用 JSK/OP/SK/KC/BNT/BT 缩写，无歧义）
  { term: 'lo裙', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'lo', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '洛丽塔', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'lolita', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '洋装', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '花嫁', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'jsk', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'op', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'sk', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'kc', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'bnt', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'bt', canonicalTerm: 'LOLITA', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  // HANFU（审计 §6 A/B 类稳定词）
  { term: '汉服', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: 'hanfu', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '汉元素', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '马面', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '马面裙', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '襦裙', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '齐胸', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '圆领袍', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '明制', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '宋制', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '唐制', canonicalTerm: 'HANFU', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  // JK（审计 §4 A/B 类稳定词；衬衫/半裙/背心裙跨坑歧义不入）
  { term: 'jk', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '制服', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '格裙', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '水手服', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '西装外套', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '领带', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '领结', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
  { term: '开衫', canonicalTerm: 'JK', aliasType: 'category', status: 'active', confidence: 100, source: 'seed' },
];

/**
 * 品牌别名（canonical_term = brands.id，seed 时按品牌名动态解析）。
 * 仅收录审计确认的稳定简称（§4 G：中牌 → 中牌制服部）。
 * 品牌不存在时跳过（别名依赖实体，实体缺席则不入库）。
 */
export const BRAND_ALIAS_TERMS: Array<{ term: string; brandName: string }> = [
  { term: '中牌', brandName: '中牌制服部' },
];

/** 款式别名（canonical_term = styles.id）。审计 §8：俗称待运营确认，seed 空表，schema 已支持。 */
export const STYLE_ALIAS_TERMS: Array<{ term: string; styleName: string }> = [];
