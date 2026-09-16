// src/repositories/contracts.ts — 12-table schema repository interface

import type {
  AiConfirmationInput,
  AiImportTask,
  BrandInfo,
  BrandProductItem,
  CalendarEvent,
  ContentFeedItem,
  MediaObject,
  Product,
  RankingItem,
  RankingTab,
  SearchQuery,
  SearchResult,
  UserProfile,
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

export interface UserInteraction {
  id: string;
  userId: string;
  kind: 'PRODUCT_FAVORITE' | 'BRAND_FOLLOW' | 'POST_LIKE';
  productId: string | null;
  brandId: string | null;
  postId: string | null;
  releaseId: string | null;
  intentStatus: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

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
  productId: string | null;
  visibility: string;
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
  productId?: string | null;
}

export interface CreateFeedbackInput {
  id: string;
  type: string;
  content: string;
  contact: string;
  images: string[];
  createdAt: string;
}

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

  // Feed & Content
  listFeed(userId: string | null, query: FeedQuery): Promise<FeedResult>;
  getProduct(userId: string | null, productId: string, releaseId?: string): Promise<Product | null>;
  searchProducts(query: SearchQuery, userId?: string | null): Promise<SearchResult>;

  // Calendar
  listCalendar(month: string, limit?: number): Promise<CalendarEvent[]>;

  // Notifications
  generateNotifications(userId: string): Promise<UserAsset[]>;

  // Interactions (user_interactions)
  addFavorite(userId: string, productId: string, releaseId?: string | null, intentStatus?: string | null, note?: string): Promise<any>;
  removeFavorite(userId: string, productId: string): Promise<boolean>;
  updateFavorite(userId: string, productId: string, patch: { intentStatus?: string | null; releaseId?: string | null; note?: string }): Promise<any>;
  listFavorites(userId: string): Promise<any[]>;
  isProductFavorited(userId: string, productId: string): Promise<boolean>;
  countFavorites(productId: string): Promise<number>;
  followBrand(userId: string, brandId: string): Promise<any>;
  unfollowBrand(userId: string, brandId: string): Promise<boolean>;
  isFollowingBrand(userId: string, brandId: string): Promise<boolean>;
  getFollowedBrandIds(userId: string): Promise<string[]>;
  setPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null>;

  // Brands
  listBrands(userId?: string | null): Promise<BrandInfo[]>;
  getBrandById(brandId: string, userId?: string | null): Promise<BrandInfo | null>;
  listBrandProducts(brandId: string, limit?: number): Promise<BrandProductItem[]>;

  // Ranking
  getRanking(tab: RankingTab, limit?: number): Promise<RankingItem[]>;

  // Feedback
  createFeedback(userId: string | null, input: CreateFeedbackInput): Promise<FeedbackRecord>;
  computePersonalScore(input: any): Promise<any>;
  getUserPreference(userId: string): Promise<any>;

  // Sessions
  createUserSession(userId: string, deviceId: string, refreshTokenHash: string, expiresAt: string): Promise<void>;
  rotateUserSession(oldHash: string, newHash: string, newExpiresAt: string): Promise<boolean>;
  revokeUserSession(refreshTokenHash: string): Promise<boolean>;

  // Media
  createMedia(input: Omit<MediaObject, 'id' | 'createdAt' | 'deletedAt' | 'sizeBytes'>): Promise<MediaObject>;
  getMediaByUploadId(userId: string, uploadId: string): Promise<MediaObject | null>;
  getMediaByObjectKey(userId: string, objectKey: string): Promise<MediaObject | null>;
  markMediaUploaded(userId: string, uploadId: string, sizeBytes: number): Promise<MediaObject>;
  deleteMediaByObjectKey(userId: string, objectKey: string): Promise<boolean>;
  getMediaById(mediaId: string): Promise<MediaObject | null>;

  // AI Import
  createAiTask(task: AiImportTask): Promise<AiImportTask>;
  getAiTask(userId: string, taskId: string): Promise<AiImportTask | null>;
  updateAiTask(taskId: string, userId: string, patch: Partial<Pick<AiImportTask, 'state' | 'suggestion' | 'confidence' | 'fieldConfidence' | 'evidence' | 'warnings' | 'model'>>): Promise<AiImportTask | null>;
  confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask>;

  // User Assets
  listUserAssets(userId: string, kind: UserAssetKind): Promise<UserAsset[]>;
  getUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<UserAsset | null>;
  createUserAsset(userId: string, kind: UserAssetKind, assetId: string, payload: Record<string, unknown>): Promise<UserAsset>;
  updateUserAsset(userId: string, kind: UserAssetKind, assetId: string, patch: Record<string, unknown>): Promise<UserAsset | null>;
  deleteUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<boolean>;

  // User Settings
  getUserSetting(userId: string, key: UserSettingKey): Promise<Record<string, unknown>>;
  putUserSetting(userId: string, key: UserSettingKey, payload: Record<string, unknown>): Promise<Record<string, unknown>>;

  // Community
  listCommunityPosts(viewerUserId: string | null, query: CommunityPostQuery): Promise<CommunityPostPage>;
  listMyCommunityPosts(userId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage>;
  listProductCommunityPosts(productId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage>;
  createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost>;
  getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null>;
  setPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null>;
  deleteCommunityPost(userId: string, postId: string): Promise<boolean>;
}
