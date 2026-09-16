import { badRequest, conflict, notFound } from '../lib/problem.js';
import { newId, nowIso } from '../lib/id.js';
import { normalizeSearchTerm, resolveSearchTerms } from '../lib/search-terms.js';
import type { AppRepository, FeedQuery, FeedResult, UserInteraction } from './contracts.js';

import type {
  AiConfirmationInput,
  AiImportTask,
  AiSuggestion,
  BrandInfo,
  BrandProductItem,
  ContentFeedItem,
  MediaObject,
  PersonalScoreInput,
  PersonalScoreResult,
  Product,
  ProductImage,
  ProductVariant,
  ProductRelease,
  RankingItem,
  RankingTab,
  SearchQuery,
  SearchResult,
  CalendarEvent,
  UserProfile,
} from '../types.js';
import type { CommunityPost, CommunityPostPage, CommunityPostQuery, CreateCommunityPostInput, CreateFeedbackInput, FeedbackRecord, UserAsset, UserAssetKind } from './contracts.js';
import { generateFeedReason, computeRankingScore, formatPriceSummary, getReleaseTypeName, mergeTags } from '../intelligence/feed-ranker.js';
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

function seedProducts(): Product[] {
  const now = nowIso();
  const img = (url: string): ProductImage => ({ url, thumbnailUrl: null, width: null, height: null, sizeBytes: null, objectKey: null });
  return [
    {
      id: 'prd_jk_navy_45', brandId: 'br_rabbit', brandName: '兔缝缝', title: '深蓝格裙 45cm',
      category: 'JK', subCategory: '格裙', saleStatus: 'ON_SALE',
      coverUrl: 'https://images.example.invalid/jk-navy-cover.jpg',
      images: [img('https://images.example.invalid/jk-navy-cover.jpg'), img('https://images.example.invalid/jk-navy-2.jpg')],
      priceCents: 12800, originalPriceCents: 16800, priceType: 'FULL',
      colorTags: ['绀色'], materialTags: ['涤纶'], featureTags: ['日常'], variants: [],
      description: '深蓝格纹制服裙演示数据', shopName: '兔缝缝旗舰店',
      canonicalUrl: 'https://example.invalid/prd_jk_navy_45', sourcePlatform: 'DEMO',
      externalId: null, groupKey: null, viewCount: 0, feedScore: 1,
      visibilityStatus: 'published', createdAt: now, updatedAt: now, currentRelease: null,
    },
    {
      id: 'prd_lolita_moon', brandId: 'br_starcat', brandName: '星辰猫', title: '月光曲 JSK',
      category: 'LOLITA', subCategory: 'JSK', saleStatus: 'PRE_ORDER',
      coverUrl: 'https://images.example.invalid/moon-jsk-cover.jpg',
      images: [img('https://images.example.invalid/moon-jsk-cover.jpg'), img('https://images.example.invalid/moon-jsk-2.jpg')],
      priceCents: 36800, originalPriceCents: 39800, priceType: 'DEPOSIT',
      colorTags: ['白色', '黑色'], materialTags: ['棉'], featureTags: ['甜系'], variants: [],
      description: '月光主题 JSK 演示数据', shopName: '星辰猫工作室',
      canonicalUrl: 'https://example.invalid/prd_lolita_moon', sourcePlatform: 'DEMO',
      externalId: null, groupKey: null, viewCount: 0, feedScore: 1,
      visibilityStatus: 'published', createdAt: now, updatedAt: now, currentRelease: null,
    },
    {
      id: 'prd_hanfu_song', brandId: 'br_flower', brandName: '花笺', title: '宋制旋裙套装',
      category: 'HANFU', subCategory: '旋裙', saleStatus: 'UPCOMING',
      coverUrl: 'https://images.example.invalid/hanfu-song-cover.jpg',
      images: [img('https://images.example.invalid/hanfu-song-cover.jpg')],
      priceCents: 25800, originalPriceCents: null, priceType: 'INTENTION',
      colorTags: ['米白'], materialTags: ['雪纺'], featureTags: ['茶会'], variants: [],
      description: '宋制汉服演示数据', shopName: '花笺汉服',
      canonicalUrl: 'https://example.invalid/prd_hanfu_song', sourcePlatform: 'DEMO',
      externalId: null, groupKey: null, viewCount: 0, feedScore: 1,
      visibilityStatus: 'published', createdAt: now, updatedAt: now, currentRelease: null,
    },
  ];
}

