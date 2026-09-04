/**
 * Phase 2.5-A — Style 数据填充（幂等）
 *
 * 从商品标题提取款式名（确定性规则），按 brand_id + canonical_name 聚类，
 * upsert styles 表 + 回填 products.style_id。
 *
 * 提取规则（与 /tmp/style_proto4.py 一致，v4 FINAL）：
 *   L1（最高）: 【款式名】 提取 + 黑名单/品牌碰撞/分隔符过滤
 *   HASH      : #款式名# 提取（同一套过滤）
 *   L2        : "XX系列" 提取（剥离品牌核心名前缀 + 营销词前后缀）
 *   过滤：类型词/营销词黑名单、品牌名双向碰撞、价格模式、纯数字/字母、>12字、含 ·./| 分隔符
 *
 * 幂等性：
 *   - style id 稳定：sty_${base64url(brandId:canonicalName).slice(0,16)}
 *   - upsert 用 ON CONFLICT (brand_id, canonical_name) WHERE deleted_at IS NULL DO UPDATE
 *   - products.style_id 按簇回填，重复执行结果一致
 *   - 禁止 DELETE 全表重建
 *
 * 用法：
 *   node --env-file=.env.production --import tsx scripts/populate-styles.ts            # dry-run（不写库）
 *   node --env-file=.env.production --import tsx scripts/populate-styles.ts --apply    # 执行
 */
import postgres from 'postgres';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

/** 稳定 style id：sha256(brandId:canonicalName) 前 16 hex（碰撞概率 ~2^-64，base64 截断有前缀碰撞） */
function styleIdOf(brandId: string, canonicalName: string): string {
  return `sty_${createHash('sha256').update(`${brandId}:${canonicalName}`).digest('hex').slice(0, 16)}`;
}

// ---------- 黑名单（类型词/营销词/状态词，命中即拒绝创建 Style） ----------
const BLOCK_WORDS = [
  '套装', '制服', '连衣裙', '衬衫', '半裙', '格裙', '上衣', '下装', '小物', '马甲', '开衫',
  '毛衣', '领带', '领结', '水手服', '斗篷', '披肩', '大衣', '外套', '背心', '裙', '鞋', '袜', '包', '裤',
  '定金', '尾款', '意向金', '现货', '预售', '补款', '合集', '礼盒', '待定', '预约', '新款', '原创',
  '正版', '校供', '基础款', '衬衫裙', '汉服', '洛丽塔', 'Lolita', 'JK', 'lo裙', 'op', 'jsk', 'sk',
  '日常', '通勤', '显瘦', '复古', '甜美', '可爱', '优雅', '简约', '百搭', '仙女', '学院风',
  '秋冬', '春夏', '加绒', '刺绣', '印花', '烫金', '打底', '内搭', '配饰', '饰品',
  '掉落', '兑换', '专拍', '链接', '页面', '特价', '秒杀', '清仓', '跳转', '假领', '胸针', '发箍',
  '蝴蝶结', '头纱', '手袖', '接袖', '腰封', '罩纱', '围裙', '贝雷帽', '颈链', '帽子', '头饰', '边夹',
  '绶带', '胸章', '袖套', '礼帽', '丝带', '缎带', '袜子', '项圈', '胸花', '勋章',
  '全款', '全款现', '征集中', '征集', '加购', '拍下', '链接拍', '预定', '预订', '意向',
  '已售完', '售空', '售罄', '下架', '爆火', '热卖', '爆款', '人气', '云肩', '件套', '专区',
  '抢购', '裙长', '双子款', '军lo', '八分版', '风琴褶', 'T恤', '兔T', '年前收货', '快团',
  '多色', '入夏', '随裙子', '不单卖', '单拍', '收藏链接', '新品',
];

const PRICE_PAT = /[0-9０-９]+(元|件|月|日|折|抵|团|期|套|块|万|千)/;

