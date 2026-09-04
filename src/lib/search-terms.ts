// src/lib/search-terms.ts — Phase 2.2-A 搜索词规范化与别名解析（纯逻辑，双仓库共用）
//
// 职责：
//   1. normalizeSearchTerm：trim + Unicode NFKC（全角→半角）+ 小写 + 多空格折叠
//   2. escapeLikePattern：转义 ILIKE 通配符（% _ \），防止用户输入被当作通配符
//   3. 别名匹配策略：exact（输入 = term）优先，contains（输入包含 term）其次
// 约定：词库（aliases 表）内的 term 一律存储规范化后的形式；前端保持零改动。

export type AliasType = 'category' | 'brand' | 'style';

/** aliases 表一行（repository 返回的最小映射） */
export interface SearchAliasRow {
  id: string;
  term: string;
  canonicalTerm: string;
  aliasType: AliasType;
  status: string;
  confidence: number;
  source: string;
}

/** resolveSearchTerms 的解析结果 */
export interface ResolvedSearchTerms {
  /** 规范化后的搜索词（空串表示无有效关键词） */
  normalized: string;
  /** 命中的别名（exact 优先、confidence 高优先；已按 aliasType 分组去重） */
  aliases: SearchAliasRow[];
  /** 分类命中 → pit_type 去重列表（JK/LOLITA/HANFU） */
  categoryMatches: string[];
  /** 品牌命中 → brand id 去重列表 */
  brandIds: string[];
  /** 款式命中 → style id 去重列表 */
  styleIds: string[];
}

/**
 * 统一规范化：trim → NFKC → toLowerCase → 多空格折叠。
 * NFKC 将全角（ＪＫ／ＬＯ）折为半角（JK/LO），与词库 term 存储形式一致。
 */
export function normalizeSearchTerm(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 转义 ILIKE 通配符（默认转义字符为反斜杠）：用户输入中的 % _ \ 不再参与模式匹配 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 判断 term 是否为纯 ASCII 短缩写（长度 ≤3 的字母数字串）。
 * 这类词（op/sk/jk/lo/bt/kc/bnt 等）若用 includes 匹配，会误命中
 * "drop"/"shop"/"stop"/"open"/"logo"/"slot" 等英文词（如 "drop" 内含子串 "op"），
 * 必须改用词边界匹配。中文词/长词无此风险，维持 includes。
 */
export function isShortAsciiAbbr(term: string): boolean {
  return /^[a-z0-9]{1,3}$/.test(term);
}

/**
 * 别名词条匹配（规范化输入 vs 词库 term）。
 * - 短 ASCII 缩写（≤3 位）：词边界正则 (^|[^a-z0-9])term($|[^a-z0-9])，
 *   "drop" 中 op 前是字母 r → 不命中；"lo裙" 中 lo 位于串首 → 命中。
 * - 其他词（中文/长英文）：维持 includes（如「JK制服」包含「jk」）。
 * term 来自词库（已规范化小写），插值进正则安全，无用户输入参与。
 */
export function matchesAliasTerm(normalized: string, term: string): boolean {
  if (isShortAsciiAbbr(term)) {
    return new RegExp(`(^|[^a-z0-9])${term}($|[^a-z0-9])`).test(normalized);
  }
  return normalized.includes(term);
}

/**
 * 从词库行中解析搜索意图。
 * 匹配策略：term 精确相等优先；其次用户输入包含 term（如「JK制服」包含「jk」）。
 * 缩写词使用词边界匹配（matchesAliasTerm），防止英文子串误命中。
 * 不命中任何别名时返回空分组——调用方必须继续原始文本搜索，不得失败。
 */
export function resolveSearchTerms(normalized: string, aliasRows: SearchAliasRow[]): ResolvedSearchTerms {
  const matches = aliasRows.filter((row) => row.status === 'active' && matchesAliasTerm(normalized, row.term));
  matches.sort((a, b) => {
    const aExact = a.term === normalized ? 0 : 1;
    const bExact = b.term === normalized ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return b.confidence - a.confidence;
  });

  const categoryMatches = [...new Set(matches.filter((m) => m.aliasType === 'category').map((m) => m.canonicalTerm))];
  const brandIds = [...new Set(matches.filter((m) => m.aliasType === 'brand').map((m) => m.canonicalTerm))];
  const styleIds = [...new Set(matches.filter((m) => m.aliasType === 'style').map((m) => m.canonicalTerm))];

  return { normalized, aliases: matches, categoryMatches, brandIds, styleIds };
}
