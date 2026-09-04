// scripts/seed-search-aliases.ts — Phase 2.2-A 搜索别名词库 seed（幂等 upsert）
//
// 行为：
//   - 重复执行不产生重复数据（确定性 id + ON CONFLICT (term, alias_type) DO UPDATE）
//   - category 词直接写入；brand 词按品牌名动态解析 id，品牌不存在则跳过并提示；
//     style 词表当前为空（俗称待运营确认），schema 已支持
//   - 不删除任何现有词（运营后续通过 status/disabled 管理），可安全重跑
//
// 运行：npm run seed:aliases（package.json 已注册）或 npx tsx scripts/seed-search-aliases.ts

import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import { normalizeSearchTerm } from '../src/lib/search-terms.js';
import { BRAND_ALIAS_TERMS, CATEGORY_ALIASES, STYLE_ALIAS_TERMS } from '../src/lib/search-alias-words.js';

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { max: 1 });

/** 确定性 id：seed 幂等键（term 规范化后作为 id 一部分） */
function aliasId(aliasType: string, term: string): string {
  return `alias_${aliasType}_${normalizeSearchTerm(term)}`;
}

async function upsertAlias(id: string, term: string, canonicalTerm: string, aliasType: string, status: string, confidence: number, source: string): Promise<void> {
  await sql`
    insert into aliases (id, term, canonical_term, alias_type, status, confidence, source, updated_at)
    values (${id}, ${term}, ${canonicalTerm}, ${aliasType}, ${status}, ${confidence}, ${source}, now())
    on conflict (term, alias_type) where deleted_at is null
    do update set
      canonical_term = excluded.canonical_term,
      status = excluded.status,
      confidence = excluded.confidence,
      source = excluded.source,
      updated_at = now()
  `;
}

try {
  let inserted = 0;
  let skipped = 0;

  // 1. 坑向分类词（canonical_term = pit_type）
  for (const word of CATEGORY_ALIASES) {
    const term = normalizeSearchTerm(word.term);
    await upsertAlias(aliasId(word.aliasType, term), term, word.canonicalTerm, word.aliasType, word.status, word.confidence, word.source);
    inserted += 1;
  }

  // 2. 品牌简称（canonical_term = brands.id；品牌实体缺席则跳过，保证 alias 永远指向真实实体）
  for (const { term: rawTerm, brandName } of BRAND_ALIAS_TERMS) {
    const term = normalizeSearchTerm(rawTerm);
    const brands = await sql`
      select id from brands
      where name = ${brandName} and deleted_at is null
      order by created_at asc limit 1
    `;
    if (brands.length === 0) {
      console.log(`SKIP brand alias "${rawTerm}" -> "${brandName}"（品牌不存在，跳过）`);
      skipped += 1;
      continue;
    }
    const brandId = String((brands[0] as Record<string, unknown>).id);
    await upsertAlias(aliasId('brand', term), term, brandId, 'brand', 'active', 100, 'seed');
    inserted += 1;
  }

  // 3. 款式俗称（canonical_term = styles.id；当前词表为空，schema 已支持）
  for (const { term: rawTerm, styleName } of STYLE_ALIAS_TERMS) {
    const term = normalizeSearchTerm(rawTerm);
    const styles = await sql`
      select id from styles
      where canonical_name = ${styleName} and deleted_at is null
      order by created_at asc limit 1
    `;
    if (styles.length === 0) {
      console.log(`SKIP style alias "${rawTerm}" -> "${styleName}"（款式不存在，跳过）`);
      skipped += 1;
      continue;
    }
    const styleId = String((styles[0] as Record<string, unknown>).id);
    await upsertAlias(aliasId('style', term), term, styleId, 'style', 'active', 100, 'seed');
    inserted += 1;
  }

  console.log(`Seeded search aliases: ${inserted} upserted, ${skipped} skipped（重复执行幂等，无重复数据）`);
} finally {
  await sql.end();
}
