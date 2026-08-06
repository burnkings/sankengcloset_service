import { conflict, notFound } from '../lib/problem.js';
import { newId, nowIso } from '../lib/id.js';
import type { AppRepository, FeedQuery, FeedResult } from './contracts.js';
import type {
  AiConfirmationInput,
  AiImportTask,
  BrandFollower,
  ContentFeedItem,
  CreateUserEventInput,
  CreateWishlistInput,
  MediaObject,
  PersonalScoreInput,
  PersonalScoreResult,
  Product,
  SearchQuery,
  SearchResult,
  SyncOperationInput,
  SyncReceipt,
  TrendSummary,
  UserEvent,
  UserProfile,
  WishlistItem,
} from '../types.js';
import type { CommunityPost, CommunityPostPage, CommunityPostQuery, CreateCommunityPostInput, UserAsset, UserAssetKind, UserSettingKey } from './contracts.js';
import { generateFeedReason, computeRankingScore, formatPriceSummary, getReleaseTypeName, mergeTags } from '../intelligence/feed-ranker.js';
import { buildTrendSummary } from '../intelligence/trend-engine.js';
import { computePersonalScore, type UserPreference } from '../intelligence/personal-score.js';

/** 搜索关键词 → 坑向分类别名（与 postgres.ts 保持一致） */
function resolveAliasCategory(q: string): string {
  const lower = q.trim().toLowerCase();
  if (lower.includes('洛丽塔') || lower === 'lolita') return 'LOLITA';
  if (lower.includes('汉服') || lower === 'hanfu') return 'HANFU';
  if (lower === 'jk' || lower.includes('jk') || lower.includes('制服')) return 'JK';
  return '';
}