// ---------- 类型词 → sub_category 映射（标题检测，簇内多数派） ----------
const SUB_CATEGORY_WORDS: [string, string][] = [
  ['马面裙', '马面裙'], ['百褶裙', '百褶裙'], ['水手服', '水手服'], ['大袖衫', '大袖衫'],
  ['圆领袍', '圆领袍'], ['半身裙', '半身裙'], ['连衣裙', '连衣裙'], ['格子裙', '格裙'],
  ['格裙', '格裙'], ['襦裙', '襦裙'], ['齐胸', '齐胸襦裙'], ['齐腰', '齐腰襦裙'],
  ['吊带', '吊带'], ['比甲', '比甲'], ['短衫', '短衫'], ['长衫', '长衫'], ['道袍', '道袍'],
  ['披帛', '披帛'], ['JSK', 'JSK'], ['OP', 'OP'], ['SK', 'SK'], ['开衫', '开衫'],
  ['马甲', '马甲'], ['斗篷', '斗篷'], ['外套', '外套'], ['衬衫', '衬衫'], ['背心', '背心'],
  ['长裙', '长裙'], ['短裙', '短裙'], ['制服裙', '制服裙'], ['西装', '西装外套'],
  ['毛衣', '毛衣'], ['领带', '领带'], ['领结', '领结'], ['裙撑', '裙撑'], ['内搭', '内搭'],
];

// ---------- 工具 ----------
function nfkc(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, '');
}

function isBlocked(name: string): string | null {
  const n = nfkc(name);
  if (!n || n.length < 2) return 'empty/too-short';
  if (/^[0-9]+$/.test(n)) return 'pure-number';
  if (/^[a-zA-Z0-9.\-]+$/.test(n)) return 'pure-alnum';
  if (/[·./|]/.test(n)) return 'sep-char';
  for (const w of BLOCK_WORDS) {
    if (n.toLowerCase().includes(w.toLowerCase())) return `blockword:${w}`;
  }
  return null;
}

function detectSubCategory(title: string): string {
  for (const [word, cat] of SUB_CATEGORY_WORDS) {
    if (title.includes(word)) return cat;
  }
  return '';
}

