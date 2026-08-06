import type {
  AiConfirmationInput,
  AiImportTask,
  BrandFollower,
  ContentFeedItem,
  CreateUserEventInput,
  CreateWishlistInput,
  FeedItem,
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
}

export interface AppRepository {
  close(): Promise<void>;
  ready(): Promise<boolean>;
  ensureDevUser(nickname: string): Promise<UserProfile>;
  ensureWechatUser(openId: string, nickname: string): Promise<UserProfile>;
  getUser(userId: string): Promise<UserProfile | null>;
  listFeed(userId: string | null, query: FeedQuery): Promise<FeedResult>;
  getProduct(userId: string | null, productId: string): Promise<Product | null>;
  searchProducts(query: SearchQuery): Promise<SearchResult>;
  getTrendSummary(period?: string): Promise<TrendSummary>;

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

  // D8: 个性化评分
  computePersonalScore(input: PersonalScoreInput): Promise<PersonalScoreResult>;
  getUserPreference(userId: string): Promise<{
    followedBrandIds: string[];
    wishlistCategories: string[];
    wishlistTags: string[];
    viewedCategories: string[];
    searchedKeywords: string[];
  }>;

  applySyncBatch(userId: string, operations: SyncOperationInput[]): Promise<SyncReceipt[]>;
  getSyncCheckpoint(userId: string): Promise<string>;
  createMedia(input: Omit<MediaObject, 'id' | 'createdAt' | 'deletedAt' | 'sizeBytes'>): Promise<MediaObject>;
  getMediaByUploadId(userId: string, uploadId: string): Promise<MediaObject | null>;
  getMediaByObjectKey(userId: string, objectKey: string): Promise<MediaObject | null>;
  markMediaUploaded(userId: string, uploadId: string, sizeBytes: number): Promise<MediaObject>;
  deleteMediaByObjectKey(userId: string, objectKey: string): Promise<boolean>;
  createAiTask(task: AiImportTask): Promise<AiImportTask>;
  getAiTask(userId: string, taskId: string): Promise<AiImportTask | null>;
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
  createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost>;
  getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null>;
  setCommunityPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null>;
  deleteCommunityPost(userId: string, postId: string): Promise<boolean>;
  getMediaById(mediaId: string): Promise<MediaObject | null>;
}