function toFeed(product: Product): ContentFeedItem {
  const feedReason = generateFeedReason({
    saleStatus: product.saleStatus, releaseType: 'unknown', isRerelease: false, isNew: true,
    brandHeatScore: 50, hasPriceDrop: false, priceTrend: 'stable', feedScore: 1,
  });
  return {
    id: `feed_${product.id}`, feedType: 'product', entityId: product.id,
    title: product.title, subtitle: product.brandName,
    coverUrl: product.coverUrl, secondaryCoverUrl: product.images.length > 1 ? product.images[1]?.url ?? "" : '',
    brandId: product.brandId, brandName: product.brandName,
    category: product.category, pitType: product.category, subCategory: product.subCategory,
    price: product.priceCents, originalPrice: product.originalPriceCents,
    priceSummary: formatPriceSummary(product.priceCents ?? 0),
    priceType: product.priceType, depositCents: null, balanceCents: null,
    fullPriceCents: product.priceCents,
    colorTags: product.colorTags, materialTags: product.materialTags,
    saleStatus: product.saleStatus, releaseType: 'unknown', releaseTypeName: '未知',
    tags: [], feedScore: 1, rankingScore: 1, feedReason, badgeText: '',
    eventStartAt: '', eventEndAt: '', liked: false, saved: false,
    sourceLabel: '演示数据', publishedAt: product.createdAt, createdAt: product.createdAt,
  };
}

export class MemoryRepository implements AppRepository {
  private readonly users = new Map<string, UserProfile>();
  private readonly wechatUsers = new Map<string, string>();
  private readonly products = seedProducts();
  private readonly media = new Map<string, MediaObject>();
  private readonly aiTasks = new Map<string, AiImportTask>();
  private readonly userAssets = new Map<string, UserAsset>();
  private readonly userSettings = new Map<string, Record<string, unknown>>();
  private readonly communityPosts = new Map<string, Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'>>();
  private readonly interactions: UserInteraction[] = [];
  private readonly feedbackRecords = new Map<string, FeedbackRecord>();
  private readonly sessions = new Map<string, { userId: string; expiresAt: string }>();
  private readonly aiConfirmOps = new Set<string>();

  async close(): Promise<void> {}
  async ready(): Promise<boolean> { return true; }

  async ensureDevUser(nickname: string): Promise<UserProfile> {
    const existing = [...this.users.values()].find((u) => u.nickname === nickname);
    if (existing) return existing;
    const user: UserProfile = { id: 'usr_dev', nickname, avatarUrl: '', status: 'active', createdAt: nowIso() };
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

  // ─── Sessions ──────────────────────────────────────────

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

  // ─── Feed ──────────────────────────────────────────────

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
      rows = rows.filter((item) => item.saleStatus === 'PRE_ORDER');
    } else if (query.channel === 'spot') {
      rows = rows.filter((item) => item.saleStatus === 'ON_SALE');
    } else if (query.channel === 'price_drop') {
      rows = rows.filter((item) => item.originalPriceCents != null && item.priceCents != null && item.originalPriceCents > item.priceCents && item.priceCents > 0);
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
      const savedIds = new Set(this.interactions.filter(i => i.userId === userId && i.kind === 'PRODUCT_FAVORITE' && i.productId).map(i => i.productId!));
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
    if (product) product.currentRelease = null;
    return product;
  }

  // ─── Search ────────────────────────────────────────────