type Row = {
  product_id: string; brand_id: string; brand_name: string; display_name: string;
  canonical_name: string; pit_type: string; style_id: string | null;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    // 1. 读品牌表（构建 brand_cores：去运营后缀的核心名）
    const brandRows = (await sql`select name from brands where deleted_at is null`) as unknown as { name: string }[];
    const brandCores = new Set<string>();
    for (const b of brandRows) {
      const core = b.name
        .replace(/(原创设计|原创工作室|原创设计馆|原创|设计馆|设计|工作室|官方|服饰|店铺|副店|会社|旗舰店|Lolita|lolita|JK|jk|汉服|汉元素)$/i, '')
        .trim();
      if (core.length >= 2) brandCores.add(core);
    }
    const cores = [...brandCores].sort((a, b) => b.length - a.length);

    // 2. 读商品
    const rows = (await sql`
      select p.id as product_id, p.brand_id, b.name as brand_name, p.display_name,
             p.canonical_name, p.pit_type, p.style_id
      from products p
      left join brands b on b.id = p.brand_id
      where p.deleted_at is null
      order by p.brand_id, p.id
    `) as unknown as Row[];

    // 3. 提取款式名
    const brandCollision = (name: string): boolean => {
      for (const b of cores) {
        if (b.length < 2) continue;
        if (b.includes(name) || name.includes(b)) return true;
      }
      return false;
    };

    const extractL1 = (title: string): string | null => {
      const m = title.match(/【([^】]+)】/);
      if (!m) return null;
      const n = nfkc(m[1]!);
      if (isBlocked(n)) return null;
      if (brandCollision(n)) return null;
      if (PRICE_PAT.test(n)) return null;
      if (n.length > 12) return null;
      return n;
    };

    const extractHash = (title: string): string | null => {
      const m = title.match(/#([\u4e00-\u9fa5A-Za-z0-9]{2,8})#/);
      if (!m) return null;
      const n = nfkc(m[1]!);
      if (isBlocked(n)) return null;
      if (brandCollision(n)) return null;
      if (PRICE_PAT.test(n)) return null;
      return n;
    };

    const extractL2 = (title: string): string | null => {
      const m = title.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,10})系列/);
      if (!m) return null;
      let raw = m[1]!;
      for (const b of cores) {
        if (b.length >= 2 && raw.includes(b)) { raw = raw.replace(b, ''); break; }
      }
      raw = raw.replace(/^(第?\d+团|二团|三团|兑换|复刻|再版|新色|限量|限定|周年|联名|二期|再贩|新)?/, '');
      raw = raw.replace(/(主题|纪念|限定版)?$/, '');
      const n = nfkc(raw);
      if (!n || n.length < 2) return null;
      if (isBlocked(n)) return null;
      if (brandCollision(n)) return null;
      if (PRICE_PAT.test(n)) return null;
      return n;
    };

    // 聚类
    type Cluster = { brandId: string; brandName: string; canonicalName: string; cat: Map<string, number>; subCat: Map<string, number>; productIds: string[] };
    const clusters = new Map<string, Cluster>();
    const stats = { L1: 0, HASH: 0, L2: 0, uncovered: 0 };

    for (const r of rows) {
      let name: string | null = null;
      let src = 'L1';
      name = extractL1(r.display_name);
      if (name === null) { name = extractHash(r.display_name); src = 'HASH'; }
      if (name === null) { name = extractL2(r.display_name); src = 'L2'; }
      if (name === null) { stats.uncovered++; continue; }
      stats[src as 'L1']++;
      const key = `${r.brand_id}::${name}`;
      let c = clusters.get(key);
      if (!c) {
        c = { brandId: r.brand_id, brandName: r.brand_name, canonicalName: name, cat: new Map(), subCat: new Map(), productIds: [] };
        clusters.set(key, c);
      }
      c.cat.set(r.pit_type, (c.cat.get(r.pit_type) ?? 0) + 1);
      const sub = detectSubCategory(r.display_name);
      if (sub !== '') c.subCat.set(sub, (c.subCat.get(sub) ?? 0) + 1);
      c.productIds.push(r.product_id);
    }

    const covered = stats.L1 + stats.HASH + stats.L2;
    const multi = [...clusters.values()].filter((c) => c.productIds.length > 1);
    console.log('=== Phase 2.5-A Style 填充（' + (APPLY ? 'APPLY' : 'DRY-RUN 未写库') + '）===');
    console.log(`商品总数: ${rows.length}`);
    console.log(`覆盖商品: ${covered} (${(covered / rows.length * 100).toFixed(1)}%)  L1=${stats.L1} HASH=${stats.HASH} L2=${stats.L2}`);
    console.log(`未覆盖: ${stats.uncovered}（保持 style_id = NULL）`);
    console.log(`Style 簇: ${clusters.size}（多商品簇 ${multi.length} / 单商品簇 ${clusters.size - multi.length}）`);
    console.log(`多商品簇商品: ${multi.reduce((n, c) => n + c.productIds.length, 0)}`);

    if (!APPLY) {
      console.log('\n[dry-run] 未执行任何写操作。使用 --apply 执行。');
      return;
    }

    // 4. upsert styles（幂等）
    let inserted = 0, updated = 0;
    for (const c of clusters.values()) {
      const styleId = styleIdOf(c.brandId, c.canonicalName);
      const category = [...c.cat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'OTHER';
      const subCategory = [...c.subCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const res = await sql`
        insert into styles (id, brand_id, canonical_name, category, sub_category, style_tags, description, created_at, updated_at)
        values (${styleId}, ${c.brandId}, ${c.canonicalName}, ${category}, ${subCategory}, '{}', '', now(), now())
        on conflict (brand_id, canonical_name) where deleted_at is null do update
          set category = excluded.category, sub_category = excluded.sub_category, updated_at = now()
        returning (xmax = 0) as is_insert
      `;
      if ((res[0] as unknown as { is_insert: boolean }).is_insert) inserted++; else updated++;
    }
    console.log(`\nstyles upsert: 新插入 ${inserted} / 更新 ${updated}`);

    // 5. 回填 products.style_id（幂等：重复执行同一值）
    let bound = 0;
    for (const c of clusters.values()) {
      const styleId = styleIdOf(c.brandId, c.canonicalName);
      const res = await sql`
        update products set style_id = ${styleId}, updated_at = now()
        where id = any(${sql.array(c.productIds)})
          and (style_id is distinct from ${styleId})
        returning id
      `;
      bound += res.length;
    }
    console.log(`products.style_id 回填: ${bound} 行变更（其余已一致）`);

    // 6. 最终核对
    const check = (await sql`
      select
        (select count(*)::int from styles where deleted_at is null) as styles_count,
        (select count(*)::int from products where deleted_at is null and style_id is not null) as bound_products,
        (select count(*)::int from products where deleted_at is null) as total_products
    `) as unknown as { styles_count: number; bound_products: number; total_products: number }[];
    console.log(`\n=== 最终核对 ===`);
    console.log(`styles: ${check[0]?.styles_count}`);
    console.log(`style_id 非空商品: ${check[0]?.bound_products} / ${check[0]?.total_products} (${(check[0]!.bound_products / check[0]!.total_products * 100).toFixed(1)}%)`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
