// crawler/parsers/announcement-parser.ts — 三坑品牌公告文本解析器
// 从公开公告/详情页文本中提取发售批次信息

export interface AnnouncementResult {
  products: AnnouncementProduct[];
  warnings: string[];
}

export interface AnnouncementProduct {
  title: string;
  brand: string;
  pitType: 'JK' | 'LOLITA' | 'HANFU' | 'OTHER';
  category: string;
  releaseName: string;
  releaseNo: number;
  releaseType: 'first_release' | 'rerelease' | 'reservation' | 'spot' | 'lottery' | 'unknown';
  saleStatus: string;
  depositPriceCents: number;
  balancePriceCents: number;
  fullPriceCents: number;
  startAt: string | null;
  endAt: string | null;
  balanceDueAt: string | null;
  shipAt: string | null;
  isRerelease: boolean;
  isSoldOut: boolean;
  lifecycleStatus: string;
  confidence: number;
  sourceUrl: string;
  rawText: string;
  warnings: string[];
}

// ────────────────────────────────────────────────
// 元数据解析（文件头部）
// ────────────────────────────────────────────────

export interface SnapshotMetadata {
  brand: string;
  sourceUrl: string;
  publishedAt: string;
  pitType: string;
}

export function parseMetadata(text: string): { metadata: SnapshotMetadata; body: string } {
  const meta: SnapshotMetadata = { brand: '', sourceUrl: '', publishedAt: '', pitType: '' };
  const lines = text.split('\n');
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '---' || line === '') {
      bodyStart = i + 1;
      break;
    }
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const key = match[1]!.toLowerCase();
      const val = match[2]!.trim();
      if (key === 'brand') meta.brand = val;
      if (key === 'source_url') meta.sourceUrl = val;
      if (key === 'published_at') meta.publishedAt = val;
      if (key === 'pit_type') meta.pitType = val;
    }
  }

  return { metadata: meta, body: lines.slice(bodyStart).join('\n').trim() };
}

// ────────────────────────────────────────────────
// 价格解析
// ────────────────────────────────────────────────

function parsePrice(text: string): number {
  // 匹配：¥499 / RMB 499 / 499元 / 499.00 / 定金100 / 定金 100
  const patterns = [
    /[¥￥]\s*(\d+(?:\.\d+)?)/,
    /RMB\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*元/,
    /(\d+(?:\.\d+)?)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return Math.round(parseFloat(m[1]) * 100);
  }
  return 0;
}

function extractDepositPrice(text: string): number {
  const m = text.match(/定金\s*[：:¥￥]?\s*(\d+(?:\.\d+)?)/);
  return m?.[1] ? Math.round(parseFloat(m[1]) * 100) : 0;
}

function extractBalancePrice(text: string): number {
  const m = text.match(/尾款\s*[：:¥￥]?\s*(\d+(?:\.\d+)?)/);
  if (m?.[1]) return Math.round(parseFloat(m[1]) * 100);
  const m2 = text.match(/补款\s*[：:¥￥]?\s*(\d+(?:\.\d+)?)/);
  return m2?.[1] ? Math.round(parseFloat(m2[1]) * 100) : 0;
}

function extractFullPrice(text: string): number {
  const m = text.match(/全款\s*[：:¥￥]?\s*(\d+(?:\.\d+)?)/);
  if (m?.[1]) return Math.round(parseFloat(m[1]) * 100);
  return parsePrice(text);
}

// ────────────────────────────────────────────────
// 批次解析
// ────────────────────────────────────────────────

function parseReleaseNo(text: string): number {
  const patterns = [
    { re: /一期|第1期|第一批/, no: 1 },
    { re: /二期|第2期|第二批/, no: 2 },
    { re: /三期|第3期|第三批/, no: 3 },
    { re: /四期|第4期|第四批/, no: 4 },
    { re: /五期|第5期|第五批/, no: 5 },
  ];
  for (const { re, no } of patterns) {
    if (re.test(text)) return no;
  }
  const dyn = text.match(/第(\d+)[期批]/);
  if (dyn?.[1]) return parseInt(dyn[1], 10);
  return 0;
}

function parseReleaseType(text: string): AnnouncementProduct['releaseType'] {
  if (/再贩|返场|复刻|复出|补货|追加/.test(text)) return 'rerelease';
  if (/预约|预定|预订|定金|预售/.test(text)) return 'reservation';
  if (/现货|现发|即发/.test(text)) return 'spot';
  if (/抽选|抽签|摇号/.test(text)) return 'lottery';
  if (/首发|首贩|初版/.test(text)) return 'first_release';
  return 'unknown';
}

function parseSaleStatus(text: string): string {
  if (/售罄|sold.?out|已售完/.test(text)) return 'SOLD_OUT';
  if (/结束|截止|完结|已结束/.test(text)) return 'ENDED';
  if (/尾款|补款|尾款支付/.test(text)) return 'ON_SALE';
  if (/预约|预定|定金|预售/.test(text)) return 'PRE_ORDER';
  if (/现货|即发/.test(text)) return 'ON_SALE';
  if (/即将|预告|敬请期待/.test(text)) return 'UPCOMING';
  return 'ON_SALE';
}

function parseLifecycleStatus(text: string): string {
  if (/售罄|已售完/.test(text)) return 'sold_out';
  if (/结束|截止|完结/.test(text)) return 'ended';
  if (/预约|预定|定金|预售|尾款|补款|现货|即发/.test(text)) return 'active';
  if (/即将|预告/.test(text)) return 'upcoming';
  return 'active';
}

// ────────────────────────────────────────────────
// 时间解析
// ────────────────────────────────────────────────

