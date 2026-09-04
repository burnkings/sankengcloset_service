import type {
  AiConfirmationInput,
  AiImportTask,
  BrandFollower,
  BrandInfo,
  BrandProductItem,
  ContentFeedItem,
  CreateUserEventInput,
  CreateWishlistInput,
  FeedItem,
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
import type { SearchAliasRow } from '../lib/search-terms.js';

export interface FeedQuery {
  channel: string;
  category: string;
  categories?: string;
  cursor: string;
  limit: number;
}

export interface FeedResult {
  items: ContentFeedItem[];
  nextCursor: string;
  hasMore: boolean;
  totalHint: number;
}

export type UserAssetKind = 'wardrobe' | 'purchase' | 'reminder' | 'wish' | 'notification';

export interface UserAsset {
  id: string;
  type: UserAssetKind;
  payload: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type UserSettingKey = 'budget' | 'preferences';

export interface CommunityPostQuery {
  cursor: string;
  limit: number;
  category?: string;
  topic?: string;
}

export interface CommunityPost {
  id: string;
  authorUserId: string;
  authorNickname: string;
  mediaId: string;
  imageUrl: string;
  caption: string;
  category: string;
  topic: string;
  likeCount: number;
  liked: boolean;
  /** Phase 2.3-A：关联商品（可空——普通闲聊/非商品内容为 null） */
  productId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityPostPage {
  items: CommunityPost[];
  nextCursor: string;
  hasMore: boolean;
  totalHint: number;
}

export interface CreateCommunityPostInput {
  id: string;
  mediaId: string;
  imageUrl: string;
  caption: string;
  category: string;
  topic: string;
  /** Phase 2.3-A：可选商品关联；null/undefined = 普通内容（不绑定 Release） */
  productId?: string | null;
}

/** Phase 2.6：意见反馈提交 */
export interface CreateFeedbackInput {
  id: string;
  type: string;
  content: string;
  contact: string;
  images: string[];
  createdAt: string;
}

/** Phase 2.6：意见反馈记录 */
export interface FeedbackRecord {
  id: string;
  userId: string | null;
  type: string;
  content: string;
  contact: string;
  images: string[];
  status: string;
  createdAt: string;
}

export interface AppRepository {
  close(): Promise<void>;
  ready(): Promise<boolean>;
  ensureDevUser(nickname: string): Promise<UserProfile>;
  ensureWechatUser(openId: string, nickname: string): Promise<UserProfile>;
  getUser(userId: string): Promise<UserProfile | null>;
  listFeed(userId: string | null, query: FeedQuery): Promise<FeedResult>;
  getProduct(userId: string | null, productId: string, releaseId?: string): Promise<Product | null>;
  /** 款式详情 + 关联商品（Phase 2.1；不存在返回 null） */
  getStyle(styleId: string): Promise<StyleDetail | null>;
  /**
   * 搜索别名解析（Phase 2.2-A）：按规范化词查找 active 别名（term 精确/包含匹配）。
   * 词库为空或未命中时返回空数组，调用方必须继续原始文本搜索。
   */
  resolveSearchAliases(normalizedTerm: string): Promise<SearchAliasRow[]>;
  searchProducts(query: SearchQuery, userId?: string | null): Promise<SearchResult>;
  getTrendSummary(period?: string): Promise<TrendSummary>;

  // 发售日历
  listCalendar(month: string, limit?: number): Promise<CalendarEvent[]>;

  // 通知生成（基于用户 reminders/purchases/关注品牌 生成真实通知）
  generateNotifications(userId: string): Promise<UserAsset[]>;

  // D8: 用户行为事件
  recordEvent(userId: string | null, input: CreateUserEventInput): Promise<UserEvent>;
  getUserEvents(userId: string, eventType?: string, limit?: number): Promise<UserEvent[]>;

  // D8: 收藏体系
  addWishlist(userId: string, input: CreateWishlistInput): Promise<WishlistItem>;
  updateWishlistStatus(wishlistId: string, userId: string, status: string): Promise<WishlistItem>;
  removeWishlist(wishlistId: string, userId: string): Promise<boolean>;
  listWishlist(userId: string, status?: string): Promise<WishlistItem[]>;
  isProductWishlisted(userId: string, productId: string): Promise<boolean>;

  // D8: 品牌关注
  followBrand(userId: string, brandId: string): Promise<BrandFollower>;
  unfollowBrand(userId: string, brandId: string): Promise<boolean>;
  isFollowingBrand(userId: string, brandId: string): Promise<boolean>;
  getFollowedBrandIds(userId: string): Promise<string[]>;

  // Phase 2.6: 品牌目录（列表 / 详情 / 品牌商品）
  listBrands(userId?: string | null): Promise<BrandInfo[]>;
  getBrandById(brandId: string, userId?: string | null): Promise<BrandInfo | null>;
  listBrandProducts(brandId: string, limit?: number): Promise<BrandProductItem[]>;

  // Phase 2.6: 三坑榜单（hot 热榜 / new 上新榜）
  getRanking(tab: RankingTab, limit?: number): Promise<RankingItem[]>;

  // Phase 2.6: 意见反馈
  createFeedback(userId: string | null, input: CreateFeedbackInput): Promise<FeedbackRecord>;

  // 个性化评分
  computePersonalScore(input: PersonalScoreInput): Promise<PersonalScoreResult>;
  getUserPreference(userId: string): Promise<{
    followedBrandIds: string[];
    wishlistCategories: string[];
    wishlistTags: string[];
    viewedCategories: string[];
    searchedKeywords: string[];
  }>;

  // P0-A: 用户会话（refresh token 轮换）
  createUserSession(userId: string, deviceId: string, refreshTokenHash: string, expiresAt: string): Promise<void>;
  rotateUserSession(oldHash: string, newHash: string, newExpiresAt: string): Promise<boolean>;
  revokeUserSession(refreshTokenHash: string): Promise<boolean>;

  applySyncBatch(userId: string, operations: SyncOperationInput[]): Promise<SyncReceipt[]>;
  getSyncCheckpoint(userId: string): Promise<string>;
  createMedia(input: Omit<MediaObject, 'id' | 'createdAt' | 'deletedAt' | 'sizeBytes'>): Promise<MediaObject>;
  getMediaByUploadId(userId: string, uploadId: string): Promise<MediaObject | null>;
  getMediaByObjectKey(userId: string, objectKey: string): Promise<MediaObject | null>;
  markMediaUploaded(userId: string, uploadId: string, sizeBytes: number): Promise<MediaObject>;
  deleteMediaByObjectKey(userId: string, objectKey: string): Promise<boolean>;
  createAiTask(task: AiImportTask): Promise<AiImportTask>;
  getAiTask(userId: string, taskId: string): Promise<AiImportTask | null>;
  updateAiTask(taskId: string, userId: string, patch: Partial<Pick<AiImportTask, 'state' | 'suggestion' | 'confidence' | 'fieldConfidence' | 'evidence' | 'warnings' | 'model'>>): Promise<AiImportTask | null>;
  confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask>;

  // V2.5: 个人管理页的数据资源（衣橱/购买/提醒/愿望/通知）
  listUserAssets(userId: string, kind: UserAssetKind): Promise<UserAsset[]>;
  getUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<UserAsset | null>;
  createUserAsset(userId: string, kind: UserAssetKind, assetId: string, payload: Record<string, unknown>): Promise<UserAsset>;
  updateUserAsset(userId: string, kind: UserAssetKind, assetId: string, patch: Record<string, unknown>): Promise<UserAsset | null>;
  deleteUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<boolean>;
  getUserSetting(userId: string, key: UserSettingKey): Promise<Record<string, unknown>>;
  putUserSetting(userId: string, key: UserSettingKey, payload: Record<string, unknown>): Promise<Record<string, unknown>>;

  // V2.5: 圈子动态及点赞
  listCommunityPosts(viewerUserId: string | null, query: CommunityPostQuery): Promise<CommunityPostPage>;
  listMyCommunityPosts(userId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage>;
  /** Phase 2.3-A：商品关联社区内容（商品详情「真实买家」模块数据源） */
  listProductCommunityPosts(productId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage>;
  createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost>;
  getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null>;
  setCommunityPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null>;
  deleteCommunityPost(userId: string, postId: string): Promise<boolean>;
  getMediaById(mediaId: string): Promise<MediaObject | null>;
}
