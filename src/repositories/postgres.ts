import postgres, { type Sql, type PendingQuery } from 'postgres';
import { createHash } from 'node:crypto';
import { badRequest, conflict, notFound } from '../lib/problem.js';
import { newId, nowIso } from '../lib/id.js';
import { escapeLikePattern, normalizeSearchTerm, resolveSearchTerms } from '../lib/search-terms.js';
import type { AppRepository, CommunityPost, CommunityPostPage, CommunityPostQuery, CreateCommunityPostInput, CreateFeedbackInput, FeedbackRecord, FeedQuery, FeedResult, UserAsset, UserAssetKind, UserInteraction } from './contracts.js';
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
  ProductVariant as ProductVariantDto,
  ProductRelease,
  RankingItem,
  RankingTab,
  SearchQuery,
  SearchResult,
  CalendarEvent,
  UserProfile,
} from '../types.js';
import {
  generateFeedReason,
  computeRankingScore,
  formatPriceSummary,
  getReleaseTypeName,
  mergeTags,
} from '../intelligence/feed-ranker.js';
import { computePersonalScore, type UserPreference } from '../intelligence/personal-score.js';

type Row = Record<string, unknown>;
type SqlFragment = PendingQuery<any[]>;

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

function stringValue(value: unknown): string { return value == null ? '' : String(value); }
function numberValue(value: unknown): number { return Number(value ?? 0); }
function nullableNumber(value: unknown): number | null { return value == null ? null : Number(value); }
function dateValue(value: unknown): string { return value instanceof Date ? value.toISOString() : stringValue(value); }

function mapUser(row: Row): UserProfile {
  return {
    id: stringValue(row.id),
    nickname: stringValue(row.nickname),
    avatarUrl: stringValue(row.avatar_url),
    status: (stringValue(row.status) || 'active') as UserProfile['status'],
    createdAt: dateValue(row.created_at),
  };
}

function parseProductImages(raw: unknown): ProductImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const obj = item as Record<string, unknown>;
    return {
      url: String(obj.url ?? ''),
      thumbnailUrl: obj.thumbnailUrl == null ? null : String(obj.thumbnailUrl),
      width: typeof obj.width === 'number' ? obj.width : null,
      height: typeof obj.height === 'number' ? obj.height : null,
      sizeBytes: typeof obj.sizeBytes === 'number' ? obj.sizeBytes : null,
      objectKey: obj.objectKey == null ? null : String(obj.objectKey),
    };
  });
}

function parseProductVariants(raw: unknown): ProductVariantDto[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const obj = item as Record<string, unknown>;
    return {
      id: String(obj.id ?? ''),
      name: String(obj.name ?? ''),
      styleName: String(obj.styleName ?? ''),
      colorName: String(obj.colorName ?? ''),
      sizeName: String(obj.sizeName ?? ''),
    };
  });
}

function mapProduct(row: Row): Product {
  const images = parseProductImages(row.images);
  const featureTags = Array.from(new Set([
    ...(Array.isArray(row.season_tags) ? row.season_tags.map(String) : []),
    ...(Array.isArray(row.scene_tags) ? row.scene_tags.map(String) : []),
    ...(Array.isArray(row.element_tags) ? row.element_tags.map(String) : []),
    ...(Array.isArray(row.recommended_tags) ? row.recommended_tags.map(String) : []),
  ]));
  const variants = parseProductVariants(row.variants);
  return {
    id: stringValue(row.id),
    brandId: stringValue(row.brand_id),
    brandName: stringValue(row.brand_name),
    title: stringValue(row.title),
    category: (stringValue(row.category) || '') as Product['category'],
    subCategory: stringValue(row.sub_category),
    saleStatus: stringValue(row.sale_status),
    coverUrl: images.length > 0 ? images[0]!.url : '',
    images,
    priceCents: row.price_cents == null ? null : numberValue(row.price_cents),
    originalPriceCents: row.original_price_cents == null ? null : numberValue(row.original_price_cents),
    priceType: stringValue(row.price_type) || 'UNKNOWN',
    colorTags: Array.isArray(row.color_tags) ? row.color_tags.map(String) : [],
    materialTags: Array.isArray(row.material_tags) ? row.material_tags.map(String) : [],
    featureTags,
    variants,
    description: stringValue(row.description),
    shopName: stringValue(row.shop_name),
    canonicalUrl: stringValue(row.canonical_url),
    sourcePlatform: stringValue(row.source_platform),
    externalId: row.external_id == null ? null : stringValue(row.external_id),
    groupKey: row.group_key == null ? null : stringValue(row.group_key),
    viewCount: numberValue(row.view_count),
    feedScore: numberValue(row.feed_score),
    visibilityStatus: stringValue(row.visibility_status),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    currentRelease: null,
  };
}

function mapUserAsset(row: Row): UserAsset {
  return {
    id: stringValue(row.id),
    type: stringValue(row.asset_type) as UserAssetKind,
    payload: (row.payload_json ?? {}) as Record<string, unknown>,
    version: numberValue(row.version),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  };
}

function mapCommunityPost(row: Row): CommunityPost {
  return {
    id: stringValue(row.id),
    authorUserId: stringValue(row.author_user_id),
    authorNickname: stringValue(row.author_nickname) || '三坑同好',
    mediaId: stringValue(row.media_id),
    imageUrl: stringValue(row.image_url),
    caption: stringValue(row.caption),
    category: stringValue(row.category),
    topic: stringValue(row.topic),
    likeCount: numberValue(row.like_count),
    liked: row.liked === true,
    productId: row.product_id == null ? null : stringValue(row.product_id),
    visibility: stringValue(row.visibility),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  };
}

function mapMedia(row: Row): MediaObject {
  return {
    id: stringValue(row.id),
    ownerUserId: stringValue(row.owner_user_id),
    objectKey: stringValue(row.object_key),
    uploadId: stringValue(row.upload_id),
    purpose: stringValue(row.purpose),
    contentType: stringValue(row.content_type),
    sizeBytes: numberValue(row.size_bytes),
    createdAt: dateValue(row.created_at),
    deletedAt: row.deleted_at == null ? null : dateValue(row.deleted_at),
  };
}

function mapAiTask(row: Row): AiImportTask {
  const suggestion = (row.suggestion_json ?? {}) as AiSuggestion;
  return {
    taskId: stringValue(row.id),
    objectKey: stringValue(row.object_key) || '',
    userId: stringValue(row.user_id),
    mediaId: stringValue(row.media_id),
    taskType: stringValue(row.task_type) || 'purchase_order',
    sourcePlatform: stringValue(row.source_platform),
    sourceLink: stringValue(row.source_link),
    state: stringValue(row.state) as AiImportTask['state'],
    requestId: stringValue(row.request_id),
    model: {
      provider: stringValue(row.model_provider),
      name: stringValue(row.model_name),
      version: stringValue(row.model_version),
    },
    suggestion,
    confidence: numberValue(row.confidence),
    fieldConfidence: (row.field_confidence_json ?? {}) as Record<string, number>,
    evidence: Array.isArray(row.evidence_json) ? row.evidence_json.map(String) : [],
    warnings: Array.isArray(row.warnings_json) ? row.warnings_json.map(String) : [],
    createdAt: dateValue(row.created_at),
    expiresAt: dateValue(row.expires_at),
    confirmedAt: row.confirmed_at == null ? null : dateValue(row.confirmed_at),
    targetType: row.target_type == null ? null : stringValue(row.target_type) as AiImportTask['targetType'],
    targetId: row.target_id == null ? null : stringValue(row.target_id),
  };
}

