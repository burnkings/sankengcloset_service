/**
 * Style 归并候选生成 / 审核后绑定（Phase 2.1 Style Entity MVP）
 *
 * 原则（用户指令）：
 * - 绝对不自动覆盖生产商品：默认 dry-run 只生成候选，不写库
 * - 候选依据：brand_id + canonical_name（主键），category/sub_category/style_tags 辅助
 * - 审核通过后：--apply-file <json> 显式绑定（绑定文件为 dry-run 产物经人工审核后的子集）
 *
 * 用法：
 *   node --env-file=.env.production --import tsx scripts/style-merge-dry-run.ts            # 只输出候选 + 统计
 *   node --env-file=.env.production --import tsx scripts/style-merge-dry-run.ts --json /tmp/style-candidates.json
 *   node --env-file=.env.production --import tsx scripts/style-merge-dry-run.ts --apply-file /tmp/style-approve.json
 *
 * --apply-file 格式（每条：canonicalName 必须与该簇一致；products 为商品 id 数组）：
 *   [
 *     { "canonicalName": "月光曲 JSK", "subCategory": "JSK", "styleTags": ["甜系"], "products": ["prd_xxx", "prd_yyy"] }
 *   ]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

type Candidate = {
  canonicalName: string;
  brandId: string;
  brandName: string;
  category: string;
  subCategory: string;
  styleTags: string[];
  productIds: string[];
  productCount: number;
};

function argValue(args: string[], flag: string): string {
  const idx = args.indexOf(flag);
  if (idx < 0) return '';
  const value = args[idx + 1];
  return value ?? '';
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOut = argValue(args, '--json');
  const applyFile = argValue(args, '--apply-file');

  const sql = postgres(process.env.DATABASE_URL!, { max: 2 });

  try {
    const rows = await sql`
      select p.id as product_id, p.brand_id, b.name as brand_name, p.canonical_name,
        p.pit_type as category, p.category as sub_category, p.style_tags, p.style_id
      from products p
      left join brands b on b.id = p.brand_id
      where p.deleted_at is null and p.visibility_status = 'published'
      order by p.brand_id, p.canonical_name
    `;

    const byKey = new Map<string, Candidate>();
    for (const row of rows as unknown as { product_id: string; brand_id: string; brand_name: string; canonical_name: string; category: string; sub_category: string; style_tags: string[] | null; style_id: string | null }[]) {
      const key = `${row.brand_id}::${row.canonical_name}`;
      let c = byKey.get(key);
      if (!c) {
        c = {
          canonicalName: row.canonical_name,
          brandId: row.brand_id,
          brandName: row.brand_name,
          category: row.category,
          subCategory: row.sub_category,
          styleTags: Array.isArray(row.style_tags) ? row.style_tags : [],
          productIds: [],
          productCount: 0,
        };
        byKey.set(key, c);
      }
      c.productIds.push(row.product_id);
      c.productCount += 1;
    }

    const candidates = [...byKey.values()];
    const multi = candidates.filter((c) => c.productCount > 1); // 可归并簇（同品牌同款式名多商品）
    const single = candidates.filter((c) => c.productCount === 1); // 单商品款式
    const alreadyBound = (rows as unknown as { style_id: string | null }[]).filter((r) => r.style_id != null).length;

    console.log('=== Style 归并候选统计（dry-run，未写库）===');
    console.log(`商品总数: ${rows.length}`);
    console.log(`已绑定 style 的商品: ${alreadyBound}`);
    console.log(`未绑定商品: ${rows.length - alreadyBound}`);
    console.log(`候选款式簇: ${candidates.length}（多商品簇 ${multi.length} / 单商品簇 ${single.length}）`);
    console.log(`多商品簇可归并商品数: ${multi.reduce((n, c) => n + c.productCount, 0)}`);
    if (multi.length > 0) {
      console.log('\n=== 多商品簇样例（前 10）===');
      for (const c of multi.slice(0, 10)) {
        console.log(`  ${c.brandName} / ${c.canonicalName} (${c.category}) → ${c.productCount} 个商品 [${c.productIds.join(', ')}]`);
      }
    }

    if (jsonOut !== '') {
      writeFileSync(jsonOut, JSON.stringify({ candidates, multi, single, generatedAt: new Date().toISOString() }, null, 2));
      console.log(`\n候选已导出: ${jsonOut}`);
    }

    // ---- 显式审核绑定（绝不默认执行）----
    if (applyFile !== '') {
      const approved = JSON.parse(readFileSync(applyFile, 'utf-8')) as { canonicalName: string; subCategory?: string; styleTags?: string[]; products: string[] }[];
      console.log(`\n=== 应用审核绑定: ${approved.length} 条（显式 --apply-file）===\n`);
      let bound = 0;
      for (const a of approved) {
        const cluster = candidates.find((c) => c.canonicalName === a.canonicalName || c.productIds.some((pid) => a.products.includes(pid)));
        if (!cluster) {
          console.log(`  SKIP ${a.canonicalName}: 未匹配任何候选`);
          continue;
        }
        // 同一簇内所有商品绑定到同一 style
        const styleId = `sty_${Buffer.from(`${cluster.brandId}_${cluster.canonicalName}`).toString('base64url').slice(0, 16)}`;
        const insert = await sql`
          insert into styles (id, brand_id, canonical_name, category, sub_category, style_tags, description, created_at, updated_at)
          values (${styleId}, ${cluster.brandId}, ${cluster.canonicalName}, ${cluster.category},
                  ${a.subCategory ?? cluster.subCategory}, ${sql.array(a.styleTags ?? cluster.styleTags)}, '', now(), now())
          on conflict (brand_id, canonical_name) where deleted_at is null do update
            set sub_category = excluded.sub_category, style_tags = excluded.style_tags, updated_at = now()
          returning id
        `;
        const finalId = insert.length > 0 ? String(insert[0]?.id ?? styleId) : styleId;
        for (const pid of cluster.productIds) {
          await sql`update products set style_id = ${finalId}, updated_at = now() where id = ${pid} and deleted_at is null`;
          bound += 1;
        }
        console.log(`  BOUND ${cluster.brandName} / ${cluster.canonicalName} → ${finalId}（${cluster.productIds.length} 商品）`);
      }
      console.log(`\n绑定完成: ${bound} 个商品`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
