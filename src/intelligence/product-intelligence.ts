// intelligence/product-intelligence.ts — 商品智能标签引擎
// 从商品描述/名称/品牌中提取风格、颜色、季节、场景、材质、元素标签

export interface ProductIntelligence {
  style_tags: string[];
  color_tags: string[];
  season_tags: string[];
  scene_tags: string[];
  material_tags: string[];
  element_tags: string[];
}

// ────────────────────────────────────────────────
// 标签规则（可扩展，不写死）
// ────────────────────────────────────────────────

const STYLE_RULES: { pattern: RegExp; tag: string }[] = [
  { pattern: /甜系|甜美|少女|可爱|软萌|lo裙/, tag: '甜美' },
  { pattern: /哥特|暗黑|暗系|十字架|黑哥/, tag: '哥特' },
  { pattern: /古典|复古|优雅|欧式|宫廷/, tag: '古典' },
  { pattern: /日常|通勤|简约|基础|百搭/, tag: '日常' },
  { pattern: /华丽|奢华|重工|刺绣|金线|织金/, tag: '华丽' },
  { pattern: /清新|森系|自然|田园/, tag: '清新' },
  { pattern: /学院|制服|JK|水手/, tag: '学院' },
  { pattern: /国风|汉元素|新中式/, tag: '国风' },
  { pattern: /洛可可|维多利亚/, tag: '欧式古典' },
  { pattern: /朋克|摇滚|街头/, tag: '街头' },
];

const COLOR_RULES: { pattern: RegExp; tag: string }[] = [
  { pattern: /黑色|黑|绀色|深蓝/, tag: '黑色系' },
  { pattern: /白色|白|米白|奶白/, tag: '白色系' },
  { pattern: /粉色|粉|浅粉|裸粉/, tag: '粉色系' },
  { pattern: /红色|红|酒红|正红/, tag: '红色系' },
  { pattern: /蓝色|蓝|天蓝|藏青|海军蓝/, tag: '蓝色系' },
  { pattern: /绿色|绿|薄荷绿|墨绿|军绿/, tag: '绿色系' },
  { pattern: /紫色|紫|薰衣草|浅紫/, tag: '紫色系' },
  { pattern: /黄色|黄|鹅黄|姜黄/, tag: '黄色系' },
  { pattern: /橙色|橙/, tag: '橙色系' },
  { pattern: /棕色|棕|咖啡|卡其/, tag: '棕色系' },
  { pattern: /灰色|灰/, tag: '灰色系' },
  { pattern: /格子|格纹|格裙/, tag: '格纹' },
  { pattern: /条纹/, tag: '条纹' },
  { pattern: /碎花|花卉/, tag: '碎花' },
  { pattern: /纯色|单色/, tag: '纯色' },
];

const SEASON_RULES: { pattern: RegExp; tag: string }[] = [
  { pattern: /春|春季|春天/, tag: '春季' },
  { pattern: /夏|夏季|夏天/, tag: '夏季' },
  { pattern: /秋|秋季|秋天/, tag: '秋季' },
  { pattern: /冬|冬季|冬天/, tag: '冬季' },
  { pattern: /四季|全年|通用/, tag: '四季' },
  { pattern: /JK|水手服|制服裙/, tag: '四季' },
];

const SCENE_RULES: { pattern: RegExp; tag: string }[] = [
  { pattern: /日常|通勤|上学|上班/, tag: '日常' },
  { pattern: /约会|聚会|派对/, tag: '社交' },
  { pattern: /拍照|写真|摄影/, tag: '摄影' },
  { pattern: /演出|舞台|表演/, tag: '演出' },
  { pattern: /毕业|典礼|仪式/, tag: '仪式' },
  { pattern: /旅行|出游|度假/, tag: '旅行' },
  { pattern: /茶会|lolita茶会|lo茶会/, tag: '茶会' },
  { pattern: /节日|圣诞|新年|万圣/, tag: '节日' },
];

