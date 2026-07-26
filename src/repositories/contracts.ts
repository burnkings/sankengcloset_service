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
}