export class PostgresRepository implements AppRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  }

  async close(): Promise<void> { await this.sql.end(); }
  async ready(): Promise<boolean> {
    await this.sql`select 1`;
    return true;
  }

  async ensureDevUser(nickname: string): Promise<UserProfile> {
    const rows = await this.sql`
      insert into users (id, nickname, status)
      values ('usr_dev', ${nickname}, 'active')
      on conflict (id) do update set nickname = excluded.nickname
      returning id, nickname, avatar_url, status, created_at
    `;
    return mapUser(rows[0] as Row);
  }

  async ensureWechatUser(openId: string, nickname: string): Promise<UserProfile> {
    return this.sql.begin(async (tx) => {
      // Check existing user by login_provider/login_subject
      const existing = await tx`
        select u.id, u.nickname, u.avatar_url, u.status, u.created_at
        from users u
        where u.login_provider = 'wechat' and u.login_subject = ${openId} and u.status = 'active'
      `;
      if (existing.length > 0) return mapUser(existing[0] as Row);

      const userId = newId('usr');
      const inserted = await tx`
        insert into users (id, nickname, login_provider, login_subject, status)
        values (${userId}, ${nickname}, 'wechat', ${openId}, 'active')
        on conflict (login_provider, login_subject) do nothing
        returning id, nickname, avatar_url, status, created_at
      `;
      if (inserted.length > 0) return mapUser(inserted[0] as Row);

      // Raced: another request created it
      const raced = await tx`
        select u.id, u.nickname, u.avatar_url, u.status, u.created_at
        from users u where u.login_provider = 'wechat' and u.login_subject = ${openId}
      `;
      return mapUser(raced[0] as Row);
    });
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    const rows = await this.sql`select id, nickname, avatar_url, status, created_at from users where id = ${userId} and status = 'active'`;
    return rows.length === 0 ? null : mapUser(rows[0] as Row);
  }

  // ─── P0-A: 用户会话 ────────────────────────────────────

  async createUserSession(userId: string, deviceId: string, refreshTokenHash: string, expiresAt: string): Promise<void> {
    await this.sql`
      insert into user_sessions (id, user_id, refresh_token_hash, device_id, expires_at)
      values (${newId('ses')}, ${userId}, ${refreshTokenHash}, ${deviceId}, ${expiresAt})
    `;
  }

  async rotateUserSession(oldHash: string, newHash: string, newExpiresAt: string): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        update user_sessions
        set revoked_at = now(), last_used_at = now()
        where refresh_token_hash = ${oldHash} and revoked_at is null and expires_at > now()
        returning id, user_id
      `;
      if (rows.length === 0) return false;
      const rotated = rows[0] as Row;
      await tx`
        insert into user_sessions (id, user_id, refresh_token_hash, device_id, expires_at)
        values (${newId('ses')}, ${stringValue(rotated.user_id)}, ${newHash}, '', ${newExpiresAt})
      `;
      return true;
    });
  }

  async revokeUserSession(refreshTokenHash: string): Promise<boolean> {
    const rows = await this.sql`
      update user_sessions set revoked_at = now()
      where refresh_token_hash = ${refreshTokenHash} and revoked_at is null
      returning id
    `;
    return rows.length > 0;
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

    const scope = pageScope(['feed', query.channel, categoryFilter.join(',')]);
    const cursor = decodePageCursor(query.cursor, scope);
    const clauses = [this.sql`p.deleted_at is null`, this.sql`p.visibility_status = 'published'`];
    if (categoryFilter.length > 0) clauses.push(this.sql`p.category in ${this.sql(categoryFilter)}`);
    if (query.channel === 'new') clauses.push(this.sql`p.created_at >= now() - interval '7 days'`);
    if (query.channel === 'reservation') clauses.push(this.sql`(
      p.sale_status = 'PRE_ORDER' or exists (
        select 1 from product_releases pr where pr.product_id = p.id and pr.release_type = 'reservation' and pr.deleted_at is null
      )
    )`);
    if (query.channel === 'spot') clauses.push(this.sql`(
      p.sale_status = 'ON_SALE' or exists (
        select 1 from product_releases pr where pr.product_id = p.id and pr.release_type = 'spot' and pr.deleted_at is null
      )
    )`);
    if (query.channel === 'price_drop') clauses.push(this.sql`(
      p.original_price_cents is not null and p.original_price_cents > 0
      and p.price_cents is not null and p.price_cents > 0
      and p.original_price_cents > p.price_cents
    )`);
    if (query.channel === 'outfit') clauses.push(this.sql`false`);
    if (cursor) clauses.push(this.sql`(p.feed_score < ${cursor.score} or (p.feed_score = ${cursor.score} and p.id < ${cursor.id}))`);

    const whereClause = clauses.reduce((all, clause, index) => index === 0 ? clause : this.sql`${all} and ${clause}`);
    const limit = Math.min(51, Math.max(2, query.limit + 1));
    const rows = await this.sql`
      select p.*, b.name as brand_name,
        count(*) over() as total_count,
        (select pr.release_type from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
        (select pr.release_name from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_name,
        (select pr.full_price_cents from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_full_price,
        (select pr.end_at from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_end_at,
        (select pr.id from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as latest_release_id
      from products p left join brands b on b.id = p.brand_id
      where ${whereClause}
      order by p.feed_score desc, p.id desc
      limit ${limit}
    `;
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;

    // Check favorites for current user
    let savedSet = new Set<string>();
    if (userId) {
      const productIds = visible.map((r) => stringValue((r as Row).id));
      if (productIds.length > 0) {
        const savedRows = await this.sql`select product_id from user_interactions where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' and product_id in ${this.sql(productIds)}`;
        savedSet = new Set(savedRows.map((r) => stringValue((r as Row).product_id)));
      }
    }

    const items = visible.map((row) => {
      const r = row as Row;
      const product = mapProduct(r);
      const images = product.images;
      const releaseType = stringValue(r.release_type) || 'unknown';
      const saleStatus = stringValue(r.sale_status);
      const feedScore = numberValue(r.feed_score);
      const releaseEndAt = dateValue(r.release_end_at);
      const isNew = (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24) <= 7;
      const hasPriceDrop = product.priceCents != null && product.priceCents > 0
        && product.originalPriceCents != null && product.originalPriceCents > product.priceCents;
      const feedReason = generateFeedReason({ saleStatus, releaseType, isRerelease: false, isNew, brandHeatScore: 0, hasPriceDrop, priceTrend: hasPriceDrop ? 'down' : 'stable', feedScore, eventEndAt: releaseEndAt });
      const badgeText = hasPriceDrop ? '降价' : saleStatus === 'PRE_ORDER' ? '预约' : (isNew && saleStatus !== 'UNKNOWN') ? '新品' : '';
      return {
        id: `feed_${product.id}`, feedType: 'product', entityId: product.id, title: product.title, subtitle: product.brandName,
        coverUrl: product.coverUrl, secondaryCoverUrl: images.length > 1 ? images[1]?.url ?? "" : '', brandId: product.brandId, brandName: product.brandName,
        category: product.category, pitType: product.category, subCategory: product.subCategory, price: product.priceCents, originalPrice: product.originalPriceCents,
        priceType: product.priceType, depositCents: null, balanceCents: null,
        colorTags: product.colorTags, materialTags: product.materialTags,
        fullPriceCents: nullableNumber(r.release_full_price),
        priceSummary: formatPriceSummary(product.priceCents ?? 0), saleStatus, releaseType, releaseTypeName: getReleaseTypeName(releaseType),
        tags: mergeTags(
          Array.isArray(r.season_tags) ? r.season_tags.map(String) : [],
          Array.isArray(r.scene_tags) ? r.scene_tags.map(String) : [],
          Array.isArray(r.element_tags) ? r.element_tags.map(String) : [],
          Array.isArray(r.recommended_tags) ? r.recommended_tags.map(String) : [],
        ),
        feedScore, rankingScore: feedScore, feedReason, badgeText, eventStartAt: '', eventEndAt: releaseEndAt,
        liked: false, saved: savedSet.has(product.id), sourceLabel: stringValue(r.shop_name) || '', publishedAt: product.createdAt, createdAt: product.createdAt,
      };
    });
    const last = visible.at(-1) as Row | undefined;
    return {
      items,
      nextCursor: hasMore && last ? encodePageCursor(numberValue(last.feed_score), stringValue(last.id), scope) : '',
      hasMore,
      totalHint: rows.length === 0 ? 0 : numberValue((rows[0] as Row).total_count),
    };
  }

  // ─── Search ─────────────────────────────────────────────

  async searchProducts(query: SearchQuery, userId: string | null = null): Promise<SearchResult> {
    const clauses = [
      this.sql`p.deleted_at is null`,
      this.sql`p.visibility_status = 'published'`,
    ];

    const normalized = normalizeSearchTerm(query.q);
    const resolved = normalized === '' ? null : resolveSearchTerms(normalized, []);

    if (resolved) {
      const pattern = `%${escapeLikePattern(normalized)}%`;
      const textClause = this.sql`(
        p.title ilike ${pattern}
        or b.name ilike ${pattern}
      )`;
      const orParts = [textClause];
      if (resolved.categoryMatches.length > 0) orParts.push(this.sql`p.category = any(${this.sql(resolved.categoryMatches)})`);
      if (resolved.brandIds.length > 0) orParts.push(this.sql`p.brand_id = any(${this.sql(resolved.brandIds)})`);
      const keywordClause = orParts.slice(1).reduce((all, part) => this.sql`(${all} or ${part})`, textClause);
      clauses.push(keywordClause);
    }
    const allowedCategories = new Set(['JK', 'LOLITA', 'HANFU', 'OTHER']);
    if (query.category && allowedCategories.has(query.category)) clauses.push(this.sql`p.category = ${query.category}`);
    if (query.saleStatus) clauses.push(this.sql`p.sale_status = ${query.saleStatus}`);
    if (query.releaseStatus) {
      clauses.push(this.sql`exists (
        select 1 from product_releases pr
        where pr.product_id = p.id and pr.release_type = ${query.releaseStatus} and pr.deleted_at is null
      )`);
    }
    if (query.brandId) clauses.push(this.sql`p.brand_id = ${query.brandId}`);
    if (query.minPrice > 0) clauses.push(this.sql`p.price_cents >= ${query.minPrice}`);
    if (query.maxPrice > 0) clauses.push(this.sql`p.price_cents > 0 and p.price_cents <= ${query.maxPrice}`);

    const whereClause = clauses.reduce((all, clause, index) => index === 0 ? clause : this.sql`${all} and ${clause}`);
    const scope = pageScope(['search', query.q, query.category, query.saleStatus, query.releaseStatus, query.brandId, String(query.minPrice), String(query.maxPrice)]);

    const hasKeyword = resolved != null;
    let rankClause = this.sql`3`;
    if (resolved) {
      const prefix = `${escapeLikePattern(normalized)}%`;
      const exactClause = this.sql`(lower(p.title) = ${normalized} or lower(b.name) = ${normalized})`;
      const categoryClause = resolved.categoryMatches.length > 0 ? this.sql`p.category = any(${this.sql(resolved.categoryMatches)})` : null;
      const prefixClause = this.sql`(p.title ilike ${prefix} or b.name ilike ${prefix})`;
      rankClause = this.sql`(
        case
          when ${exactClause} then 5
          when ${categoryClause ?? this.sql`false`} then 4
          when ${prefixClause} then 4
          else 3
        end
      )`;
    }

    const cursor = decodePageCursor(query.cursor, scope);
    if (cursor) {
      if (hasKeyword) {
        if (cursor.v !== 2 || typeof cursor.rank !== 'number') throw badRequest('游标无效，请重新加载');
        clauses.push(this.sql`(${rankClause} < ${cursor.rank} or (${rankClause} = ${cursor.rank} and (p.feed_score < ${cursor.score} or (p.feed_score = ${cursor.score} and p.id < ${cursor.id}))))`);
      } else {
        clauses.push(this.sql`(p.feed_score < ${cursor.score} or (p.feed_score = ${cursor.score} and p.id < ${cursor.id}))`);
      }
    }
    const limit = Math.min(51, Math.max(2, query.limit + 1));
    const orderBy = hasKeyword
      ? this.sql`order by ${rankClause} desc, p.feed_score desc, p.id desc`
      : this.sql`order by p.feed_score desc, p.id desc`;
    const rows = await this.sql`
      select p.*,
        b.name as brand_name,
        ${rankClause} as search_rank,
        count(*) over() as total_count
      from products p
      left join brands b on b.id = p.brand_id
      where ${whereClause}
      ${orderBy}
      limit ${limit}
    `;

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    let savedSet = new Set<string>();
    if (userId) {
      const productIds = visible.map((r) => stringValue((r as Row).id));
      if (productIds.length > 0) {
        const savedRows = await this.sql`select product_id from user_interactions where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' and product_id in ${this.sql(productIds)}`;
        savedSet = new Set(savedRows.map((r) => stringValue((r as Row).product_id)));
      }
    }
    const items = visible.map((row) => {
      const r = row as Row;
      const product = mapProduct(r);
      const feedScore = numberValue(r.feed_score);
      const releaseType = 'unknown';
      const saleStatus = stringValue(r.sale_status);
      const isNew = (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24) <= 7;
      const feedReason = generateFeedReason({
        saleStatus, releaseType, isRerelease: false, isNew, brandHeatScore: 0,
        hasPriceDrop: false, priceTrend: 'stable', feedScore,
      });
      return {
        id: `feed_${product.id}`,
        feedType: 'product', entityId: product.id,
        title: product.title, subtitle: product.brandName,
        coverUrl: product.coverUrl, secondaryCoverUrl: product.images.length > 1 ? product.images[1]?.url ?? "" : '',
        brandId: product.brandId, brandName: product.brandName,
        category: product.category, pitType: product.category, subCategory: product.subCategory,
        price: product.priceCents, originalPrice: product.originalPriceCents,
        priceType: product.priceType, depositCents: null, balanceCents: null,
        colorTags: product.colorTags, materialTags: product.materialTags,
        fullPriceCents: null,
        priceSummary: formatPriceSummary(product.priceCents ?? 0),
        saleStatus, releaseType, releaseTypeName: getReleaseTypeName(releaseType),
        tags: mergeTags(
          Array.isArray(r.season_tags) ? r.season_tags.map(String) : [],
          Array.isArray(r.scene_tags) ? r.scene_tags.map(String) : [],
          Array.isArray(r.element_tags) ? r.element_tags.map(String) : [],
          Array.isArray(r.recommended_tags) ? r.recommended_tags.map(String) : [],
        ),
        feedScore, rankingScore: feedScore, feedReason, badgeText: '', eventStartAt: '', eventEndAt: '',
        liked: false, saved: savedSet.has(product.id), sourceLabel: '搜索结果',
        publishedAt: product.createdAt, createdAt: product.createdAt,
      };
    });
    const last = visible.at(-1) as Row | undefined;
    return {
      items,
      nextCursor: hasMore && last ? encodePageCursor(numberValue(last.feed_score), stringValue(last.id), scope, hasKeyword ? numberValue((last as Row).search_rank) : undefined) : '',
      hasMore,
      totalHint: rows.length === 0 ? 0 : numberValue((rows[0] as Row).total_count),
    };
  }

  // ─── Calendar (product_releases only) ───────────────────

  async listCalendar(month: string, limit: number = 50): Promise<CalendarEvent[]> {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return [];
    const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
    const rows = await this.sql`
      select pr.id, pr.product_id, coalesce(nullif(pr.release_name, ''), p.title) as title,
             b.name as brand_name, b.id as brand_id, p.category,
             pr.release_type, pr.start_at, pr.end_at,
             pr.full_price_cents as price_cents, pr.deposit_cents, pr.balance_cents,
             pr.sale_status as status, pr.release_no
      from product_releases pr
      join products p on p.id = pr.product_id and p.deleted_at is null
      left join brands b on b.id = p.brand_id
      where pr.deleted_at is null and pr.visibility_status = 'published' and p.visibility_status = 'published'
        and pr.start_at is not null and pr.start_at >= ${start} and pr.start_at < ${end}
      order by pr.start_at asc, pr.id asc
      limit ${Math.min(100, Math.max(1, limit))}
    `;
    return (rows as Row[]).map((r) => ({
      id: stringValue(r.id),
      title: stringValue(r.title),
      brandName: stringValue(r.brand_name),
      brandId: stringValue(r.brand_id),
      category: stringValue(r.category),
      eventType: stringValue(r.release_type),
      startAt: dateValue(r.start_at),
      endAt: r.end_at != null ? dateValue(r.end_at) : null,
      priceCents: r.price_cents == null ? null : numberValue(r.price_cents),
      depositCents: r.deposit_cents == null ? null : numberValue(r.deposit_cents),
      balanceCents: r.balance_cents == null ? null : numberValue(r.balance_cents),
      productId: stringValue(r.product_id),
      releaseId: stringValue(r.id),
      status: stringValue(r.status),
    }));
  }

  // ─── Notifications ──────────────────────────────────────

  async generateNotifications(userId: string): Promise<UserAsset[]> {
    const now = new Date();
    const day = (offset: number): string => new Date(now.getTime() + offset * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const today = day(0);
    const tomorrow = day(1);
    const in3Days = day(3);

    type Draft = { type: string; title: string; body: string; actionTarget: string; key: string };
    const drafts: Draft[] = [];

    // 1. 提醒到期
    const reminderRows = await this.sql`
      select id, payload_json from user_assets
      where user_id = ${userId} and asset_type = 'reminder' and deleted_at is null
    `;
    for (const row of reminderRows as Row[]) {
      const p = (row.payload_json ?? {}) as Record<string, unknown>;
      if (String(p.status ?? '') !== 'PENDING') continue;
      const remindDate = String(p.remindDate ?? '');
      if (remindDate === '' || remindDate > tomorrow) continue;
      const rType = String(p.type ?? 'CUSTOM');
      drafts.push({
        type: rType === 'BALANCE' ? 'price' : rType === 'RELEASE' ? 'release' : 'system',
        title: rType === 'BALANCE' ? '尾款提醒' : rType === 'RELEASE' ? '发售提醒' : '日程提醒',
        body: `${String(p.title ?? '提醒事项')}（${remindDate}）`,
        actionTarget: '/pages/reminder/index',
        key: `REM_${rType}_${stringValue(row.id)}_${remindDate}`,
      });
    }

    // 2. 订单尾款/到货
    const purchaseRows = await this.sql`
      select id, payload_json from user_assets
      where user_id = ${userId} and asset_type = 'purchase' and deleted_at is null
    `;
    for (const row of purchaseRows as Row[]) {
      const p = (row.payload_json ?? {}) as Record<string, unknown>;
      const status = String(p.paymentStatus ?? p.status ?? '');
      if (status === 'COMPLETED' || status === 'CANCELLED') continue;
      const name = String(p.name ?? '订单');
      const due = String(p.balanceDueDate ?? '');
      if (due !== '' && due >= today && due <= in3Days) {
        drafts.push({
          type: 'price', title: '尾款即将截止',
          body: `${name} 尾款截止 ${due}`,
          actionTarget: `/pages/purchase/detail?id=${stringValue(row.id)}`,
          key: `BALANCE_${stringValue(row.id)}_${due}`,
        });
      }
      const arrival = String(p.arrivalDate ?? '');
      if (arrival !== '' && arrival >= today && arrival <= in3Days) {
        drafts.push({
          type: 'system', title: '预计到货',
          body: `${name} 预计 ${arrival} 到货`,
          actionTarget: `/pages/purchase/detail?id=${stringValue(row.id)}`,
          key: `ARRIVAL_${stringValue(row.id)}_${arrival}`,
        });
      }
    }

    // 3. 关注品牌 7 天新品 (from user_interactions)
    const followedRows = await this.sql`select brand_id from user_interactions where user_id = ${userId} and kind = 'BRAND_FOLLOW'`;
    const followedBrandIds = (followedRows as Row[]).map((r) => stringValue(r.brand_id)).filter((id) => id !== '');
    if (followedBrandIds.length > 0) {
      const weekAgoIso = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
      const newProductRows = await this.sql`
        select p.id, p.title, b.name as brand_name
        from products p
        left join brands b on b.id = p.brand_id
        where p.deleted_at is null and p.visibility_status = 'published'
          and p.brand_id in ${this.sql(followedBrandIds)}
          and p.created_at >= ${weekAgoIso}
        order by p.created_at desc
        limit 10
      `;
      for (const row of newProductRows as Row[]) {
        const brandName = stringValue(row.brand_name) || '关注品牌';
        drafts.push({
          type: 'release', title: `${brandName} 上新`,
          body: stringValue(row.title),
          actionTarget: `/pages/search/index?q=${encodeURIComponent(brandName)}`,
          key: `BRAND_NEW_${stringValue(row.id)}`,
        });
      }
    }

    // 4. 幂等写入
    await this.sql.begin(async (tx) => {
      for (const draft of drafts) {
        const assetId = `not_${createHash('sha256').update(draft.key).digest('hex').slice(0, 24)}`;
        const exists = await tx`
          select id from user_assets
          where user_id = ${userId} and asset_type = 'notification' and id = ${assetId}
        `;
        if (exists.length > 0) continue;
        const payload = {
          type: draft.type, title: draft.title, body: draft.body,
          actionTarget: draft.actionTarget, read: false,
        };
        await tx`
          insert into user_assets (user_id, asset_type, id, payload_json)
          values (${userId}, 'notification', ${assetId}, ${this.sql.json(payload)})
        `;
      }
    });

    return this.listUserAssets(userId, 'notification');
  }

  // ─── Product Detail ─────────────────────────────────────

  async getProduct(_userId: string | null, productId: string, releaseId?: string, countView = false): Promise<Product | null> {
    const rows = await this.sql`
      select p.*, b.name as brand_name,
        pr.id as release_id, pr.release_name, pr.release_type, pr.sale_status as release_sale_status,
        pr.release_no, pr.deposit_cents, pr.balance_cents, pr.full_price_cents,
        pr.start_at, pr.end_at, pr.balance_due_at, pr.ship_at, pr.shipping_note
      from products p
      left join brands b on b.id = p.brand_id
      left join lateral (
        select * from product_releases r
        where r.product_id = p.id and r.deleted_at is null
        order by (${releaseId ?? ''} <> '' and r.id = ${releaseId ?? ''}) desc, r.created_at desc limit 1
      ) pr on true
      where p.id = ${productId} and p.deleted_at is null and p.visibility_status = 'published'
    `;
    if (rows.length === 0) return null;
    const product = mapProduct(rows[0] as Row);
    const r = rows[0] as Row;
    const releaseType = stringValue(r.release_type);
    if (releaseType !== '') {
      product.currentRelease = {
        id: stringValue(r.release_id),
        productId: product.id,
        releaseName: stringValue(r.release_name),
        releaseNo: numberValue(r.release_no),
        releaseType,
        saleStatus: stringValue(r.release_sale_status) || product.saleStatus,
        depositCents: r.deposit_cents == null ? null : numberValue(r.deposit_cents),
        balanceCents: r.balance_cents == null ? null : numberValue(r.balance_cents),
        fullPriceCents: r.full_price_cents == null ? null : numberValue(r.full_price_cents),
        startAt: r.start_at != null ? dateValue(r.start_at) : null,
        endAt: r.end_at != null ? dateValue(r.end_at) : null,
        balanceDueAt: r.balance_due_at != null ? dateValue(r.balance_due_at) : null,
        shipAt: r.ship_at != null ? dateValue(r.ship_at) : null,
        shippingNote: stringValue(r.shipping_note),
      };
    }
    // Increment view count
    if (countView) {
      await this.sql`update products set view_count = view_count + 1 where id = ${productId}`;
      product.viewCount += 1;
    }
    return product;
  }

  // ─── Brands ────────────────────────────────────────────

  async listBrands(userId?: string | null): Promise<BrandInfo[]> {
    const rows = await this.sql`
      select b.*, (select count(*)::int from products p
          where p.brand_id = b.id and p.deleted_at is null and p.visibility_status = 'published') as product_count
      from brands b
      where b.deleted_at is null and b.brand_status = 'active'
      order by b.name asc
      limit 200
    `;
    const followed = userId ? await this.getFollowedBrandIds(userId) : [];
    const followedSet = new Set(followed);
    // Count followers per brand
    const followerCounts = await this.sql`select brand_id, count(*)::int as cnt from user_interactions where kind = 'BRAND_FOLLOW' group by brand_id`;
    const followerMap = new Map<string, number>();
    for (const row of followerCounts as Row[]) {
      followerMap.set(stringValue(row.brand_id), numberValue(row.cnt));
    }
    return (rows as Row[]).map((row) => ({
      id: stringValue(row.id),
      name: stringValue(row.name),
      nameEn: stringValue(row.name_en),
      logo: stringValue(row.logo_url),
      description: stringValue(row.description),
      category: stringValue(row.category),
      officialUrl: stringValue(row.official_url),
      followerCount: followerMap.get(stringValue(row.id)) ?? 0,
      isFollowed: followedSet.has(stringValue(row.id)),
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
    }));
  }

  async getBrandById(brandId: string, userId?: string | null): Promise<BrandInfo | null> {
    const rows = await this.sql`
      select b.* from brands b
      where b.id = ${brandId} and b.deleted_at is null
    `;
    if (rows.length === 0) return null;
    const row = rows[0] as Row;
    const followed = userId ? await this.getFollowedBrandIds(userId) : [];
    const followerRows = await this.sql`select count(*)::int as cnt from user_interactions where kind = 'BRAND_FOLLOW' and brand_id = ${brandId}`;
    return {
      id: stringValue(row.id),
      name: stringValue(row.name),
      nameEn: stringValue(row.name_en),
      logo: stringValue(row.logo_url),
      description: stringValue(row.description),
      category: stringValue(row.category),
      officialUrl: stringValue(row.official_url),
      followerCount: numberValue((followerRows[0] as Row).cnt),
      isFollowed: followed.includes(stringValue(row.id)),
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
    };
  }

  async listBrandProducts(brandId: string, limit = 50): Promise<BrandProductItem[]> {
    const cap = Math.min(100, Math.max(1, limit));
    const rows = await this.sql`
      select p.*, b.name as brand_name,
        (select pr.release_type from product_releases pr
          where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type
      from products p
      left join brands b on b.id = p.brand_id
      where p.brand_id = ${brandId} and p.deleted_at is null and p.visibility_status = 'published'
      order by p.feed_score desc, p.id desc
      limit ${cap}
    `;
    return (rows as Row[]).map((row) => {
      const releaseType = stringValue(row.release_type);
      const saleStatus = stringValue(row.sale_status);
      const images = parseProductImages(row.images);
      let badgeText = '';
      if (saleStatus === 'PRE_ORDER' || releaseType === 'reservation') badgeText = '预约';
      else if (releaseType === 'first_release') badgeText = '新品';
      else if (saleStatus === 'ON_SALE') badgeText = '现货';
      return {
        id: stringValue(row.id),
        title: stringValue(row.title),
        description: stringValue(row.description),
        brandId: stringValue(row.brand_id),
        brandName: stringValue(row.brand_name),
        category: stringValue(row.category),
        priceCents: row.price_cents == null ? null : numberValue(row.price_cents),
        originalPriceCents: row.original_price_cents == null ? null : numberValue(row.original_price_cents),
        badgeText,
        coverUrl: images.length > 0 ? images[0]!.url : '',
        createdAt: dateValue(row.created_at),
      };
    });
  }

  // ─── Ranking ───────────────────────────────────────────

  async getRanking(tab: RankingTab, limit = 50): Promise<RankingItem[]> {
    const cap = Math.min(100, Math.max(1, limit));
    let rows: Row[] = [];
    if (tab === 'hot' || tab === 'favorite') {
      const result = await this.sql`
        select p.*, b.name as brand_name,
          p.view_count,
          (select count(*)::int from user_interactions w
            where w.product_id = p.id and w.kind = 'PRODUCT_FAVORITE') as favorite_count,
          (select pr.release_type from product_releases pr
            where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
          (select count(*)::int from product_releases pr
            where pr.product_id = p.id and pr.release_type = 'reservation' and pr.deleted_at is null) as reservation_count
        from products p
        left join brands b on b.id = p.brand_id
        where p.deleted_at is null and p.visibility_status = 'published'
        order by case when ${tab} = 'favorite' then (select count(*)::int from user_interactions w where w.product_id = p.id and w.kind = 'PRODUCT_FAVORITE') else p.view_count end desc, p.id desc
        limit ${cap}
      `;
      rows = result as Row[];
    } else if (tab === 'new') {
      const result = await this.sql`
        select p.*, b.name as brand_name,
          p.view_count,
          (select pr.release_type from product_releases pr
            where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
          (select count(*)::int from product_releases pr
            where pr.product_id = p.id and pr.release_type = 'reservation' and pr.deleted_at is null) as reservation_count,
          0 as favorite_count
        from products p
        left join brands b on b.id = p.brand_id
        where p.deleted_at is null and p.visibility_status = 'published'
          and p.created_at >= now() - interval '30 days'
        order by p.created_at desc, p.id desc
        limit ${cap}
      `;
      rows = result as Row[];
    }
    return rows.map((row, index) => {
      const releaseType = stringValue(row.release_type);
      const images = parseProductImages(row.images);
      return {
        rank: index + 1,
        entityId: stringValue(row.id),
        title: stringValue(row.title),
        brandName: stringValue(row.brand_name),
        coverUrl: images.length > 0 ? images[0]!.url : '',
        priceCents: row.price_cents == null ? null : numberValue(row.price_cents),
        category: stringValue(row.category),
        viewCount: numberValue(row.view_count),
        favoriteCount: numberValue(row.favorite_count),
        releaseTypeName: getReleaseTypeName(releaseType),
        daysAgo: Math.max(0, Math.floor((Date.now() - new Date(dateValue(row.created_at)).getTime()) / 86400000)),
        reservationCount: numberValue(row.reservation_count),
      };
    });
  }

  // ─── Media ─────────────────────────────────────────────

  async createMedia(input: Omit<MediaObject, 'id' | 'createdAt' | 'deletedAt' | 'sizeBytes'>): Promise<MediaObject> {
    const rows = await this.sql`
      insert into media_objects (id, owner_user_id, object_key, upload_id, purpose, content_type)
      values (${newId('med')}, ${input.ownerUserId}, ${input.objectKey}, ${input.uploadId}, ${input.purpose}, ${input.contentType})
      returning *
    `;
    return mapMedia(rows[0] as Row);
  }

  async getMediaByUploadId(userId: string, uploadId: string): Promise<MediaObject | null> {
    const rows = await this.sql`select * from media_objects where owner_user_id = ${userId} and upload_id = ${uploadId} and deleted_at is null`;
    return rows.length === 0 ? null : mapMedia(rows[0] as Row);
  }

  async getMediaByObjectKey(userId: string, objectKey: string): Promise<MediaObject | null> {
    const rows = await this.sql`select * from media_objects where owner_user_id = ${userId} and object_key = ${objectKey} and deleted_at is null`;
    return rows.length === 0 ? null : mapMedia(rows[0] as Row);
  }

  async markMediaUploaded(userId: string, uploadId: string, sizeBytes: number): Promise<MediaObject> {
    const rows = await this.sql`
      update media_objects set size_bytes = ${sizeBytes}, uploaded_at = now()
      where owner_user_id = ${userId} and upload_id = ${uploadId} and deleted_at is null returning *
    `;
    if (rows.length === 0) throw notFound('上传任务不存在');
    return mapMedia(rows[0] as Row);
  }

  async deleteMediaByObjectKey(userId: string, objectKey: string): Promise<boolean> {
    const rows = await this.sql`
      update media_objects set deleted_at = now()
      where owner_user_id = ${userId} and object_key = ${objectKey} and deleted_at is null returning id
    `;
    return rows.length > 0;
  }

  async getMediaById(mediaId: string): Promise<MediaObject | null> {
    const rows = await this.sql`
      select id, owner_user_id, object_key, upload_id, purpose, content_type, size_bytes, created_at, deleted_at
      from media_objects where id = ${mediaId}
    `;
    return rows.length === 0 ? null : mapMedia(rows[0] as Row);
  }

  // ─── AI Import Tasks ───────────────────────────────────

  async createAiTask(task: AiImportTask): Promise<AiImportTask> {
    await this.sql`
      insert into ai_import_tasks
        (id, user_id, media_id, task_type, source_platform, source_link, state, request_id,
         model_provider, model_name, model_version, suggestion_json, confidence,
         field_confidence_json, evidence_json, warnings_json, expires_at)
      values
        (${task.taskId}, ${task.userId}, ${task.mediaId || null}, ${task.taskType}, ${task.sourcePlatform}, ${task.sourceLink},
         ${task.state}, ${task.requestId}, ${task.model.provider},
         ${task.model.name}, ${task.model.version}, ${this.sql.json(task.suggestion as any)}, ${task.confidence},
         ${this.sql.json(task.fieldConfidence as any)}, ${this.sql.json(task.evidence as any)},
         ${this.sql.json(task.warnings as any)}, ${task.expiresAt})
    `;
    return task;
  }

  async getAiTask(userId: string, taskId: string): Promise<AiImportTask | null> {
    const rows = await this.sql`
      select * from ai_import_tasks where id = ${taskId} and user_id = ${userId}
    `;
    return rows.length === 0 ? null : mapAiTask(rows[0] as Row);
  }

  async updateAiTask(
    taskId: string,
    userId: string,
    patch: Partial<Pick<AiImportTask, 'state' | 'suggestion' | 'confidence' | 'fieldConfidence' | 'evidence' | 'warnings' | 'model'>>,
  ): Promise<AiImportTask | null> {
    const suggestion = patch.suggestion ?? { name: '', brand: '', shopName: '', category: 'OTHER', orderNumber: '', orderDate: '', totalCents: 0, depositCents: 0, paidCents: 0, balanceDueDate: '', arrivalDate: '', note: '' };
    const rows = await this.sql`
      update ai_import_tasks
      set state = coalesce(${patch.state ?? null}, state),
          model_provider = coalesce(${patch.model?.provider ?? null}, model_provider),
          model_name = coalesce(${patch.model?.name ?? null}, model_name),
          model_version = coalesce(${patch.model?.version ?? null}, model_version),
          suggestion_json = coalesce(${this.sql.json(suggestion as any)}, suggestion_json),
          confidence = coalesce(${patch.confidence ?? null}::double precision, confidence),
          field_confidence_json = coalesce(${this.sql.json((patch.fieldConfidence ?? {}) as any)}, field_confidence_json),
          evidence_json = coalesce(${this.sql.json((patch.evidence ?? []) as any)}, evidence_json),
          warnings_json = coalesce(${this.sql.json((patch.warnings ?? []) as any)}, warnings_json),
          updated_at = now()
      where id = ${taskId} and user_id = ${userId}
      returning *
    `;
    return rows.length === 0 ? null : mapAiTask(rows[0] as Row);
  }

  async confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask> {
    return this.sql.begin(async (tx) => {
      const taskRows = await tx`
        select * from ai_import_tasks where id = ${taskId} and user_id = ${userId} for update
      `;
      if (taskRows.length === 0) throw notFound('AI 导入任务不存在');
      const task = mapAiTask(taskRows[0] as Row);
      if (task.state === 'confirmed') return task;
      if (task.state !== 'ready') throw conflict('任务尚未识别完成，无法确认');

      // Verify target purchase exists
      const purchase = await tx`
        select id from user_assets
        where user_id = ${userId} and asset_type = 'purchase' and id = ${input.targetId} and deleted_at is null
      `;
      if (purchase.length === 0) throw notFound('目标订单不存在或不属于当前用户');

      // Idempotent: same opId → no duplicate
      if (input.opId) {
        const existingOp = await tx`select id from ai_import_tasks where user_id = ${userId} and confirmation_op_id = ${input.opId}`;
        if (existingOp.length > 0) return task;
      }

      const updated = await tx`
        update ai_import_tasks set state = 'confirmed', confirmed_at = now(), target_id = ${input.targetId},
          confirmed_json = ${this.sql.json(input.confirmed as any)},
          correction_json = ${this.sql.json({ before: task.suggestion, after: input.confirmed } as any)},
          confirmation_op_id = ${input.opId ?? null}
        where id = ${taskId}
        returning *
      `;
      return mapAiTask(updated[0] as Row);
    });
  }

  // ─── Interactions (Favorites) ──────────────────────────

  async addFavorite(userId: string, productId: string, releaseId?: string | null, intentStatus?: string | null, note?: string): Promise<UserInteraction> {
    // Idempotent: same user+product → return existing
    const existing = await this.sql`
      select * from user_interactions where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' and product_id = ${productId}
    `;
    if (existing.length > 0) {
      return this.mapInteraction(existing[0] as Row);
    }
    const id = newId('int');
    const rows = await this.sql`
      insert into user_interactions (id, user_id, kind, product_id, release_id, intent_status, note)
      values (${id}, ${userId}, 'PRODUCT_FAVORITE', ${productId}, ${releaseId ?? null}, ${intentStatus ?? null}, ${note ?? ''})
      on conflict (user_id, product_id) where kind = 'PRODUCT_FAVORITE' do nothing
      returning *
    `;
    if (rows.length === 0) {
      const raced = await this.sql`select * from user_interactions where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' and product_id = ${productId}`;
      return this.mapInteraction(raced[0] as Row);
    }
    return this.mapInteraction(rows[0] as Row);
  }

  async removeFavorite(userId: string, productId: string): Promise<boolean> {
    const rows = await this.sql`delete from user_interactions where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' and product_id = ${productId} returning id`;
    return rows.length > 0;
  }

  async updateFavorite(userId: string, productId: string, patch: { intentStatus?: string | null; releaseId?: string | null; note?: string }): Promise<UserInteraction | null> {
    const rows = await this.sql`
      update user_interactions
      set intent_status = coalesce(${patch.intentStatus ?? null}::text, intent_status),
          release_id = coalesce(${patch.releaseId ?? null}::text, release_id),
          note = coalesce(${patch.note ?? null}::text, note),
          updated_at = now()
      where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' and product_id = ${productId}
      returning *
    `;
    return rows.length === 0 ? null : this.mapInteraction(rows[0] as Row);
  }

  async listFavorites(userId: string): Promise<UserInteraction[]> {
    const rows = await this.sql`
      select * from user_interactions where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' order by created_at desc
    `;
    return (rows as Row[]).map((r) => this.mapInteraction(r));
  }

  async isProductFavorited(userId: string, productId: string): Promise<boolean> {
    const rows = await this.sql`select 1 from user_interactions where user_id = ${userId} and kind = 'PRODUCT_FAVORITE' and product_id = ${productId} limit 1`;
    return rows.length > 0;
  }

  async countFavorites(productId: string): Promise<number> {
    const rows = await this.sql`select count(*)::int as cnt from user_interactions where product_id = ${productId} and kind = 'PRODUCT_FAVORITE'`;
    return numberValue((rows[0] as Row).cnt);
  }

  private mapInteraction(row: Row): UserInteraction {
    return {
      id: stringValue(row.id),
      userId: stringValue(row.user_id),
      kind: stringValue(row.kind) as UserInteraction['kind'],
      productId: row.product_id == null ? null : stringValue(row.product_id),
      brandId: row.brand_id == null ? null : stringValue(row.brand_id),
      postId: row.post_id == null ? null : stringValue(row.post_id),
      releaseId: row.release_id == null ? null : stringValue(row.release_id),
      intentStatus: row.intent_status == null ? null : stringValue(row.intent_status) as UserInteraction['intentStatus'],
      note: stringValue(row.note),
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
    };
  }

  // ─── Interactions (Brand Follow) ───────────────────────

  private async resolveBrandId(brandId: string): Promise<string | null> {
    const byId = await this.sql`select id from brands where id = ${brandId} and deleted_at is null`;
    if (byId.length > 0) return stringValue((byId[0] as Row).id);
    const byName = await this.sql`select id from brands where name = ${brandId} and deleted_at is null limit 1`;
    return byName.length > 0 ? stringValue((byName[0] as Row).id) : null;
  }

  async followBrand(userId: string, brandId: string): Promise<UserInteraction> {
    const resolved = await this.resolveBrandId(brandId);
    if (!resolved) throw notFound('品牌不存在');
    const id = newId('int');
    const rows = await this.sql`
      insert into user_interactions (id, user_id, kind, brand_id)
      values (${id}, ${userId}, 'BRAND_FOLLOW', ${resolved})
      on conflict (user_id, brand_id) where kind = 'BRAND_FOLLOW' do nothing
      returning *
    `;
    if (rows.length === 0) {
      const existing = await this.sql`select * from user_interactions where user_id = ${userId} and kind = 'BRAND_FOLLOW' and brand_id = ${resolved}`;
      return this.mapInteraction(existing[0] as Row);
    }
    return this.mapInteraction(rows[0] as Row);
  }

  async unfollowBrand(userId: string, brandId: string): Promise<boolean> {
    const resolved = await this.resolveBrandId(brandId);
    if (!resolved) return false;
    const rows = await this.sql`delete from user_interactions where user_id = ${userId} and kind = 'BRAND_FOLLOW' and brand_id = ${resolved} returning id`;
    return rows.length > 0;
  }

  async isFollowingBrand(userId: string, brandId: string): Promise<boolean> {
    const rows = await this.sql`select 1 from user_interactions where user_id = ${userId} and kind = 'BRAND_FOLLOW' and brand_id = ${brandId} limit 1`;
    return rows.length > 0;
  }

  async getFollowedBrandIds(userId: string): Promise<string[]> {
    const rows = await this.sql`select brand_id from user_interactions where user_id = ${userId} and kind = 'BRAND_FOLLOW'`;
    return rows.map((r: Row) => stringValue(r.brand_id));
  }

  // ─── Interactions (Post Like) ──────────────────────────

  async setPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null> {
    const post = await this.sql`select id from community_posts where id = ${postId} and deleted_at is null and visibility = 'public'`;
    if (post.length === 0) return null;
    if (liked) {
      await this.sql`insert into user_interactions (id, user_id, kind, post_id) values (${newId('int')}, ${userId}, 'POST_LIKE', ${postId}) on conflict do nothing`;
    } else {
      await this.sql`delete from user_interactions where user_id = ${userId} and kind = 'POST_LIKE' and post_id = ${postId}`;
    }
    const rows = await this.sql`
      select count(*)::int as like_count,
        exists(select 1 from user_interactions where user_id = ${userId} and kind = 'POST_LIKE' and post_id = ${postId}) as liked
      from user_interactions where kind = 'POST_LIKE' and post_id = ${postId}
    `;
    return { liked: (rows[0] as Row).liked === true, likeCount: numberValue((rows[0] as Row).like_count) };
  }

  // ─── Personalization ───────────────────────────────────

  async getUserPreference(userId: string): Promise<UserPreference> {
    const followedBrandIds = await this.getFollowedBrandIds(userId);

    // Categories of favorited products
    const catRows = await this.sql`SELECT DISTINCT p.category
      FROM user_interactions w JOIN products p ON p.id = w.product_id
      WHERE w.user_id = ${userId} AND w.kind = 'PRODUCT_FAVORITE' AND w.product_id IS NOT NULL`;
    const wishlistCategories = catRows.map((r: Row) => stringValue(r.category));

    // Tags of favorited products
    const tagRows = await this.sql`SELECT DISTINCT unnest(
      COALESCE(p.season_tags, '{}') || COALESCE(p.scene_tags, '{}') || COALESCE(p.element_tags, '{}')
    ) AS tag
      FROM user_interactions w JOIN products p ON p.id = w.product_id
      WHERE w.user_id = ${userId} AND w.kind = 'PRODUCT_FAVORITE' AND w.product_id IS NOT NULL`;
    const wishlistTags = tagRows.map((r: Row) => stringValue(r.tag));

    // viewedCategories and searchedKeywords are empty (no user_events table)
    return { followedBrandIds, wishlistCategories, wishlistTags, viewedCategories: [], searchedKeywords: [] };
  }

  async computePersonalScore(input: PersonalScoreInput): Promise<PersonalScoreResult> {
    const preference = await this.getUserPreference(input.userId);
    return computePersonalScore(input, preference);
  }

  // ─── User Assets ──────────────────────────────────────

  async listUserAssets(userId: string, kind: UserAssetKind): Promise<UserAsset[]> {
    const rows = await this.sql`
      select id, asset_type, payload_json, version, created_at, updated_at
      from user_assets
      where user_id = ${userId} and asset_type = ${kind} and deleted_at is null
      order by updated_at desc, id desc
    `;
    return rows.map((row) => mapUserAsset(row as Row));
  }

  async getUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<UserAsset | null> {
    const rows = await this.sql`
      select id, asset_type, payload_json, version, created_at, updated_at
      from user_assets
      where user_id = ${userId} and asset_type = ${kind} and id = ${assetId} and deleted_at is null
    `;
    return rows.length === 0 ? null : mapUserAsset(rows[0] as Row);
  }

  async createUserAsset(userId: string, kind: UserAssetKind, assetId: string, payload: Record<string, unknown>): Promise<UserAsset> {
    const rows = await this.sql`
      insert into user_assets (user_id, asset_type, id, payload_json)
      values (${userId}, ${kind}, ${assetId}, ${this.sql.json(payload as any)})
      returning id, asset_type, payload_json, version, created_at, updated_at
    `;
    return mapUserAsset(rows[0] as Row);
  }

  async updateUserAsset(userId: string, kind: UserAssetKind, assetId: string, patch: Record<string, unknown>): Promise<UserAsset | null> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        update user_assets
        set payload_json = payload_json || ${this.sql.json(patch as any)},
            version = version + 1,
            updated_at = now()
        where user_id = ${userId} and asset_type = ${kind} and id = ${assetId} and deleted_at is null
        returning id, asset_type, payload_json, version, created_at, updated_at
      `;
      if (rows.length === 0) return null;
      // 尾款日期联动
      if (kind === 'purchase') {
        const newDeadline = patch.balanceDueDate as unknown;
        if (typeof newDeadline === 'string' && newDeadline !== '') {
          await tx`
            update user_assets
            set payload_json = jsonb_set(
                  jsonb_set(payload_json, '{remindDate}', to_jsonb(${newDeadline}::text), true),
                  '{resyncedFrom}', to_jsonb(${assetId}::text), true),
                version = version + 1,
                updated_at = now()
            where user_id = ${userId} and asset_type = 'reminder' and deleted_at is null
              and payload_json->>'relatedPurchaseId' = ${assetId}
              and payload_json->>'type' = 'BALANCE'
          `;
        }
      }
      return mapUserAsset(rows[0] as Row);
    });
  }

  async deleteUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        update user_assets set deleted_at = now(), version = version + 1, updated_at = now()
        where user_id = ${userId} and asset_type = ${kind} and id = ${assetId} and deleted_at is null
        returning id
      `;
      if (rows.length === 0) return false;
      if (kind === 'purchase') {
        await tx`
          update user_assets set deleted_at = now(), version = version + 1, updated_at = now()
          where user_id = ${userId} and asset_type = 'reminder' and deleted_at is null
            and payload_json->>'relatedPurchaseId' = ${assetId}
        `;
      }
      return true;
    });
  }

  // ─── User Settings (stored in users table) ─────────────

  async getUserSetting(userId: string, key: 'budget' | 'preferences'): Promise<Record<string, unknown>> {
    const col = key === 'budget' ? 'budget_json' : 'preferences_json';
    const rows = await this.sql`select ${this.sql(col)} as val from users where id = ${userId}`;
    return rows.length === 0 ? {} : (rows[0] as Row).val as Record<string, unknown>;
  }

  async putUserSetting(userId: string, key: 'budget' | 'preferences', payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const col = key === 'budget' ? 'budget_json' : 'preferences_json';
    const rows = await this.sql`
      update users set ${this.sql(col)} = ${this.sql.json(payload as any)}, updated_at = now()
      where id = ${userId}
      returning ${this.sql(col)} as val
    `;
    return rows.length === 0 ? {} : (rows[0] as Row).val as Record<string, unknown>;
  }

  // ─── Community Posts ───────────────────────────────────

  private async communityPage(viewerUserId: string | null, query: CommunityPostQuery, authorUserId = '', productId = ''): Promise<CommunityPostPage> {
    const offset = Math.max(0, Number.parseInt(query.cursor || '0', 10) || 0);
    const limit = Math.min(51, Math.max(2, query.limit + 1));
    const viewerId = viewerUserId ?? '';
    const category = query.category ?? '';
    const topic = query.topic ?? '';
    const rows = await this.sql`
      select p.id, p.author_user_id, u.nickname as author_nickname, p.media_id, p.caption, p.category, p.topic, p.product_id, p.visibility, p.created_at, p.updated_at,
        (select count(*)::int from user_interactions l where l.post_id = p.id and l.kind = 'POST_LIKE') as like_count,
        exists(select 1 from user_interactions l where l.post_id = p.id and l.user_id = ${viewerId} and l.kind = 'POST_LIKE') as liked,
        count(*) over() as total_count,
        (select mo.object_key from media_objects mo where mo.id = p.media_id) as image_url
      from community_posts p
      join users u on u.id = p.author_user_id
      where p.deleted_at is null
        and (${authorUserId} = '' or p.author_user_id = ${authorUserId})
        and (${authorUserId} <> '' or p.visibility = 'public' or p.author_user_id = ${viewerId})
        and (${authorUserId} <> '' or p.visibility = 'public')
        and (${category} = '' or p.category = ${category})
        and (${topic} = '' or p.topic = ${topic})
        and (${productId} = '' or p.product_id = ${productId})
      order by p.created_at desc, p.id desc
      offset ${offset} limit ${limit}
    `;
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: visible.map((row) => mapCommunityPost(row as Row)),
      nextCursor: hasMore ? String(offset + query.limit) : '',
      hasMore,
      totalHint: rows.length === 0 ? 0 : numberValue((rows[0] as Row).total_count),
    };
  }

  async listCommunityPosts(viewerUserId: string | null, query: CommunityPostQuery): Promise<CommunityPostPage> {
    return this.communityPage(viewerUserId, query);
  }

  async listMyCommunityPosts(userId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage> {
    return this.communityPage(userId, query, userId);
  }

  async listProductCommunityPosts(productId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage> {
    return this.communityPage(null, query, '', productId);
  }

  async createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost> {
    const rows = await this.sql`
      insert into community_posts (id, author_user_id, media_id, caption, category, topic, product_id)
      values (${input.id}, ${userId}, ${input.mediaId}, ${input.caption}, ${input.category}, ${input.topic}, ${input.productId ?? null})
      returning id, author_user_id, media_id, caption, category, topic, product_id, visibility, created_at, updated_at
    `;
    const row = rows[0] as Row;
    const media = await this.getMediaById(input.mediaId);
    return {
      id: stringValue(row.id), authorUserId: stringValue(row.author_user_id),
      authorNickname: (await this.getUser(userId))?.nickname ?? '三坑同好',
      mediaId: stringValue(row.media_id), imageUrl: media ? `/api/v1/media/${media.id}` : '',
      caption: stringValue(row.caption), category: stringValue(row.category), topic: stringValue(row.topic),
      productId: row.product_id == null ? null : stringValue(row.product_id),
      likeCount: 0, liked: false, visibility: stringValue(row.visibility),
      createdAt: dateValue(row.created_at), updatedAt: dateValue(row.updated_at),
    };
  }

  async getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null> {
    const viewerId = viewerUserId ?? '';
    const rows = await this.sql`
      select p.id, p.author_user_id, u.nickname as author_nickname, p.media_id, p.caption, p.category, p.topic, p.product_id, p.visibility, p.created_at, p.updated_at,
        (select count(*)::int from user_interactions l where l.post_id = p.id and l.kind = 'POST_LIKE') as like_count,
        exists(select 1 from user_interactions l where l.post_id = p.id and l.user_id = ${viewerId} and l.kind = 'POST_LIKE') as liked,
        (select mo.object_key from media_objects mo where mo.id = p.media_id) as image_url
      from community_posts p join users u on u.id = p.author_user_id
      where p.id = ${postId} and p.deleted_at is null and (p.visibility = 'public' or p.author_user_id = ${viewerId})
    `;
    return rows.length === 0 ? null : mapCommunityPost(rows[0] as Row);
  }

  async deleteCommunityPost(userId: string, postId: string): Promise<boolean> {
    const rows = await this.sql`
      update community_posts set deleted_at = now(), updated_at = now()
      where id = ${postId} and author_user_id = ${userId} and deleted_at is null
      returning id
    `;
    return rows.length > 0;
  }

  // ─── Feedback ──────────────────────────────────────────

  async createFeedback(userId: string | null, input: CreateFeedbackInput): Promise<FeedbackRecord> {
    await this.sql`
      insert into feedback_records (id, user_id, type, content, contact, images, created_at)
      values (${input.id}, ${userId}, ${input.type}, ${input.content}, ${input.contact},
              ${input.images}, ${new Date(Number(input.createdAt) || Date.now())})
      on conflict (id) do nothing
    `;
    return {
      id: input.id, userId, type: input.type, content: input.content,
      contact: input.contact, images: input.images, status: 'open', createdAt: input.createdAt,
    };
  }
}

