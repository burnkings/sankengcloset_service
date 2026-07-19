export type Category = 'JK' | 'LOLITA' | 'HANFU' | 'OTHER';

export interface UserProfile {
  id: string;
  nickname: string;
  status: 'active';
  createdAt: string;
}

export interface Product {
  id: string;
  brandId: string;
  brandName: string;
  title: string;
  category: Category;
  status: string;
  coverUrl: string;
  images: string[];
  priceCents: number;
  originalPriceCents: number;
  description: string;
  shopUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedItem {
  id: string;
  feedType: string;
  entityId: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  secondaryCoverUrl: string;
  brandId: string;
  brandName: string;
  price: number;
  originalPrice: number;
  badgeText: string;
  eventStartAt: string;
  eventEndAt: string;
  liked: boolean;
  saved: boolean;
  sourceLabel: string;
  rankingScore: number;
  category: string;
  createdAt: string;
}

export interface SyncOperationInput {
  opId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: string;
  createdAt: string;
}

export interface SyncReceipt {
  opId: string;
  result: 'accepted' | 'rejected' | 'conflict';
  serverVersion: number;
  error?: { code: string; message: string; retryable: boolean };
}

export interface MediaObject {
  id: string;
  ownerUserId: string;
  objectKey: string;
  uploadId: string;
  purpose: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface AiSuggestion {
  name: string;
  category: Category;
  brand: string;
  priceCents: number;
  color: string;
  size: string;
  note: string;
}

export interface AiImportTask {
  taskId: string;
  userId: string;
  objectKey: string;
  state: 'ready' | 'confirmed' | 'failed';
  requestId: string;
  model: { provider: string; name: string; version: string };
  suggestion: AiSuggestion;
  confidence: number;
  fieldConfidence: Record<string, number>;
  evidence: string[];
  warnings: string[];
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  targetType: 'wardrobe' | 'wishlist' | null;
  targetId: string | null;
}

export interface AiConfirmationInput {
  opId: string;
  targetType: 'wardrobe' | 'wishlist';
  confirmed: AiSuggestion;
}