  async searchProducts(query: SearchQuery, userId: string | null = null): Promise<SearchResult> {
    const normalized = normalizeSearchTerm(query.q);
    const resolved = normalized === '' ? null : resolveSearchTerms(normalized, []);

    let rows = this.products.filter(p => {
      if (resolved) {
        const q = normalized;
        const textHit = p.title.toLowerCase().includes(q) || p.brandName.toLowerCase().includes(q);
        const categoryHit = resolved.categoryMatches.includes(p.category);
        const brandHit = resolved.brandIds.includes(p.brandId);
        if (!textHit && !categoryHit && !brandHit) return false;
      }
      if (query.category && p.category !== query.category) return false;
      if (query.saleStatus && p.saleStatus !== query.saleStatus) return false;
      if (query.minPrice > 0 && (p.priceCents ?? 0) < query.minPrice) return false;
      if (query.maxPrice > 0 && (p.priceCents ?? 0) > query.maxPrice) return false;
      return true;
    });

    const hasKeyword = resolved != null;
    const rankOf = (p: Product): number => {
      const title = p.title.toLowerCase();
      const brand = p.brandName.toLowerCase();
      if (resolved && resolved.brandIds.includes(p.brandId)) return 6;
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
      const savedIds = new Set(this.interactions.filter(i => i.userId === userId && i.kind === 'PRODUCT_FAVORITE' && i.productId).map(i => i.productId!));
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

  // ─── Calendar ──────────────────────────────────────────

  async listCalendar(_month: string, _limit: number = 50): Promise<CalendarEvent[]> {
    return [];
  }

  // ─── Notifications ─────────────────────────────────────

  async generateNotifications(_userId: string): Promise<UserAsset[]> {
    return [];
  }

  // ─── Interactions (Favorites) ──────────────────────────

  async addFavorite(userId: string, productId: string, releaseId?: string | null, intentStatus?: string | null, note?: string): Promise<UserInteraction> {
    const existing = this.interactions.find(i => i.userId === userId && i.kind === 'PRODUCT_FAVORITE' && i.productId === productId);
    if (existing) return existing;
    const interaction: UserInteraction = {
      id: newId('int'), userId, kind: 'PRODUCT_FAVORITE', productId,
      brandId: null, postId: null,
      releaseId: releaseId ?? null, intentStatus: (intentStatus as any) ?? null,
      note: note ?? '', createdAt: nowIso(), updatedAt: nowIso(),
    };
    this.interactions.push(interaction);
    return interaction;
  }

  async removeFavorite(userId: string, productId: string): Promise<boolean> {
    const idx = this.interactions.findIndex(i => i.userId === userId && i.kind === 'PRODUCT_FAVORITE' && i.productId === productId);
    if (idx === -1) return false;
    this.interactions.splice(idx, 1);
    return true;
  }

  async updateFavorite(userId: string, productId: string, patch: { intentStatus?: string | null; releaseId?: string | null; note?: string }): Promise<UserInteraction | null> {
    const interaction = this.interactions.find(i => i.userId === userId && i.kind === 'PRODUCT_FAVORITE' && i.productId === productId);
    if (!interaction) return null;
    if (patch.intentStatus !== undefined) interaction.intentStatus = patch.intentStatus as any;
    if (patch.releaseId !== undefined) interaction.releaseId = patch.releaseId;
    if (patch.note !== undefined) interaction.note = patch.note;
    interaction.updatedAt = nowIso();
    return interaction;
  }

  async listFavorites(userId: string): Promise<UserInteraction[]> {
    return this.interactions.filter(i => i.userId === userId && i.kind === 'PRODUCT_FAVORITE');
  }

  async isProductFavorited(userId: string, productId: string): Promise<boolean> {
    return this.interactions.some(i => i.userId === userId && i.kind === 'PRODUCT_FAVORITE' && i.productId === productId);
  }

  async countFavorites(productId: string): Promise<number> {
    return this.interactions.filter(i => i.kind === 'PRODUCT_FAVORITE' && i.productId === productId).length;
  }

  // ─── Interactions (Brand Follow) ───────────────────────

  private memoryResolveBrand(brandId: string): string | null {
    const byId = this.products.find(p => p.brandId === brandId);
    if (byId) return byId.brandId;
    const byName = this.products.find(p => p.brandName === brandId);
    return byName ? byName.brandId : null;
  }

  async followBrand(userId: string, brandId: string): Promise<UserInteraction> {
    const resolved = this.memoryResolveBrand(brandId);
    if (!resolved) throw notFound('品牌不存在');
    const existing = this.interactions.find(i => i.userId === userId && i.kind === 'BRAND_FOLLOW' && i.brandId === resolved);
    if (existing) return existing;
    const interaction: UserInteraction = {
      id: newId('int'), userId, kind: 'BRAND_FOLLOW', brandId: resolved,
      productId: null, postId: null, releaseId: null, intentStatus: null,
      note: '', createdAt: nowIso(), updatedAt: nowIso(),
    };
    this.interactions.push(interaction);
    return interaction;
  }

  async unfollowBrand(userId: string, brandId: string): Promise<boolean> {
    const resolved = this.memoryResolveBrand(brandId);
    if (!resolved) return false;
    const idx = this.interactions.findIndex(i => i.userId === userId && i.kind === 'BRAND_FOLLOW' && i.brandId === resolved);
    if (idx === -1) return false;
    this.interactions.splice(idx, 1);
    return true;
  }

  async isFollowingBrand(userId: string, brandId: string): Promise<boolean> {
    return this.interactions.some(i => i.userId === userId && i.kind === 'BRAND_FOLLOW' && i.brandId === brandId);
  }

  async getFollowedBrandIds(userId: string): Promise<string[]> {
    return this.interactions.filter(i => i.userId === userId && i.kind === 'BRAND_FOLLOW').map(i => i.brandId!);
  }

  // ─── Interactions (Post Like) ──────────────────────────

  async setPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null> {
    if (!this.communityPosts.has(postId)) return null;
    if (liked) {
      const existing = this.interactions.find(i => i.userId === userId && i.kind === 'POST_LIKE' && i.postId === postId);
      if (!existing) {
        this.interactions.push({
          id: newId('int'), userId, kind: 'POST_LIKE', postId,
          productId: null, brandId: null, releaseId: null, intentStatus: null,
          note: '', createdAt: nowIso(), updatedAt: nowIso(),
        });
      }
    } else {
      const idx = this.interactions.findIndex(i => i.userId === userId && i.kind === 'POST_LIKE' && i.postId === postId);
      if (idx !== -1) this.interactions.splice(idx, 1);
    }
    const likeCount = this.interactions.filter(i => i.kind === 'POST_LIKE' && i.postId === postId).length;
    const isLiked = this.interactions.some(i => i.userId === userId && i.kind === 'POST_LIKE' && i.postId === postId);
    return { liked: isLiked, likeCount };
  }

  // ─── Brands ────────────────────────────────────────────

  async listBrands(userId?: string | null): Promise<BrandInfo[]> {
    const followedIds = userId ? await this.getFollowedBrandIds(userId) : [];
    const followedSet = new Set(followedIds);
    const byBrand = new Map<string, { brandId: string; brandName: string }>();
    for (const p of this.products) {
      if (!byBrand.has(p.brandId)) byBrand.set(p.brandId, { brandId: p.brandId, brandName: p.brandName });
    }
    return [...byBrand.values()].map((b) => {
      const product = this.products.find(p => p.brandId === b.brandId);
      return {
        id: b.brandId, name: b.brandName, nameEn: '', logo: '',
        description: product?.description ?? '', category: product?.category ?? '',
        officialUrl: '',
        followerCount: this.interactions.filter(i => i.kind === 'BRAND_FOLLOW' && i.brandId === b.brandId).length,
        isFollowed: followedSet.has(b.brandId),
        createdAt: product?.createdAt ?? nowIso(), updatedAt: product?.updatedAt ?? nowIso(),
      };
    });
  }

  async getBrandById(brandId: string, userId?: string | null): Promise<BrandInfo | null> {
    const product = this.products.find((p) => p.brandId === brandId);
    if (!product) return null;
    const followedIds = userId ? await this.getFollowedBrandIds(userId) : [];
    return {
      id: brandId, name: product.brandName, nameEn: '', logo: '',
      description: product.description, category: product.category, officialUrl: '',
      followerCount: this.interactions.filter(i => i.kind === 'BRAND_FOLLOW' && i.brandId === brandId).length,
      isFollowed: followedIds.includes(brandId),
      createdAt: product.createdAt, updatedAt: product.updatedAt,
    };
  }

  async listBrandProducts(brandId: string, limit = 50): Promise<BrandProductItem[]> {
    return this.products
      .filter((p) => p.brandId === brandId)
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, Math.min(100, Math.max(1, limit)))
      .map((p) => ({
        id: p.id, title: p.title, description: p.description,
        brandId: p.brandId, brandName: p.brandName, category: p.category,
        priceCents: p.priceCents, originalPriceCents: p.originalPriceCents,
        badgeText: p.saleStatus === 'PRE_ORDER' ? '预约' : p.saleStatus === 'ON_SALE' ? '现货' : '',
        coverUrl: p.coverUrl, createdAt: p.createdAt,
      }));
  }

  // ─── Ranking ───────────────────────────────────────────

  async getRanking(tab: RankingTab, limit = 50): Promise<RankingItem[]> {
    const cap = Math.min(100, Math.max(1, limit));
    let rows = [...this.products];
    if (tab === 'favorite') {
      rows.sort((a, b) => {
        const aFav = this.interactions.filter(i => i.kind === 'PRODUCT_FAVORITE' && i.productId === a.id).length;
        const bFav = this.interactions.filter(i => i.kind === 'PRODUCT_FAVORITE' && i.productId === b.id).length;
        return bFav - aFav || b.id.localeCompare(a.id);
      });
    } else if (tab === 'hot') {
      rows.sort((a, b) => (b.feedScore ?? 0) - (a.feedScore ?? 0) || b.id.localeCompare(a.id));
    } else if (tab === 'new') {
      rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return rows.slice(0, cap).map((p, index) => ({
      rank: index + 1, entityId: p.id, title: p.title, brandName: p.brandName,
      coverUrl: p.coverUrl, priceCents: p.priceCents, category: p.category,
      viewCount: p.viewCount,
      favoriteCount: this.interactions.filter(i => i.kind === 'PRODUCT_FAVORITE' && i.productId === p.id).length,
      releaseTypeName: p.saleStatus === 'PRE_ORDER' ? '预约' : p.saleStatus === 'ON_SALE' ? '现货' : '首发',
      daysAgo: Math.max(0, Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000)),
      reservationCount: p.saleStatus === 'PRE_ORDER' ? 1 : 0,
    }));
  }

  // ─── Media ─────────────────────────────────────────────

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

  async getMediaById(mediaId: string): Promise<MediaObject | null> {
    for (const media of this.media.values()) if (media.id === mediaId) return media;
    return null;
  }

  // ─── AI Import Tasks ───────────────────────────────────

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

  async confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask> {
    const task = await this.getAiTask(userId, taskId);
    if (!task) throw notFound('AI 导入任务不存在');
    if (task.state === 'confirmed') return task;
    if (task.state !== 'ready') throw conflict('任务尚未识别完成，无法确认');
    if (!this.userAssets.has(`${userId}:purchase:${input.targetId}`)) {
      throw notFound('目标订单不存在或不属于当前用户');
    }
    if (input.opId && this.aiConfirmOps.has(`${userId}:${input.opId}`)) return task;
    this.aiConfirmOps.add(`${userId}:${input.opId ?? taskId}`);
    task.state = 'confirmed';
    task.confirmedAt = nowIso();
    task.targetType = 'purchase';
    task.targetId = input.targetId;
    return task;
  }

  // ─── Personalization ───────────────────────────────────

  async getUserPreference(userId: string): Promise<UserPreference> {
    const followedBrandIds = await this.getFollowedBrandIds(userId);
    const favorites = await this.listFavorites(userId);
    const wishlistCategories = [...new Set(
      favorites.map(f => this.products.find(p => p.id === f.productId)?.category).filter(Boolean) as string[],
    )];
    const wishlistTags = favorites.flatMap(f => {
      const p = this.products.find(pr => pr.id === f.productId);
      return p ? [...(p as any).season_tags ?? [], ...(p as any).scene_tags ?? [], ...(p as any).element_tags ?? []] : [];
    });
    return { followedBrandIds, wishlistCategories, wishlistTags, viewedCategories: [], searchedKeywords: [] };
  }

  async computePersonalScore(input: PersonalScoreInput): Promise<PersonalScoreResult> {
    const preference = await this.getUserPreference(input.userId);
    return computePersonalScore(input, preference);
  }

  // ─── User Assets ──────────────────────────────────────

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
    if (kind === 'purchase') {
      const newDeadline = patch.balanceDueDate as unknown;
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
      for (const [reminderKey, asset] of [...this.userAssets.entries()]) {
        if (asset.type === 'reminder' && asset.payload.relatedPurchaseId === assetId) {
          this.userAssets.delete(reminderKey);
        }
      }
    }
    return true;
  }