const MATERIAL_RULES: { pattern: RegExp; tag: string }[] = [
  { pattern: /涤纶|聚酯/, tag: '涤纶' },
  { pattern: /棉|纯棉|全棉/, tag: '棉' },
  { pattern: /雪纺/, tag: '雪纺' },
  { pattern: /蕾丝/, tag: '蕾丝' },
  { pattern: /丝绸|真丝/, tag: '丝绸' },
  { pattern: /欧根纱|欧根/, tag: '欧根纱' },
  { pattern: /牛仔/, tag: '牛仔' },
  { pattern: /皮革|PU|皮/, tag: '皮革' },
  { pattern: /羊毛|毛料/, tag: '羊毛' },
  { pattern: /针织/, tag: '针织' },
  { pattern: /网纱/, tag: '网纱' },
  { pattern: /缎面/, tag: '缎面' },
];

const ELEMENT_RULES: { pattern: RegExp; tag: string }[] = [
  { pattern: /蝴蝶结|蝴蝶/, tag: '蝴蝶结' },
  { pattern: /蕾丝边|花边|蕾丝/, tag: '蕾丝边' },
  { pattern: /褶皱|褶裙/, tag: '褶皱' },
  { pattern: /刺绣|绣花/, tag: '刺绣' },
  { pattern: /荷叶边/, tag: '荷叶边' },
  { pattern: /纽扣|扣子/, tag: '纽扣' },
  { pattern: /拉链/, tag: '拉链' },
  { pattern: /腰带|腰封/, tag: '腰带' },
  { pattern: /口袋/, tag: '口袋' },
  { pattern: /领结|领带/, tag: '领饰' },
  { pattern: /泡泡袖|灯笼袖/, tag: '特殊袖型' },
  { pattern: /裙撑/, tag: '裙撑' },
  { pattern: /金线|银线|织金/, tag: '织金' },
  { pattern: /印花/, tag: '印花' },
  { pattern: /格子|格纹/, tag: '格纹' },
];

// ────────────────────────────────────────────────
// 引擎
// ────────────────────────────────────────────────

function matchRules(text: string, rules: { pattern: RegExp; tag: string }[]): string[] {
  const tags = new Set<string>();
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      tags.add(rule.tag);
    }
  }
  return Array.from(tags);
}

/**
 * 分析商品文本，提取智能标签
 * @param text - 商品名称 + 描述 + 品牌名 的拼接文本
 * @returns 智能标签
 */
export function analyzeProduct(text: string): ProductIntelligence {
  return {
    style_tags: matchRules(text, STYLE_RULES),
    color_tags: matchRules(text, COLOR_RULES),
    season_tags: matchRules(text, SEASON_RULES),
    scene_tags: matchRules(text, SCENE_RULES),
    material_tags: matchRules(text, MATERIAL_RULES),
    element_tags: matchRules(text, ELEMENT_RULES),
  };
}

/**
 * 合并两个 ProductIntelligence（去重）
 */
export function mergeIntelligence(a: ProductIntelligence, b: ProductIntelligence): ProductIntelligence {
  const merge = (x: string[], y: string[]) => Array.from(new Set([...x, ...y]));
  return {
    style_tags: merge(a.style_tags, b.style_tags),
    color_tags: merge(a.color_tags, b.color_tags),
    season_tags: merge(a.season_tags, b.season_tags),
    scene_tags: merge(a.scene_tags, b.scene_tags),
    material_tags: merge(a.material_tags, b.material_tags),
    element_tags: merge(a.element_tags, b.element_tags),
  };
}

/**
 * 推荐标签：从所有标签中选出最重要的
 */
export function recommendTags(intel: ProductIntelligence, maxTags = 5): string[] {
  // 优先级：风格 > 颜色 > 元素 > 材质 > 场景 > 季节
  const priority = [
    ...intel.style_tags,
    ...intel.color_tags,
    ...intel.element_tags.slice(0, 2),
    ...intel.material_tags.slice(0, 1),
    ...intel.scene_tags.slice(0, 1),
    ...intel.season_tags.slice(0, 1),
  ];
  return Array.from(new Set(priority)).slice(0, maxTags);
}