function seedProducts(): Product[] {
  const now = nowIso();
  return [
    {
      id: 'prd_jk_navy_45', brandId: 'br_rabbit', brandName: '兔缝缝', title: '深蓝格裙 45cm',
      category: 'JK', status: 'ON_SALE', coverUrl: 'https://images.example.invalid/jk-navy-cover.jpg',
      images: ['https://images.example.invalid/jk-navy-1.jpg', 'https://images.example.invalid/jk-navy-2.jpg'],
      priceCents: 12800, originalPriceCents: 16800, description: '深蓝格纹制服裙演示数据', shopUrl: '', createdAt: now, updatedAt: now,
    },
    {
      id: 'prd_lolita_moon', brandId: 'br_starcat', brandName: '星辰猫', title: '月光曲 JSK',
      category: 'LOLITA', status: 'PRE_ORDER', coverUrl: 'https://images.example.invalid/moon-jsk-cover.jpg',
      images: ['https://images.example.invalid/moon-jsk-1.jpg', 'https://images.example.invalid/moon-jsk-2.jpg'],
      priceCents: 36800, originalPriceCents: 39800, description: '月光主题 JSK 演示数据', shopUrl: '', createdAt: now, updatedAt: now,
    },
    {
      id: 'prd_hanfu_song', brandId: 'br_flower', brandName: '花笺', title: '宋制旋裙套装',
      category: 'HANFU', status: 'UPCOMING', coverUrl: 'https://images.example.invalid/hanfu-song-cover.jpg',
      images: ['https://images.example.invalid/hanfu-song-1.jpg'],
      priceCents: 25800, originalPriceCents: 0, description: '宋制汉服演示数据', shopUrl: '', createdAt: now, updatedAt: now,
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
    price: product.priceCents,
    originalPrice: product.originalPriceCents,
    priceSummary: formatPriceSummary(product.priceCents),
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
  private readonly syncOps = new Map<string, SyncReceipt>();
  private readonly syncCheckpoints = new Map<string, string>();
  private readonly media = new Map<string, MediaObject>();
  private readonly aiTasks = new Map<string, AiImportTask>();
  private readonly assets = new Map<string, unknown>();
  private readonly userAssets = new Map<string, UserAsset>();
  private readonly userSettings = new Map<string, Record<string, unknown>>();
  private readonly communityPosts = new Map<string, Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'>>();
  private readonly postLikes = new Set<string>();

  async close(): Promise<void> {}
  async ready(): Promise<boolean> { return true; }

  async ensureDevUser(nickname: string): Promise<UserProfile> {
    const existing = this.users.get('usr_dev');
    if (existing) return existing;
    const user: UserProfile = { id: 'usr_dev', nickname, status: 'active', createdAt: nowIso() };
    this.users.set(user.id, user);
    return user;
  }

  async ensureWechatUser(openId: string, nickname: string): Promise<UserProfile> {
    const existingId = this.wechatUsers.get(openId);
    if (existingId) return this.users.get(existingId)!;
    const user: UserProfile = { id: newId('usr'), nickname, status: 'active', createdAt: nowIso() };
    this.users.set(user.id, user);
    this.wechatUsers.set(openId, user.id);
    return user;
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    return this.users.get(userId) ?? null;
  }

  async listFeed(_userId: string | null, query: FeedQuery): Promise<FeedResult> {
    let rows = this.products;
    const allowedCategories = new Set(['JK', 'LOLITA', 'HANFU', 'OTHER']);
    let categoryFilter: string[] = [];
    if (query.categories) {
      categoryFilter = query.categories.split(',').map(c => c.trim().toUpperCase()).filter(c => allowedCategories.has(c));
    } else if (allowedCategories.has(query.category)) {
      categoryFilter = [query.category];
    }
    if (categoryFilter.length > 0) rows = rows.filter((item) => categoryFilter.includes(item.category));
    if (query.channel === 'reservation') rows = rows.filter((item) => item.status === 'PRE_ORDER');
    if (query.channel === 'new') rows = rows.filter((item) => item.status === 'UPCOMING');
    const offset = Number.parseInt(query.cursor || '0', 10) || 0;
    const items = rows.slice(offset, offset + query.limit).map(toFeed);
    const next = offset + items.length;
    return { items, nextCursor: next < rows.length ? String(next) : '', hasMore: next < rows.length, totalHint: rows.length };
  }

  async getProduct(_userId: string | null, productId: string): Promise<Product | null> {
    return this.products.find((item) => item.id === productId) ?? null;
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

  async confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask> {
    const task = await this.getAiTask(userId, taskId);
    if (!task) throw notFound('AI 导入任务不存在');
    if (task.state === 'confirmed') {
      if (task.targetType !== input.targetType) throw conflict('该任务已经确认到其他目标');
      return task;
    }
    const operationKey = `${userId}:ai:${input.opId}`;
    if (this.assets.has(operationKey)) return task;
    const targetId = newId(input.targetType === 'wardrobe' ? 'wdi' : 'wli');
    this.assets.set(operationKey, { id: targetId, ...input.confirmed });
    task.state = 'confirmed';
    task.confirmedAt = nowIso();
    task.targetType = input.targetType;
    task.targetId = targetId;
    return task;
  }

  async searchProducts(query: SearchQuery): Promise<SearchResult> {
    let rows = this.products.filter(p => {
      // 关键词搜索（title/brand + 坑向别名命中 category）
      if (query.q) {
        const q = query.q.toLowerCase();
        const aliasCategory = resolveAliasCategory(query.q);
        const matchTitle = p.title.toLowerCase().includes(q);
        const matchBrand = p.brandName.toLowerCase().includes(q);
        const matchCategory = aliasCategory !== '' && p.category === aliasCategory;
        if (!matchTitle && !matchBrand && !matchCategory) return false;
      }
      // 分类过滤
      if (query.category && p.category !== query.category) return false;
      // 发售状态过滤
      if (query.saleStatus && p.status !== query.saleStatus) return false;
      // 价格范围
      if (query.minPrice > 0 && p.priceCents < query.minPrice) return false;
      if (query.maxPrice > 0 && p.priceCents > query.maxPrice) return false;
      return true;
    });

    const total = rows.length;
    const offset = Number.parseInt(query.cursor || '0', 10) || 0;
    const items = rows.slice(offset, offset + query.limit).map(p => ({
      ...toFeed(p),
      sourceLabel: '搜索结果',
    }));
    const next = offset + items.length;

    return {
      items,
      nextCursor: next < total ? String(next) : '',
      hasMore: next < total,
      totalHint: total,
    };
  }

  async getTrendSummary(_period?: string): Promise<TrendSummary> {
    return buildTrendSummary([], []);
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

  async followBrand(userId: string, brandId: string): Promise<BrandFollower> {
    const existing = this.brandFollowers.find(f => f.userId === userId && f.brandId === brandId);
    if (existing) return existing;
    const follower: BrandFollower = { userId, brandId, createdAt: nowIso() };
    this.brandFollowers.push(follower);
    return follower;
  }

  async unfollowBrand(userId: string, brandId: string): Promise<boolean> {
    const idx = this.brandFollowers.findIndex(f => f.userId === userId && f.brandId === brandId);
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
    return { ...existing, payload: { ...existing.payload } };
  }

  async deleteUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<boolean> {
    return this.userAssets.delete(this.userAssetKey(userId, kind, assetId));
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

  private communityPage(viewerUserId: string | null, query: CommunityPostQuery, authorUserId?: string): CommunityPostPage {
    const filtered = [...this.communityPosts.values()]
      .filter((post) => authorUserId === undefined || post.authorUserId === authorUserId)
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

  async createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost> {
    const now = nowIso();
    const post: Omit<CommunityPost, 'authorNickname' | 'likeCount' | 'liked'> = {
      ...input, authorUserId: userId, createdAt: now, updatedAt: now,
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

}
