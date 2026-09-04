import { badRequest, conflict, notFound } from '../lib/problem.js';
import { newId, nowIso } from '../lib/id.js';
import { normalizeSearchTerm, resolveSearchTerms, type SearchAliasRow } from '../lib/search-terms.js';
import { CATEGORY_ALIASES } from '../lib/search-alias-words.js';
import type { AppRepository, FeedQuery, FeedResult } from './contracts.js';
import type {
  AiConfirmationInput,
  AiImportTask,
  BrandFollower,
  BrandInfo,
  BrandProductItem,
  ContentFeedItem,
  CreateUserEventInput,
  CreateWishlistInput,
  MediaObject,
  PersonalScoreInput,
  PersonalScoreResult,
  Product,
  RankingItem,
  RankingTab,
  SearchQuery,
  SearchResult,
  StyleDetail,
  SyncOperationInput,
  SyncReceipt,
  TrendSummary,
  CalendarEvent,
  UserEvent,
  UserProfile,
  WishlistItem,
} from '../types.js';
import type { CommunityPost, CommunityPostPage, CommunityPostQuery, CreateCommunityPostInput, CreateFeedbackInput, FeedbackRecord, UserAsset, UserAssetKind, UserSettingKey } from './contracts.js';
import { generateFeedReason, computeRankingScore, formatPriceSummary, getReleaseTypeName, mergeTags } from '../intelligence/feed-ranker.js';
import { buildTrendSummary } from '../intelligence/trend-engine.js';
import { computePersonalScore, type UserPreference } from '../intelligence/personal-score.js';


type PageCursor = { v: number; score: number; id: string; scope: string; rank?: number };

function pageScope(parts: string[]): string {
  return parts.join('\u001f');
}

