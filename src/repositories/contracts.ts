import type {
  AiConfirmationInput,
  AiImportTask,
  FeedItem,
  MediaObject,
  Product,
  SyncOperationInput,
  SyncReceipt,
  UserProfile,
} from '../types.js';

export interface FeedQuery {
  channel: string;
  category: string;
  cursor: string;
  limit: number;
}

export interface FeedResult {
  items: FeedItem[];
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