  // ─── User Settings ─────────────────────────────────────

  async getUserSetting(userId: string, key: 'budget' | 'preferences'): Promise<Record<string, unknown>> {
    return { ...(this.userSettings.get(`${userId}:${key}`) ?? {}) };
  }

  async putUserSetting(userId: string, key: 'budget' | 'preferences', payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.userSettings.set(`${userId}:${key}`, { ...payload });
    return { ...payload };
  }

  // ─── Community Posts ───────────────────────────────────

  private communityPostView(post: Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'>, viewerUserId: string | null): CommunityPost {
    const author = this.users.get(post.authorUserId);
    const likeCount = this.interactions.filter(i => i.kind === 'POST_LIKE' && i.postId === post.id).length;
    return {
      ...post,
      authorNickname: author?.nickname ?? '三坑同好',
      likeCount,
      liked: viewerUserId !== null && this.interactions.some(i => i.kind === 'POST_LIKE' && i.postId === post.id && i.userId === viewerUserId),
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

  async listProductCommunityPosts(productId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage> {
    return this.communityPage(null, query, undefined, productId);
  }

  async createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost> {
    const now = nowIso();
    const post: Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'> = {
      ...input, authorUserId: userId, createdAt: now, updatedAt: now,
      productId: input.productId ?? null, visibility: 'public',
    };
    this.communityPosts.set(post.id, post);
    return this.communityPostView(post, userId);
  }

  async getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null> {
    const post = this.communityPosts.get(postId);
    return post ? this.communityPostView(post, viewerUserId) : null;
  }

  async deleteCommunityPost(userId: string, postId: string): Promise<boolean> {
    const post = this.communityPosts.get(postId);
    if (!post || post.authorUserId !== userId) return false;
    this.communityPosts.delete(postId);
    // Remove related likes
    const idx = this.interactions.findIndex(i => i.kind === 'POST_LIKE' && i.postId === postId);
    while (idx !== -1) {
      this.interactions.splice(idx, 1);
      const next = this.interactions.findIndex(i => i.kind === 'POST_LIKE' && i.postId === postId);
      if (next === -1) break;
    }
    return true;
  }

  // ─── Feedback ──────────────────────────────────────────

  async createFeedback(userId: string | null, input: CreateFeedbackInput): Promise<FeedbackRecord> {
    const record: FeedbackRecord = {
      id: input.id, userId, type: input.type, content: input.content,
      contact: input.contact, images: [...input.images], status: 'open', createdAt: input.createdAt,
    };
    if (!this.feedbackRecords.has(input.id)) this.feedbackRecords.set(input.id, record);
    return record;
  }

  // ─── Test helpers ──────────────────────────────────────

  seedProduct(product: Product): void {
    const index = this.products.findIndex((p) => p.id === product.id);
    if (index >= 0) this.products[index] = product;
    else this.products.push(product);
  }
}