function encodePageCursor(score: number, id: string, scope: string, rank?: number): string {
  const cursor: PageCursor = rank == null
    ? { v: 1, score, id, scope }
    : { v: 2, score, id, scope, rank };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodePageCursor(value: string, expectedScope: string): PageCursor | null {
  if (value === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PageCursor>;
    if ((parsed.v !== 1 && parsed.v !== 2) || typeof parsed.score !== 'number' || typeof parsed.id !== 'string' || parsed.id === '') throw new Error('invalid');
    if (parsed.scope !== expectedScope) throw badRequest('游标与当前筛选条件不匹配，请重新加载');
    return parsed as PageCursor;
  } catch (error) {
    if (error instanceof Error && error.message === '游标与当前筛选条件不匹配，请重新加载') throw error;
    throw badRequest('分页游标无效，请重新加载');
  }
}

/** 搜索关键词 → 坑向分类别名（已废弃：Phase 2.2-A 改为 aliases 表数据驱动，见 resolveSearchAliases） */

function seedProducts(): Product[] {
  const now = nowIso();
  return [
    {
      id: 'prd_jk_navy_45', brandId: 'br_rabbit', brandName: '兔缝缝', title: '深蓝格裙 45cm',
      category: 'JK', subCategory: '格裙', status: 'ON_SALE', coverUrl: 'https://images.example.invalid/jk-navy-cover.jpg',
      images: ['https://images.example.invalid/jk-navy-1.jpg', 'https://images.example.invalid/jk-navy-2.jpg'],
      priceCents: 12800, originalPriceCents: 16800, priceType: 'FULL', depositCents: 0, balanceCents: 0,
      colorTags: ['绀色'], materialTags: ['涤纶'], featureTags: ['日常'], variants: [],
      description: '深蓝格纹制服裙演示数据', shopUrl: '', createdAt: now, updatedAt: now, styleId: null, currentRelease: null,
    },
    {
      id: 'prd_lolita_moon', brandId: 'br_starcat', brandName: '星辰猫', title: '月光曲 JSK',
      category: 'LOLITA', subCategory: 'JSK', status: 'PRE_ORDER', coverUrl: 'https://images.example.invalid/moon-jsk-cover.jpg',
      images: ['https://images.example.invalid/moon-jsk-1.jpg', 'https://images.example.invalid/moon-jsk-2.jpg'],
      priceCents: 36800, originalPriceCents: 39800, priceType: 'DEPOSIT', depositCents: 10000, balanceCents: 26800,
      colorTags: ['白色', '黑色'], materialTags: ['棉'], featureTags: ['甜系'], variants: [],
      description: '月光主题 JSK 演示数据', shopUrl: '', createdAt: now, updatedAt: now, styleId: null, currentRelease: null,
    },
    {
      id: 'prd_hanfu_song', brandId: 'br_flower', brandName: '花笺', title: '宋制旋裙套装',
      category: 'HANFU', subCategory: '旋裙', status: 'UPCOMING', coverUrl: 'https://images.example.invalid/hanfu-song-cover.jpg',
      images: ['https://images.example.invalid/hanfu-song-1.jpg'],
      priceCents: 25800, originalPriceCents: 0, priceType: 'INTENTION', depositCents: 0, balanceCents: 0,
      colorTags: ['米白'], materialTags: ['雪纺'], featureTags: ['茶会'], variants: [],
      description: '宋制汉服演示数据', shopUrl: '', createdAt: now, updatedAt: now, styleId: null, currentRelease: null,
    },
  ];
}

function toFeed(product: Product): ContentFeedItem {
  const feedReason = generateFeedReason({
    saleStatus: product.status,
    releaseType: 'unknown',
    isRerelease: false,
    isNew: true,
    brandHeatScore: 50,
    hasPriceDrop: false,
    priceTrend: 'stable',
    feedScore: 1,
  });
  return {
    id: `feed_${product.id}`,
    feedType: 'product',
    entityId: product.id,
    title: product.title,
    subtitle: product.brandName,
    coverUrl: product.coverUrl,
    secondaryCoverUrl: product.images[1] ?? '',
    brandId: product.brandId,
    brandName: product.brandName,
    category: product.category,
    pitType: product.category,
    subCategory: product.subCategory,
    price: product.priceCents,
    originalPrice: product.originalPriceCents,
    priceSummary: formatPriceSummary(product.priceCents),
    priceType: product.priceType,
    depositCents: product.depositCents,
    balanceCents: product.balanceCents,
    fullPriceCents: product.priceCents,
    colorTags: product.colorTags,
    materialTags: product.materialTags,
    saleStatus: product.status,
    releaseType: 'unknown',
    releaseTypeName: '未知',
    tags: [],
    feedScore: 1,
    rankingScore: 1,
    feedReason,
    badgeText: '',
    eventStartAt: '',
    eventEndAt: '',
    liked: false,
    saved: false,
    sourceLabel: '演示数据',
    publishedAt: product.createdAt,
    createdAt: product.createdAt,
  };
}

export class MemoryRepository implements AppRepository {
  private readonly users = new Map<string, UserProfile>();
  private readonly wechatUsers = new Map<string, string>();
  private readonly products = seedProducts();
  private readonly styles = new Map<string, StyleDetail>();
  private readonly syncOps = new Map<string, SyncReceipt>();
  private readonly syncCheckpoints = new Map<string, string>();
  private readonly media = new Map<string, MediaObject>();
  private readonly aiTasks = new Map<string, AiImportTask>();
  private readonly assets = new Map<string, unknown>();
  private readonly userAssets = new Map<string, UserAsset>();
  private readonly userSettings = new Map<string, Record<string, unknown>>();
  private readonly communityPosts = new Map<string, Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'>>();
  private readonly postLikes = new Set<string>();
  private readonly feedbackRecords = new Map<string, FeedbackRecord>();

  async close(): Promise<void> {}
  async ready(): Promise<boolean> { return true; }

  async ensureDevUser(nickname: string): Promise<UserProfile> {
    // dev 用户按昵称隔离：同昵称幂等复用；不同昵称生成不同用户（用户隔离测试依赖）
    const existing = [...this.users.values()].find((u) => u.nickname === nickname);
    if (existing) return existing;
    const user: UserProfile = { id: newId('usr'), nickname, avatarUrl: '', status: 'active', createdAt: nowIso() };
    this.users.set(user.id, user);
    return user;
  }

  async ensureWechatUser(openId: string, nickname: string): Promise<UserProfile> {
    const existingId = this.wechatUsers.get(openId);
    if (existingId) return this.users.get(existingId)!;
    const user: UserProfile = { id: newId('usr'), nickname, avatarUrl: '', status: 'active', createdAt: nowIso() };
    this.users.set(user.id, user);
    this.wechatUsers.set(openId, user.id);
    return user;
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    return this.users.get(userId) ?? null;
  }

  // ─── P0-A: 用户会话（refresh token 轮换） ────────────────────────────

  private readonly sessions = new Map<string, { userId: string; expiresAt: string }>();

  async createUserSession(userId: string, _deviceId: string, refreshTokenHash: string, expiresAt: string): Promise<void> {
    this.sessions.set(refreshTokenHash, { userId, expiresAt });
  }

  async rotateUserSession(oldHash: string, newHash: string, newExpiresAt: string): Promise<boolean> {
    const existing = this.sessions.get(oldHash);
    if (!existing || new Date(existing.expiresAt).getTime() < Date.now()) return false;
    this.sessions.delete(oldHash);
    this.sessions.set(newHash, { userId: existing.userId, expiresAt: newExpiresAt });
    return true;
  }

  async revokeUserSession(refreshTokenHash: string): Promise<boolean> {
    return this.sessions.delete(refreshTokenHash);
  }

  async listFeed(userId: string | null, query: FeedQuery): Promise<FeedResult> {
    const allowedCategories = new Set(['JK', 'LOLITA', 'HANFU', 'OTHER']);
    let categoryFilter: string[] = [];
    if (query.categories) {
      categoryFilter = query.categories.split(',').map(c => c.trim().toUpperCase()).filter(c => allowedCategories.has(c));
    } else if (allowedCategories.has(query.category)) {
      categoryFilter = [query.category];
    }

    let rows = [...this.products];
    if (categoryFilter.length > 0) rows = rows.filter((item) => categoryFilter.includes(item.category));
    if (query.channel === 'new') {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      rows = rows.filter((item) => new Date(item.createdAt).getTime() >= cutoff);
    } else if (query.channel === 'reservation') {
      rows = rows.filter((item) => item.status === 'PRE_ORDER');
    } else if (query.channel === 'spot') {
      // Phase 2.6：现货频道——ON_SALE 状态（内存实现无 release 数据源）
      rows = rows.filter((item) => item.status === 'ON_SALE');
    } else if (query.channel === 'price_drop') {
      rows = rows.filter((item) => item.originalPriceCents > item.priceCents && item.priceCents > 0);
    } else if (query.channel === 'outfit') {
      rows = [];
    }

    rows.sort((a, b) => b.id.localeCompare(a.id));
    const scope = pageScope(['feed', query.channel, categoryFilter.join(',')]);
    const cursor = decodePageCursor(query.cursor, scope);
    if (cursor) rows = rows.filter((item) => item.id < cursor.id);

    const total = rows.length;
    const visible = rows.slice(0, query.limit);
    const items = visible.map(toFeed);
    if (userId) {
      const savedIds = new Set(this.wishlists.filter(w => w.userId === userId && w.productId !== null).map(w => w.productId as string));
      for (const item of items) item.saved = savedIds.has(item.entityId);
    }
    const hasMore = rows.length > visible.length;
    const last = visible.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodePageCursor(1, last.id, scope) : '',
      hasMore,
      totalHint: total,
    };
  }

  async getProduct(_userId: string | null, productId: string, _releaseId?: string): Promise<Product | null> {
    const product = this.products.find((item) => item.id === productId) ?? null;
    // 内存实现（测试/本地）：无 product_releases 数据源，currentRelease 恒为 null
    if (product) product.currentRelease = null;
    return product;
  }

  async getStyle(styleId: string): Promise<StyleDetail | null> {
    return this.styles.get(styleId) ?? null;
  }

  // ─── Phase 2.6: 品牌目录（内存实现基于种子商品派生） ────────────────

  async listBrands(userId?: string | null): Promise<BrandInfo[]> {
    const followedIds = userId ? await this.getFollowedBrandIds(userId) : [];
    const followedSet = new Set(followedIds);
    const byBrand = new Map<string, { brandId: string; brandName: string }>();
    for (const p of this.products) {
      if (!byBrand.has(p.brandId)) byBrand.set(p.brandId, { brandId: p.brandId, brandName: p.brandName });
    }
    return [...byBrand.values()].map((b, index) => this.toBrandInfo(b.brandId, b.brandName, followedSet, index));
  }

  async getBrandById(brandId: string, userId?: string | null): Promise<BrandInfo | null> {
    const product = this.products.find((p) => p.brandId === brandId);
    if (!product) return null;
    const followedIds = userId ? await this.getFollowedBrandIds(userId) : [];
    return this.toBrandInfo(brandId, product.brandName, new Set(followedIds), 0);
  }

  async listBrandProducts(brandId: string, limit = 50): Promise<BrandProductItem[]> {
    return this.products
      .filter((p) => p.brandId === brandId)
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, Math.min(100, Math.max(1, limit)))
      .map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        brandId: p.brandId,
        brandName: p.brandName,
        category: p.category,
        priceCents: p.priceCents,
        originalPriceCents: p.originalPriceCents,
        badgeText: p.status === 'PRE_ORDER' ? '预约' : p.status === 'ON_SALE' ? '现货' : '',
        coverUrl: p.coverUrl,
        createdAt: p.createdAt,
      }));
  }

  // ─── Phase 2.6: 三坑榜单（内存实现基于种子商品派生） ────────────────

  async getRanking(tab: RankingTab, limit = 50): Promise<RankingItem[]> {
    const cap = Math.min(100, Math.max(1, limit));
    let rows = [...this.products];
    if (tab === 'hot') {
      // 热榜：按收藏数 desc（内存实现按 wishlist 计数）
      rows.sort((a, b) => {
        const aFav = this.wishlists.filter(w => w.productId === a.id).length;
        const bFav = this.wishlists.filter(w => w.productId === b.id).length;
        return bFav - aFav || b.id.localeCompare(a.id);
      });
    } else if (tab === 'new') {
      rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return rows.slice(0, cap).map((p, index) => {
      const favoriteCount = this.wishlists.filter(w => w.productId === p.id).length;
      return {
        rank: index + 1,
        entityId: p.id,
        title: p.title,
        brandName: p.brandName,
        coverUrl: p.coverUrl,
        priceCents: p.priceCents,
        category: p.category,
        favoriteCount,
        releaseTypeName: p.status === 'PRE_ORDER' ? '预约' : p.status === 'ON_SALE' ? '现货' : '首发',
        daysAgo: Math.max(0, Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000)),
        reservationCount: p.status === 'PRE_ORDER' ? 1 : 0,
      };
    });
  }

  private toBrandInfo(brandId: string, brandName: string, followedSet: Set<string>, index: number): BrandInfo {
    const product = this.products.find((p) => p.brandId === brandId);
    return {
      id: brandId,
      name: brandName,
      nameEn: '',
      logo: '',
      description: product?.description ?? '',
      category: product?.category ?? '',
      officialUrl: '',
      followerCount: this.brandFollowers.filter(f => f.brandId === brandId).length,
      isFollowed: followedSet.has(brandId),
      createdAt: product?.createdAt ?? nowIso(),
      updatedAt: product?.updatedAt ?? nowIso(),
    };
  }

  /** 测试辅助：注入款式数据（Phase 2.1 Style Entity） */
  seedStyle(style: StyleDetail): void {
    this.styles.set(style.id, style);
  }

  // ─── Phase 2.2-A: 搜索别名（词库数据驱动，替代旧硬编码 resolveAliasCategory） ──

  private readonly aliases = new Map<string, SearchAliasRow>();

  constructor() {
    // 默认加载分类词（与生产 seed 词表同源）；brand/style 别名依赖实体，由测试注入
    for (const word of CATEGORY_ALIASES) {
      this.aliases.set(`${word.aliasType}:${word.term}`, {
        id: `alias_${word.aliasType}_${word.term}`,
        term: word.term,
        canonicalTerm: word.canonicalTerm,
        aliasType: word.aliasType,
        status: word.status,
        confidence: word.confidence,
        source: word.source,
      });
    }
  }

  /** 测试辅助：注入别名（key = aliasType:term） */
  seedSearchAlias(alias: SearchAliasRow): void {
    this.aliases.set(`${alias.aliasType}:${alias.term}`, alias);
  }

  /** 测试辅助：注入/替换商品（覆盖默认 seed，用于 style/brand 关联场景） */
  seedProduct(product: Product): void {
    const index = this.products.findIndex((p) => p.id === product.id);
    if (index >= 0) this.products[index] = product;
    else this.products.push(product);
  }

  /** 搜索别名解析：term 精确/包含匹配 active 词（与 postgres.ts resolveSearchAliases 同语义） */
  async resolveSearchAliases(normalizedTerm: string): Promise<SearchAliasRow[]> {
    if (normalizedTerm === '') return [];
    return [...this.aliases.values()]
      .filter((row) => row.status === 'active' && normalizedTerm.includes(row.term))
      .sort((a, b) => {
        const aExact = a.term === normalizedTerm ? 0 : 1;
        const bExact = b.term === normalizedTerm ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return b.confidence - a.confidence;
      });
  }

  async applySyncBatch(userId: string, operations: SyncOperationInput[]): Promise<SyncReceipt[]> {
    const receipts: SyncReceipt[] = [];
    for (const operation of operations) {
      const key = `${userId}:${operation.opId}`;
      const existing = this.syncOps.get(key);
      if (existing) {
        receipts.push(existing);
        continue;
      }
      const receipt: SyncReceipt = { opId: operation.opId, result: 'accepted', serverVersion: Date.now() };
      this.syncOps.set(key, receipt);
      receipts.push(receipt);
    }
    this.syncCheckpoints.set(userId, nowIso());
    return receipts;
  }

  async getSyncCheckpoint(userId: string): Promise<string> {
    return this.syncCheckpoints.get(userId) ?? '';
  }

  async createMedia(input: Omit<MediaObject, 'id' | 'createdAt' | 'deletedAt' | 'sizeBytes'>): Promise<MediaObject> {
    const media: MediaObject = { ...input, id: newId('med'), sizeBytes: 0, createdAt: nowIso(), deletedAt: null };
    this.media.set(media.uploadId, media);
    return media;
  }

  async getMediaByUploadId(userId: string, uploadId: string): Promise<MediaObject | null> {
    const media = this.media.get(uploadId);
    return media?.ownerUserId === userId ? media : null;
  }

  async getMediaByObjectKey(userId: string, objectKey: string): Promise<MediaObject | null> {
    for (const media of this.media.values()) {
      if (media.ownerUserId === userId && media.objectKey === objectKey && media.deletedAt === null) return media;
    }
    return null;
  }

  async markMediaUploaded(userId: string, uploadId: string, sizeBytes: number): Promise<MediaObject> {
    const media = await this.getMediaByUploadId(userId, uploadId);
    if (!media) throw notFound('上传任务不存在');
    media.sizeBytes = sizeBytes;
    return media;
  }

  async deleteMediaByObjectKey(userId: string, objectKey: string): Promise<boolean> {
    for (const media of this.media.values()) {
      if (media.ownerUserId === userId && media.objectKey === objectKey && media.deletedAt === null) {
        media.deletedAt = nowIso();
        return true;
      }
    }
    return false;
  }

  async createAiTask(task: AiImportTask): Promise<AiImportTask> {
    this.aiTasks.set(task.taskId, task);
    return task;
  }

  async getAiTask(userId: string, taskId: string): Promise<AiImportTask | null> {
    const task = this.aiTasks.get(taskId);
    return task?.userId === userId ? task : null;
  }

  async updateAiTask(
    taskId: string,
    userId: string,
    patch: Partial<Pick<AiImportTask, 'state' | 'suggestion' | 'confidence' | 'fieldConfidence' | 'evidence' | 'warnings' | 'model'>>,
  ): Promise<AiImportTask | null> {
    const task = this.aiTasks.get(taskId);
    if (!task || task.userId !== userId) return null;
    if (patch.state !== undefined) task.state = patch.state;
    if (patch.suggestion !== undefined) task.suggestion = patch.suggestion;
    if (patch.confidence !== undefined) task.confidence = patch.confidence;
    if (patch.fieldConfidence !== undefined) task.fieldConfidence = patch.fieldConfidence;
    if (patch.evidence !== undefined) task.evidence = patch.evidence;
    if (patch.warnings !== undefined) task.warnings = patch.warnings;
    if (patch.model !== undefined) task.model = { provider: patch.model.provider, name: patch.model.name, version: patch.model.version };
    return task;
  }

  private readonly aiConfirmOps = new Set<string>();

  async confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask> {
    const task = await this.getAiTask(userId, taskId);
    if (!task) throw notFound('AI 导入任务不存在');
    if (task.state === 'confirmed') return task; // 幂等：已确认直接返回
    if (task.state !== 'ready') throw conflict('任务尚未识别完成，无法确认');
    // 仅审计关联：目标 purchase 必须存在且属于当前用户；不建单、不覆盖
    if (!this.userAssets.has(this.userAssetKey(userId, 'purchase', input.targetId))) {
      throw notFound('目标订单不存在或不属于当前用户');
    }
    if (input.opId && this.aiConfirmOps.has(`${userId}:${input.opId}`)) return task; // 同 opId 重试不重复记录
    this.aiConfirmOps.add(`${userId}:${input.opId ?? taskId}`);
    task.state = 'confirmed';
    task.confirmedAt = nowIso();
    task.targetType = 'purchase';
    task.targetId = input.targetId;
    return task;
  }

  async searchProducts(query: SearchQuery, userId: string | null = null): Promise<SearchResult> {
    // Phase 2.2-A 搜索链：normalize（NFKC）→ alias 解析（category/brand/style）→ 文本/实体搜索
    const normalized = normalizeSearchTerm(query.q);
    const resolved = normalized === '' ? null : resolveSearchTerms(normalized, await this.resolveSearchAliases(normalized));

    let rows = this.products.filter(p => {
      if (resolved) {
        const q = normalized;
        const textHit = p.title.toLowerCase().includes(q) || p.brandName.toLowerCase().includes(q);
        const categoryHit = resolved.categoryMatches.includes(p.category);
        const brandHit = resolved.brandIds.includes(p.brandId);
        const styleHit = resolved.styleIds.includes(p.styleId ?? '');
        if (!textHit && !categoryHit && !brandHit && !styleHit) return false;
      }
      if (query.category && p.category !== query.category) return false;
      if (query.saleStatus && p.status !== query.saleStatus) return false;
      if (query.minPrice > 0 && p.priceCents < query.minPrice) return false;
      if (query.maxPrice > 0 && p.priceCents > query.maxPrice) return false;
      return true;
    });

    // Phase 2.2-A 相关性排序：exact entity > exact text > prefix/category > contains（仅关键词搜索时启用）
    const hasKeyword = resolved != null;
    const rankOf = (p: Product): number => {
      const title = p.title.toLowerCase();
      const brand = p.brandName.toLowerCase();
      if (resolved && (resolved.brandIds.includes(p.brandId) || resolved.styleIds.includes(p.styleId ?? ''))) return 6;
      if (resolved && (title === normalized || brand === normalized)) return 5;
      if (resolved && resolved.categoryMatches.includes(p.category)) return 4;
      if (title.startsWith(normalized) || brand.startsWith(normalized)) return 4;
      return 3;
    };
    if (hasKeyword) {
      rows.sort((a, b) => rankOf(b) - rankOf(a) || b.id.localeCompare(a.id));
    } else {
      rows.sort((a, b) => b.id.localeCompare(a.id));
    }

    const scope = pageScope(['search', query.q, query.category, query.saleStatus, query.releaseStatus, query.brandId, String(query.minPrice), String(query.maxPrice)]);
    const cursor = decodePageCursor(query.cursor, scope);
    if (cursor) {
      if (hasKeyword) {
        const rank = cursor.rank;
        if (cursor.v !== 2 || typeof rank !== 'number') throw badRequest('游标无效，请重新加载');
        rows = rows.filter((item) => {
          const itemRank = rankOf(item);
          return itemRank < rank || (itemRank === rank && item.id < cursor.id);
        });
      } else {
        rows = rows.filter((item) => item.id < cursor.id);
      }
    }

    const total = rows.length;
    const visible = rows.slice(0, query.limit);
    const items = visible.map(p => ({ ...toFeed(p), sourceLabel: '搜索结果' }));
    if (userId) {
      const savedIds = new Set(this.wishlists.filter(w => w.userId === userId && w.productId !== null).map(w => w.productId as string));
      for (const item of items) item.saved = savedIds.has(item.entityId);
    }
    const hasMore = rows.length > visible.length;
    const last = visible.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodePageCursor(1, last.id, scope, hasKeyword ? rankOf(last) : undefined) : '',
      hasMore,
      totalHint: total,
    };
  }

  async getTrendSummary(_period?: string): Promise<TrendSummary> {
    return buildTrendSummary([], []);
  }

  async listCalendar(_month: string, _limit: number = 50): Promise<CalendarEvent[]> {
    // 内存仓库无 product_releases/sale_events 数据，返回空（生产使用 postgres 驱动）
    return [];
  }

  async generateNotifications(_userId: string): Promise<UserAsset[]> {
    // 内存仓库不执行生成逻辑（生产使用 postgres 驱动）
    return [];
  }

  // ─── D8: 用户行为事件 ──────────────────────────────────────

  private readonly events: UserEvent[] = [];

  async recordEvent(userId: string | null, input: CreateUserEventInput): Promise<UserEvent> {
    const event: UserEvent = {
      id: newId('evt'),
      userId,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
      createdAt: nowIso(),
    };
    this.events.push(event);
    return event;
  }

  async getUserEvents(userId: string, eventType?: string, limit: number = 50): Promise<UserEvent[]> {
    let filtered = this.events.filter(e => e.userId === userId);
    if (eventType) filtered = filtered.filter(e => e.eventType === eventType);
    return filtered.slice(-limit).reverse();
  }

  // ─── D8: 收藏体系 ─────────────────────────────────────────

  private readonly wishlists: WishlistItem[] = [];

  async addWishlist(userId: string, input: CreateWishlistInput): Promise<WishlistItem> {
    // 幂等：同一用户 + 同一 productId 重复 POST 返回既有条目
    if (input.productId) {
      const existing = this.wishlists.find(w => w.userId === userId && w.productId === input.productId);
      if (existing) return existing;
    }
    const item: WishlistItem = {
      id: newId('wli'),
      userId,
      title: input.title,
      status: input.status,
      productId: input.productId ?? null,
      releaseId: input.releaseId ?? null,
      note: input.note ?? '',
      payloadJson: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.wishlists.push(item);
    return item;
  }

  async updateWishlistStatus(wishlistId: string, userId: string, status: string): Promise<WishlistItem> {
    const item = this.wishlists.find(w => w.id === wishlistId && w.userId === userId);
    if (!item) throw notFound('收藏项不存在');
    item.status = status as WishlistItem['status'];
    item.updatedAt = nowIso();
    return item;
  }

  async removeWishlist(wishlistId: string, userId: string): Promise<boolean> {
    const idx = this.wishlists.findIndex(w => w.id === wishlistId && w.userId === userId);
    if (idx === -1) return false;
    this.wishlists.splice(idx, 1);
    return true;
  }

  async listWishlist(userId: string, status?: string): Promise<WishlistItem[]> {
    let items = this.wishlists.filter(w => w.userId === userId);
    if (status) items = items.filter(w => w.status === status);
    return items;
  }

  async isProductWishlisted(userId: string, productId: string): Promise<boolean> {
    return this.wishlists.some(w => w.userId === userId && w.productId === productId);
  }

  // ─── D8: 品牌关注 ─────────────────────────────────────────

  private readonly brandFollowers: BrandFollower[] = [];

  /** 品牌 id 或品牌名 → 品牌 id（兼容按名关注；内存模式以种子商品品牌为准） */
  private memoryResolveBrand(brandId: string): string | null {
    const byId = this.products.find(p => p.brandId === brandId);
    if (byId) return byId.brandId;
    const byName = this.products.find(p => p.brandName === brandId);
    return byName ? byName.brandId : null;
  }

  async followBrand(userId: string, brandId: string): Promise<BrandFollower> {
    const resolved = this.memoryResolveBrand(brandId);
    if (!resolved) throw notFound('品牌不存在');
    const existing = this.brandFollowers.find(f => f.userId === userId && f.brandId === resolved);
    if (existing) return existing;
    const follower: BrandFollower = { userId, brandId: resolved, createdAt: nowIso() };
    this.brandFollowers.push(follower);
    return follower;
  }

  async unfollowBrand(userId: string, brandId: string): Promise<boolean> {
    const resolved = this.memoryResolveBrand(brandId);
    if (!resolved) return false;
    const idx = this.brandFollowers.findIndex(f => f.userId === userId && f.brandId === resolved);
    if (idx === -1) return false;
    this.brandFollowers.splice(idx, 1);
    return true;
  }

  async isFollowingBrand(userId: string, brandId: string): Promise<boolean> {
    return this.brandFollowers.some(f => f.userId === userId && f.brandId === brandId);
  }

  async getFollowedBrandIds(userId: string): Promise<string[]> {
    return this.brandFollowers.filter(f => f.userId === userId).map(f => f.brandId);
  }

  // ─── D8: 个性化评分 ───────────────────────────────────────

  async getUserPreference(userId: string): Promise<UserPreference> {
    const followedBrandIds = await this.getFollowedBrandIds(userId);
    const wishlists = await this.listWishlist(userId);
    const wishlistCategories = [...new Set(
      wishlists
        .map(w => this.products.find(p => p.id === w.productId)?.category)
        .filter(Boolean) as string[],
    )];
    const wishlistTags = wishlists
      .flatMap(w => {
        const p = this.products.find(pr => pr.id === w.productId);
        return p ? [...(p as any).season_tags ?? [], ...(p as any).scene_tags ?? [], ...(p as any).element_tags ?? []] : [];
      });
    const viewEvents = this.events.filter(e => e.userId === userId && e.eventType === 'VIEW_PRODUCT');
    const viewedCategories = [...new Set(
      viewEvents
        .map(e => this.products.find(p => p.id === e.targetId)?.category)
        .filter(Boolean) as string[],
    )];
    const searchEvents = this.events.filter(e => e.userId === userId && e.eventType === 'SEARCH');
    const searchedKeywords = searchEvents.map(e => (e.metadata.q as string) ?? '').filter(Boolean);

    return { followedBrandIds, wishlistCategories, wishlistTags, viewedCategories, searchedKeywords };
  }

  async computePersonalScore(input: PersonalScoreInput): Promise<PersonalScoreResult> {
    const preference = await this.getUserPreference(input.userId);
    return computePersonalScore(input, preference);
  }
  // ─── V2.5: 页面级用户资产 ──────────────────────────────────

  private userAssetKey(userId: string, kind: UserAssetKind, assetId: string): string {
    return `${userId}:${kind}:${assetId}`;
  }

  async listUserAssets(userId: string, kind: UserAssetKind): Promise<UserAsset[]> {
    const prefix = `${userId}:${kind}:`;
    return [...this.userAssets.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, asset]) => asset)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((asset) => ({ ...asset, payload: { ...asset.payload } }));
  }

  async getUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<UserAsset | null> {
    const asset = this.userAssets.get(this.userAssetKey(userId, kind, assetId));
    return asset ? { ...asset, payload: { ...asset.payload } } : null;
  }

  async createUserAsset(userId: string, kind: UserAssetKind, assetId: string, payload: Record<string, unknown>): Promise<UserAsset> {
    const now = nowIso();
    const asset: UserAsset = {
      id: assetId, type: kind, payload: { ...payload }, version: 1, createdAt: now, updatedAt: now,
    };
    this.userAssets.set(this.userAssetKey(userId, kind, assetId), asset);
    return { ...asset, payload: { ...asset.payload } };
  }

  async updateUserAsset(userId: string, kind: UserAssetKind, assetId: string, patch: Record<string, unknown>): Promise<UserAsset | null> {
    const key = this.userAssetKey(userId, kind, assetId);
    const existing = this.userAssets.get(key);
    if (!existing) return null;
    existing.payload = { ...existing.payload, ...patch };
    existing.version += 1;
    existing.updatedAt = nowIso();
    // 尾款日期联动：更新订单尾款日 → 同步更新关联 BALANCE 提醒（remindDate）
    if (kind === 'purchase') {
      const newDeadline = (patch.balanceDueDate ?? patch.deadline) as unknown;
      if (typeof newDeadline === 'string' && newDeadline !== '') {
        for (const asset of this.userAssets.values()) {
          if (asset.type === 'reminder' && asset.payload.relatedPurchaseId === assetId && asset.payload.type === 'BALANCE') {
            asset.payload = { ...asset.payload, remindDate: newDeadline, resyncedFrom: assetId };
            asset.version += 1;
            asset.updatedAt = nowIso();
          }
        }
      }
    }
    return { ...existing, payload: { ...existing.payload } };
  }

  async deleteUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<boolean> {
    const key = this.userAssetKey(userId, kind, assetId);
    if (!this.userAssets.delete(key)) return false;
    if (kind === 'purchase') {
      // 删除订单 → 同步删除关联提醒，杜绝孤儿提醒
      for (const [reminderKey, asset] of [...this.userAssets.entries()]) {
        if (asset.type === 'reminder' && asset.payload.relatedPurchaseId === assetId) {
          this.userAssets.delete(reminderKey);
        }
      }
    }
    return true;
  }

  async getUserSetting(userId: string, key: UserSettingKey): Promise<Record<string, unknown>> {
    return { ...(this.userSettings.get(`${userId}:${key}`) ?? {}) };
  }

  async putUserSetting(userId: string, key: UserSettingKey, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.userSettings.set(`${userId}:${key}`, { ...payload });
    return { ...payload };
  }

  private communityPostView(post: Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'>, viewerUserId: string | null): CommunityPost {
    const author = this.users.get(post.authorUserId);
    const likeCount = [...this.postLikes].filter((key) => key.startsWith(`${post.id}:`)).length;
    return {
      ...post,
      authorNickname: author?.nickname ?? '三坑同好',
      likeCount,
      liked: viewerUserId !== null && this.postLikes.has(`${post.id}:${viewerUserId}`),
    };
  }

  private communityPage(viewerUserId: string | null, query: CommunityPostQuery, authorUserId?: string, productId?: string): CommunityPostPage {
    const filtered = [...this.communityPosts.values()]
      .filter((post) => authorUserId === undefined || post.authorUserId === authorUserId)
      .filter((post) => productId === undefined || post.productId === productId)
      .filter((post) => !query.category || post.category === query.category)
      .filter((post) => !query.topic || post.topic === query.topic)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = Number.parseInt(query.cursor || '0', 10) || 0;
    const items = filtered.slice(offset, offset + query.limit).map((post) => this.communityPostView(post, viewerUserId));
    const next = offset + items.length;
    return { items, nextCursor: next < filtered.length ? String(next) : '', hasMore: next < filtered.length, totalHint: filtered.length };
  }

  async listCommunityPosts(viewerUserId: string | null, query: CommunityPostQuery): Promise<CommunityPostPage> {
    return this.communityPage(viewerUserId, query);
  }

  async listMyCommunityPosts(userId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage> {
    return this.communityPage(userId, query, userId);
  }

  /** Phase 2.3-A：商品关联社区内容（商品详情「真实买家」模块数据源） */
  async listProductCommunityPosts(productId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage> {
    return this.communityPage(null, query, undefined, productId);
  }

  async createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost> {
    const now = nowIso();
    const post: Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'> = {
      ...input, authorUserId: userId, createdAt: now, updatedAt: now,
      productId: input.productId ?? null,
    };
    this.communityPosts.set(post.id, post);
    return this.communityPostView(post, userId);
  }

  async getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null> {
    const post = this.communityPosts.get(postId);
    return post ? this.communityPostView(post, viewerUserId) : null;
  }

  async setCommunityPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null> {
    if (!this.communityPosts.has(postId)) return null;
    const key = `${postId}:${userId}`;
    if (liked) this.postLikes.add(key); else this.postLikes.delete(key);
    const likeCount = [...this.postLikes].filter((value) => value.startsWith(`${postId}:`)).length;
    return { liked: this.postLikes.has(key), likeCount };
  }

  async deleteCommunityPost(userId: string, postId: string): Promise<boolean> {
    const post = this.communityPosts.get(postId);
    if (!post || post.authorUserId !== userId) return false;
    this.communityPosts.delete(postId);
    for (const key of [...this.postLikes]) if (key.startsWith(`${postId}:`)) this.postLikes.delete(key);
    return true;
  }

  async getMediaById(mediaId: string): Promise<MediaObject | null> {
    for (const media of this.media.values()) if (media.id === mediaId) return media;
    return null;
  }

  // ─── Phase 2.6: 意见反馈 ─────────────────────────────────────────────

  async createFeedback(userId: string | null, input: CreateFeedbackInput): Promise<FeedbackRecord> {
    const record: FeedbackRecord = {
      id: input.id,
      userId,
      type: input.type,
      content: input.content,
      contact: input.contact,
      images: [...input.images],
      status: 'open',
      createdAt: input.createdAt,
    };
    if (!this.feedbackRecords.has(input.id)) this.feedbackRecords.set(input.id, record);
    return record;
  }

}
