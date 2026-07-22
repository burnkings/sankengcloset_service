// intelligence/release-intelligence.ts — 发售批次智能识别引擎
// 从商品标题/描述中识别批次信息、发售类型、生命周期状态

export interface ReleaseAnalysis {
  release_name: string;       // 批次名称
  release_no: number;         // 批次序号（0=未知）
  release_type: 'first_release' | 'rerelease' | 'reservation' | 'spot' | 'lottery' | 'unknown';
  sale_status: string;        // UPCOMING / ON_SALE / PRE_ORDER / SOLD_OUT / ENDED
  lifecycle_status: string;   // upcoming / active / ended / sold_out
  is_rerelease: boolean;
  is_sold_out: boolean;
  confidence: number;         // 识别置信度 0-100
}

// ────────────────────────────────────────────────
// 批次序号解析
// ────────────────────────────────────────────────

const RELEASE_NO_PATTERNS: { pattern: RegExp; no: number }[] = [
  // 中文数字
  { pattern: /一期|第1期|第一批/, no: 1 },
  { pattern: /二期|第2期|第二批/, no: 2 },
  { pattern: /三期|第3期|第三批/, no: 3 },
  { pattern: /四期|第4期|第四批/, no: 4 },
  { pattern: /五期|第5期|第五批/, no: 5 },
  // 阿拉伯数字
  { pattern: /第(\d+)期/, no: -1 }, // 动态解析
  { pattern: /第(\d+)批/, no: -1 },
];

/**
 * 解析批次序号
 */
export function parseReleaseNo(text: string): number {
  for (const { pattern, no } of RELEASE_NO_PATTERNS) {
    if (no > 0 && pattern.test(text)) return no;
    if (no === -1) {
      const match = text.match(pattern);
      if (match?.[1]) return parseInt(match[1], 10);
    }
  }
  return 0; // 未知
}

// ────────────────────────────────────────────────
// 发售类型检测
// ────────────────────────────────────────────────

const TYPE_PATTERNS: { pattern: RegExp; type: ReleaseAnalysis['release_type'] }[] = [
  { pattern: /再贩|返场|复刻|复出/, type: 'rerelease' },
  { pattern: /预约|预定|预订|定金|订金/, type: 'reservation' },
  { pattern: /现货|现发|即发/, type: 'spot' },
  { pattern: /抽选|抽签|摇号/, type: 'lottery' },
  { pattern: /首发|首贩|初版/, type: 'first_release' },
];

/**
 * 检测发售类型
 */
export function detectReleaseType(text: string): ReleaseAnalysis['release_type'] {
  for (const { pattern, type } of TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'unknown';
}

// ────────────────────────────────────────────────
// 再贩检测
// ────────────────────────────────────────────────

const RERELEASE_PATTERNS = /再贩|返场|复刻|复出|补货|加场|追加/;

/**
 * 检测是否再贩
 */
export function detectRerelease(text: string): boolean {
  return RERELEASE_PATTERNS.test(text);
}

// ────────────────────────────────────────────────
// 售卖阶段检测
// ────────────────────────────────────────────────

const STAGE_PATTERNS: { pattern: RegExp; status: string; saleStatus: string }[] = [
  { pattern: /售罄|sold.?out|已售完|无货/, status: 'sold_out', saleStatus: 'SOLD_OUT' },
  { pattern: /结束|截止|完结|已结束/, status: 'ended', saleStatus: 'ENDED' },
  { pattern: /尾款|补款|尾款支付/, status: 'active', saleStatus: 'ON_SALE' },
  { pattern: /预约|预定|定金|预售/, status: 'active', saleStatus: 'PRE_ORDER' },
  { pattern: /现货|即发|现发/, status: 'active', saleStatus: 'ON_SALE' },
  { pattern: /即将|预告|敬请期待|未开始/, status: 'upcoming', saleStatus: 'UPCOMING' },
];

/**
 * 检测售卖阶段
 */
export function detectSaleStage(text: string): { lifecycle_status: string; sale_status: string } {
  for (const { pattern, status, saleStatus } of STAGE_PATTERNS) {
    if (pattern.test(text)) return { lifecycle_status: status, sale_status: saleStatus };
  }
  return { lifecycle_status: 'unknown', sale_status: 'UPCOMING' };
}

// ────────────────────────────────────────────────
// 批次名称生成
// ────────────────────────────────────────────────

function generateReleaseName(releaseNo: number, releaseType: string): string {
  const noStr = releaseNo > 0 ? `${releaseNo}期` : '';
  const typeMap: Record<string, string> = {
    first_release: '首发', rerelease: '再贩', reservation: '预约',
    spot: '现货', lottery: '抽选', unknown: '',
  };
  const parts = [noStr, typeMap[releaseType] || ''].filter(Boolean);
  return parts.length > 0 ? parts.join('') : '未知批次';
}

// ────────────────────────────────────────────────
// 主分析函数
// ────────────────────────────────────────────────

/**
 * 分析商品标题/描述，识别发售批次信息
 * @param title - 商品标题
 * @param description - 商品描述（可选）
 * @returns 发售分析结果
 */
export function analyzeRelease(title: string, description: string = ''): ReleaseAnalysis {
  const text = `${title} ${description}`;

  const releaseNo = parseReleaseNo(text);
  const releaseType = detectReleaseType(text);
  const isRerelease = detectRerelease(text);
  const { lifecycle_status, sale_status } = detectSaleStage(text);

  // 售罄检测（独立于 lifecycle_status）
  const isSoldOut = /售罄|sold.?out|已售完/.test(text);

  // 置信度计算
  let confidence = 50; // 基础分
  if (releaseNo > 0) confidence += 20;        // 识别到批次号
  if (releaseType !== 'unknown') confidence += 15; // 识别到类型
  if (isRerelease) confidence += 5;            // 再贩标记
  if (isSoldOut || lifecycle_status !== 'unknown') confidence += 10; // 状态识别
  confidence = Math.min(100, confidence);

  const releaseName = generateReleaseName(releaseNo, releaseType);

  return {
    release_name: releaseName,
    release_no: releaseNo,
    release_type: releaseType,
    sale_status,
    lifecycle_status,
    is_rerelease: isRerelease,
    is_sold_out: isSoldOut,
    confidence,
  };
}

/**
 * 批量分析
 */
export function analyzeBatchRelease(items: { title: string; description?: string }[]): ReleaseAnalysis[] {
  return items.map(item => analyzeRelease(item.title, item.description));
}