function extractStartTime(text: string): string | null {
  const m = text.match(/(?:发售|开售|预约|开始)(?:时间)?[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/);
  return m?.[1] || null;
}

function extractEndTime(text: string): string | null {
  const m = text.match(/(?:截止|结束|停止)(?:时间)?[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/);
  return m?.[1] || null;
}

function extractBalanceDueTime(text: string): string | null {
  const m = text.match(/尾款(?:截止|支付|时间)[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/);
  return m?.[1] || null;
}

function extractShipTime(text: string): string | null {
  const m = text.match(/(?:发货|预计发货)(?:时间)?[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?)/);
  return m?.[1] || null;
}

// ────────────────────────────────────────────────
// 标题提取
// ────────────────────────────────────────────────

function extractTitle(text: string, metadata: SnapshotMetadata): string {
  // 尝试从文本中提取商品名
  // 常见模式：「商品名」/ 商品名 / "商品名"
  const patterns = [
    /[「「]([^」」]+)[」」]/,
    /"([^"]+)"/,
    /名称[：:]\s*(.+)/,
    /商品[：:]\s*(.+)/,
    /款式[：:]\s*(.+)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1]!.trim();
  }
  // 取第一行非空文本
  const firstLine = text.split('\n').find(l => l.trim().length > 2);
  return firstLine?.trim().slice(0, 60) || '未知商品';
}

// ────────────────────────────────────────────────
// 主解析函数
// ────────────────────────────────────────────────

/**
 * 解析公告文本，提取发售信息
 * @param text - 公告正文
 * @param metadata - 元数据（品牌、来源等）
 * @returns 解析结果
 */
export function parseAnnouncement(text: string, metadata: SnapshotMetadata): AnnouncementResult {
  const warnings: string[] = [];
  const products: AnnouncementProduct[] = [];

  // 按段落分割（每个段落可能是一个商品）
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);

  for (const para of paragraphs) {
    const trimmed = para.trim();

    // 跳过太短的段落
    if (trimmed.length < 5) continue;

    const title = extractTitle(trimmed, metadata);
    const releaseNo = parseReleaseNo(trimmed);
    const releaseType = parseReleaseType(trimmed);
    const saleStatus = parseSaleStatus(trimmed);
    const lifecycleStatus = parseLifecycleStatus(trimmed);
    const isRerelease = /再贩|返场|复刻/.test(trimmed);
    const isSoldOut = /售罄|已售完/.test(trimmed);

    const depositPrice = extractDepositPrice(trimmed);
    const balancePrice = extractBalancePrice(trimmed);
    const fullPrice = extractFullPrice(trimmed);

    const startAt = extractStartTime(trimmed);
    const endAt = extractEndTime(trimmed);
    const balanceDueAt = extractBalanceDueTime(trimmed);
    const shipAt = extractShipTime(trimmed);

    // 检测坑向
    let pitType: AnnouncementProduct['pitType'] = 'OTHER';
    if (/lolita|jsk|op\b|sk\b|bonnet|petti|lo裙|lo裙/i.test(trimmed)) pitType = 'LOLITA';
    else if (/jk|水手服|格裙|制服/.test(trimmed)) pitType = 'JK';
    else if (/汉服|襦裙|马面|宋制|明制|唐制/.test(trimmed)) pitType = 'HANFU';
    else if (metadata.pitType) {
      const mt = metadata.pitType.toUpperCase();
      if (mt === 'JK' || mt === 'LOLITA' || mt === 'HANFU') pitType = mt as AnnouncementProduct['pitType'];
    }

    // 分类
    let category = '其他';
    if (/jsk/i.test(trimmed)) category = 'JSK';
    else if (/\bop\b/i.test(trimmed)) category = 'OP';
    else if (/\bsk\b/i.test(trimmed)) category = 'SK';
    else if (/套装|set/i.test(trimmed)) category = '套装';
    else if (/格裙|百褶裙/.test(trimmed)) category = '格裙';
    else if (/水手服/.test(trimmed)) category = '水手服';

    // 批次名
    const releaseName = releaseNo > 0 ? `${releaseNo}期` : (releaseType !== 'unknown' ? {
      rerelease: '再贩', reservation: '预约', spot: '现货', lottery: '抽选', first_release: '首发', unknown: '',
    }[releaseType] : '');

    // 置信度
    let confidence = 40;
    if (releaseNo > 0) confidence += 20;
    if (releaseType !== 'unknown') confidence += 15;
    if (fullPrice > 0) confidence += 10;
    if (depositPrice > 0 || balancePrice > 0) confidence += 10;
    if (startAt) confidence += 5;
    confidence = Math.min(100, confidence);

    // 警告
    if (releaseNo === 0 && releaseType === 'unknown') {
      warnings.push(`[${title}] 无法识别批次号和发售类型`);
    }
    if (fullPrice === 0) {
      warnings.push(`[${title}] 无法识别价格`);
    }

    const sourceUrl = metadata.sourceUrl || '';

    products.push({
      title,
      brand: metadata.brand || '',
      pitType,
      category,
      releaseName: releaseName || '未知批次',
      releaseNo,
      releaseType,
      saleStatus,
      depositPriceCents: depositPrice,
      balancePriceCents: balancePrice,
      fullPriceCents: fullPrice,
      startAt,
      endAt,
      balanceDueAt,
      shipAt,
      isRerelease,
      isSoldOut,
      lifecycleStatus,
      confidence,
      sourceUrl,
      rawText: trimmed,
      warnings: [],
    });
  }

  if (products.length === 0) {
    warnings.push('未从文本中解析出任何商品信息');
  }

  return { products, warnings };
}
