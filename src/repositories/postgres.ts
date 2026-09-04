import postgres, { type Sql, type PendingQuery } from 'postgres';
import { createHash } from 'node:crypto';
import { badRequest, conflict, notFound } from '../lib/problem.js';
import { newId, nowIso } from '../lib/id.js';
import { escapeLikePattern, normalizeSearchTerm, resolveSearchTerms, type SearchAliasRow } from '../lib/search-terms.js';
import type { AppRepository, CommunityPost, CommunityPostPage, CommunityPostQuery, CreateCommunityPostInput, CreateFeedbackInput, FeedbackRecord, FeedQuery, FeedResult, UserAsset, UserAssetKind, UserSettingKey } from './contracts.js';
import type {
  AiConfirmationInput,
  AiImportTask,
  AiSuggestion,
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
import {
  generateFeedReason,
  computeRankingScore,
  formatPriceSummary,
  getReleaseTypeName,
  mergeTags,
} from '../intelligence/feed-ranker.js';
import { buildTrendSummary } from '../intelligence/trend-engine.js';
import { computePersonalScore, type UserPreference } from '../intelligence/personal-score.js';

type Row = Record<string, unknown>;

/** postgres.js 模板 fragment 返回类型（包内部不导出 Fragment，用 PendingQuery 表示） */
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
function dateValue(value: unknown): string { return value instanceof Date ? value.toISOString() : stringValue(value); }

function mapUser(row: Row): UserProfile {
  return {
    id: stringValue(row.id),
    nickname: stringValue(row.nickname),
    avatarUrl: stringValue(row.avatar_url),
    status: 'active',
    createdAt: dateValue(row.created_at),
  };
}

function mapProduct(row: Row): Product {
  const images = Array.isArray(row.images) ? row.images.map(String) : [];
  const featureTags = Array.from(new Set([
    ...(Array.isArray(row.season_tags) ? row.season_tags.map(String) : []),
    ...(Array.isArray(row.scene_tags) ? row.scene_tags.map(String) : []),
    ...(Array.isArray(row.element_tags) ? row.element_tags.map(String) : []),
    ...(Array.isArray(row.recommended_tags) ? row.recommended_tags.map(String) : []),
  ]));
  const variants = Array.isArray(row.variants) ? (row.variants as unknown[]).map((v) => {
    const vr = v as Record<string, unknown>;
    return {
      id: String(vr.id ?? ''),
      name: String(vr.name ?? ''),
      colorName: String(vr.colorName ?? ''),
      sizeName: String(vr.sizeName ?? ''),
      skuCode: String(vr.skuCode ?? ''),
      priceCents: typeof vr.priceCents === 'number' ? vr.priceCents : 0,
      stockStatus: String(vr.stockStatus ?? 'IN_STOCK'),
    };
  }) : [];
  return {
    id: stringValue(row.id),
    brandId: stringValue(row.brand_id),
    brandName: stringValue(row.brand_name),
    title: stringValue(row.display_name || row.canonical_name),
    category: (stringValue(row.pit_type) || '') as Product['category'],
    subCategory: stringValue(row.category),
    status: stringValue(row.sale_status || row.status),
    coverUrl: stringValue(row.cover_url),
    images,
    priceCents: numberValue(row.current_price || row.price_cents),
    originalPriceCents: numberValue(row.original_price || row.original_price_cents),
    priceType: stringValue(row.price_type) || 'UNKNOWN',
    depositCents: numberValue(row.deposit_price),
    balanceCents: numberValue(row.balance_price),
    colorTags: Array.isArray(row.color_tags) ? row.color_tags.map(String) : [],
    materialTags: Array.isArray(row.material_tags) ? row.material_tags.map(String) : [],
    featureTags,
    variants,
    description: stringValue(row.description),
    shopUrl: stringValue(row.source_url),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    styleId: row.style_id == null ? null : stringValue(row.style_id),
    currentRelease: null, // getProduct 单独填充；列表场景不使用
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
    // Phase 2.3-A：product_id 列可空（普通内容为 null）
    productId: row.product_id == null ? null : stringValue(row.product_id),
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
    userId: stringValue(row.user_id),
    objectKey: stringValue(row.object_key),
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
      const existing = await tx`
        select u.id, u.nickname, u.avatar_url, u.status, u.created_at
        from user_identities i join users u on u.id = i.user_id
        where i.provider = 'wechat' and i.provider_subject = ${openId} and u.status = 'active'
      `;
      if (existing.length > 0) return mapUser(existing[0] as Row);

      const userId = newId('usr');
      await tx`insert into users (id, nickname, status) values (${userId}, ${nickname}, 'active')`;
      const identity = await tx`
        insert into user_identities (user_id, provider, provider_subject)
        values (${userId}, 'wechat', ${openId})
        on conflict (provider, provider_subject) do nothing
        returning user_id
      `;
      if (identity.length > 0) {
        const created = await tx`select id, nickname, avatar_url, status, created_at from users where id = ${userId}`;
        return mapUser(created[0] as Row);
      }

      await tx`delete from users where id = ${userId}`;
      const raced = await tx`
        select u.id, u.nickname, u.avatar_url, u.status, u.created_at
        from user_identities i join users u on u.id = i.user_id
        where i.provider = 'wechat' and i.provider_subject = ${openId} and u.status = 'active'
      `;
      return mapUser(raced[0] as Row);
    });
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    const rows = await this.sql`select id, nickname, avatar_url, status, created_at from users where id = ${userId} and status = 'active'`;
    return rows.length === 0 ? null : mapUser(rows[0] as Row);
  }

  // ─── P0-A: 用户会话（refresh token 轮换） ────────────────────────────

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
    if (categoryFilter.length > 0) clauses.push(this.sql`p.pit_type in ${this.sql(categoryFilter)}`);
    if (query.channel === 'new') clauses.push(this.sql`p.created_at >= now() - interval '7 days'`);
    if (query.channel === 'reservation') clauses.push(this.sql`(
      p.sale_status = 'PRE_ORDER' or exists (
        select 1 from product_releases pr where pr.product_id = p.id and pr.release_type = 'reservation' and pr.deleted_at is null
      )
    )`);
    // Phase 2.6：现货频道（前端「现货」channel=spot）——有现货批次或 ON_SALE 状态
    if (query.channel === 'spot') clauses.push(this.sql`(
      p.sale_status = 'ON_SALE' or exists (
        select 1 from product_releases pr where pr.product_id = p.id and pr.release_type = 'spot' and pr.deleted_at is null
      )
    )`);
    if (query.channel === 'price_drop') clauses.push(this.sql`(
      (p.original_price > p.current_price and p.current_price > 0)
      or exists (select 1 from price_snapshots ps where ps.product_id = p.id and ps.price_cents > p.current_price)
    )`);
    if (query.channel === 'outfit') clauses.push(this.sql`false`);
    if (cursor) clauses.push(this.sql`(p.feed_score < ${cursor.score} or (p.feed_score = ${cursor.score} and p.id < ${cursor.id}))`);

    const whereClause = clauses.reduce((all, clause, index) => index === 0 ? clause : this.sql`${all} and ${clause}`);
    const limit = Math.min(51, Math.max(2, query.limit + 1));
    const rows = await this.sql`
      select p.*, b.name as brand_name, b.heat_score as brand_heat_score, count(*) over() as total_count,
        coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images,
        (select pr.release_type from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
        (select pr.release_name from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_name,
        (select pr.is_rerelease from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as is_rerelease,
        (select pr.full_price_cents from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_full_price,
        (select pr.end_at from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_end_at,
        (select pr.lifecycle_status from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_lifecycle,
        (select max(ps.price_cents) from price_snapshots ps where ps.product_id = p.id) as historical_high_price
      from products p left join brands b on b.id = p.brand_id
      where ${whereClause}
      order by p.feed_score desc, p.id desc
      limit ${limit}
    `;
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;

    let savedSet = new Set<string>();
    if (userId) {
      const productIds = visible.map((r) => stringValue((r as Row).id));
      if (productIds.length > 0) {
        const savedRows = await this.sql`select product_id from wishlist_items where user_id = ${userId} and product_id in ${this.sql(productIds)}`;
        savedSet = new Set(savedRows.map((r) => stringValue((r as Row).product_id)));
      }
    }

    const items = visible.map((row) => {
      const r = row as Row;
      const product = mapProduct(r);
      const images = Array.isArray(r.images) ? r.images.map(String) : [];
      const brandHeatScore = numberValue(r.brand_heat_score);
      const releaseType = stringValue(r.release_type) || 'unknown';
      const isRerelease = Boolean(r.is_rerelease);
      const saleStatus = stringValue(r.sale_status || r.status);
      const feedScore = numberValue(r.feed_score);
      const releaseEndAt = dateValue(r.release_end_at);
      const isNew = (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24) <= 7;
      const historicalHigh = Math.max(numberValue(r.historical_high_price), product.originalPriceCents);
      const hasPriceDrop = product.priceCents > 0 && historicalHigh > product.priceCents;
      const feedReason = generateFeedReason({ saleStatus, releaseType, isRerelease, isNew, brandHeatScore, hasPriceDrop, priceTrend: hasPriceDrop ? 'down' : 'stable', feedScore, eventEndAt: releaseEndAt });
      const badgeText = hasPriceDrop ? '降价' : saleStatus === 'PRE_ORDER' ? '预约' : isNew ? '新品' : '';
      return {
        id: `feed_${product.id}`, feedType: 'product', entityId: product.id, title: product.title, subtitle: product.brandName,
        coverUrl: product.coverUrl, secondaryCoverUrl: images[1] ?? '', brandId: product.brandId, brandName: product.brandName,
        category: product.category, pitType: product.category, subCategory: product.subCategory, price: product.priceCents, originalPrice: product.originalPriceCents,
        priceType: product.priceType, depositCents: product.depositCents, balanceCents: product.balanceCents,
        colorTags: product.colorTags, materialTags: product.materialTags,
        fullPriceCents: numberValue(r.release_full_price),
        priceSummary: formatPriceSummary(product.priceCents), saleStatus, releaseType, releaseTypeName: getReleaseTypeName(releaseType),
        tags: mergeTags(
          Array.isArray(r.season_tags) ? r.season_tags.map(String) : [],
          Array.isArray(r.scene_tags) ? r.scene_tags.map(String) : [],
          Array.isArray(r.element_tags) ? r.element_tags.map(String) : [],
          Array.isArray(r.recommended_tags) ? r.recommended_tags.map(String) : [],
        ),
        feedScore, rankingScore: feedScore, feedReason, badgeText, eventStartAt: '', eventEndAt: releaseEndAt,
        liked: false, saved: savedSet.has(product.id), sourceLabel: '品牌官方', publishedAt: product.createdAt, createdAt: product.createdAt,
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

    /**
   * 搜索别名解析（Phase 2.2-A）：按规范化词查找 active 别名。
   * term 精确匹配优先、包含匹配其次；词库数据驱动（替代已删除的硬编码 resolveAliasCategory）。
   */
  async resolveSearchAliases(normalizedTerm: string): Promise<SearchAliasRow[]> {
    if (normalizedTerm === '') return [];
    const rows = await this.sql`
      select id, term, canonical_term, alias_type, status, confidence, source
      from aliases
      where status = 'active' and deleted_at is null
        and (${normalizedTerm} = term or ${normalizedTerm} like '%' || term || '%')
      order by (case when ${normalizedTerm} = term then 0 else 1 end), confidence desc
    `;
    return rows.map((row) => {
      const r = row as Row;
      return {
        id: stringValue(r.id),
        term: stringValue(r.term),
        canonicalTerm: stringValue(r.canonical_term),
        aliasType: stringValue(r.alias_type) as SearchAliasRow['aliasType'],
        status: stringValue(r.status),
        confidence: numberValue(r.confidence),
        source: stringValue(r.source),
      };
    });
  }

  async searchProducts(query: SearchQuery, userId: string | null = null): Promise<SearchResult> {
    // 每个条件均使用 postgres.js 的 SQL fragment；用户输入绝不拼入 SQL 文本。
    const clauses = [
      this.sql`p.deleted_at is null`,
      this.sql`p.visibility_status = 'published'`,
    ];

    // Phase 2.2-A 搜索链：normalize（NFKC）→ alias 解析（category/brand/style）→ 文本/实体搜索
    const normalized = normalizeSearchTerm(query.q);
    const resolved = normalized === '' ? null : resolveSearchTerms(normalized, await this.resolveSearchAliases(normalized));

    if (resolved) {
      const pattern = `%${escapeLikePattern(normalized)}%`;
      const textClause = this.sql`(
        p.display_name ilike ${pattern}
        or p.canonical_name ilike ${pattern}
        or b.name ilike ${pattern}
        or st.canonical_name ilike ${pattern}
      )`;
      const orParts = [textClause];
      if (resolved.categoryMatches.length > 0) orParts.push(this.sql`p.pit_type = any(${this.sql(resolved.categoryMatches)})`);
      if (resolved.brandIds.length > 0) orParts.push(this.sql`p.brand_id = any(${this.sql(resolved.brandIds)})`);
      if (resolved.styleIds.length > 0) orParts.push(this.sql`p.style_id = any(${this.sql(resolved.styleIds)})`);
      const keywordClause = orParts.slice(1).reduce((all, part) => this.sql`(${all} or ${part})`, textClause);
      clauses.push(keywordClause);
    }
    const allowedCategories = new Set(['JK', 'LOLITA', 'HANFU', 'OTHER']);
    if (query.category && allowedCategories.has(query.category)) clauses.push(this.sql`p.pit_type = ${query.category}`);
    if (query.saleStatus) clauses.push(this.sql`p.sale_status = ${query.saleStatus}`);
    if (query.releaseStatus) {
      clauses.push(this.sql`exists (
        select 1 from product_releases pr
        where pr.product_id = p.id and pr.release_type = ${query.releaseStatus} and pr.deleted_at is null
      )`);
    }
    if (query.brandId) clauses.push(this.sql`p.brand_id = ${query.brandId}`);
    if (query.minPrice > 0) clauses.push(this.sql`p.current_price >= ${query.minPrice}`);
    if (query.maxPrice > 0) clauses.push(this.sql`p.current_price <= ${query.maxPrice}`);

    const whereClause = clauses.reduce((all, clause, index) => index === 0 ? clause : this.sql`${all} and ${clause}`);
    const scope = pageScope(['search', query.q, query.category, query.saleStatus, query.releaseStatus, query.brandId, String(query.minPrice), String(query.maxPrice)]);

    // Phase 2.2-A 相关性排序：exact entity > exact text > prefix/category > contains > feed_score
    // 仅有关键词时启用（无关键词保持原 feed_score 排序，避免污染分类浏览）
    const hasKeyword = resolved != null;
    let rankClause = this.sql`3`;
    if (resolved) {
      const entityParts: SqlFragment[] = [];
      if (resolved.brandIds.length > 0) entityParts.push(this.sql`p.brand_id = any(${this.sql(resolved.brandIds)})`);
      if (resolved.styleIds.length > 0) entityParts.push(this.sql`p.style_id = any(${this.sql(resolved.styleIds)})`);
      const entityClause = entityParts.length > 0
        ? entityParts.slice(1).reduce((all, part) => this.sql`(${all} or ${part})`, entityParts[0]!)
        : null;
      const prefix = `${escapeLikePattern(normalized)}%`;
      const exactClause = this.sql`(lower(p.display_name) = ${normalized} or lower(p.canonical_name) = ${normalized} or lower(b.name) = ${normalized} or lower(st.canonical_name) = ${normalized})`;
      const categoryClause = resolved.categoryMatches.length > 0 ? this.sql`p.pit_type = any(${this.sql(resolved.categoryMatches)})` : null;
      const prefixClause = this.sql`(p.display_name ilike ${prefix} or p.canonical_name ilike ${prefix} or b.name ilike ${prefix} or st.canonical_name ilike ${prefix})`;
      rankClause = this.sql`(
        case
          when ${entityClause ?? this.sql`false`} then 6
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
        b.heat_score as brand_heat_score,
        ${rankClause} as search_rank,
        count(*) over() as total_count,
        coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images,
        (select pr.release_type from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
        (select pr.is_rerelease from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as is_rerelease
      from products p
      left join brands b on b.id = p.brand_id
      left join styles st on st.id = p.style_id
      where ${whereClause}
      ${orderBy}
      limit ${limit}
    `;

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    // 实时计算当前登录用户的收藏状态（saved）；游客固定 false
    let savedSet = new Set<string>();
    if (userId) {
      const productIds = visible.map((r) => stringValue((r as Row).id));
      if (productIds.length > 0) {
        const savedRows = await this.sql`
          select product_id from wishlist_items
          where user_id = ${userId} and product_id in ${this.sql(productIds)}
        `;
        savedSet = new Set(savedRows.map((r) => stringValue((r as Row).product_id)));
      }
    }
    const items = visible.map((row) => {
      const r = row as Row;
      const product = mapProduct(r);
      const images = Array.isArray(r.images) ? r.images.map(String) : [];
      const brandHeatScore = numberValue(r.brand_heat_score);
      const releaseType = stringValue(r.release_type) || 'unknown';
      const isRerelease = Boolean(r.is_rerelease);
      const saleStatus = stringValue(r.sale_status || r.status);
      const feedScore = numberValue(r.feed_score);
      const isNew = (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24) <= 7;
      const feedReason = generateFeedReason({
        saleStatus, releaseType, isRerelease, isNew, brandHeatScore,
        hasPriceDrop: false, priceTrend: 'stable', feedScore,
      });
      return {
        id: `feed_${product.id}`,
        feedType: 'product',
        entityId: product.id,
        title: product.title,
        subtitle: product.brandName,
        coverUrl: product.coverUrl,
        secondaryCoverUrl: images[1] ?? '',
        brandId: product.brandId,
        brandName: product.brandName,
        category: product.category,
        pitType: product.category,
        subCategory: product.subCategory,
        price: product.priceCents,
        originalPrice: product.originalPriceCents,
        priceType: product.priceType,
        depositCents: product.depositCents,
        balanceCents: product.balanceCents,
        colorTags: product.colorTags,
        materialTags: product.materialTags,
        fullPriceCents: numberValue(r.release_full_price),
        priceSummary: formatPriceSummary(product.priceCents),
        saleStatus,
        releaseType,
        releaseTypeName: getReleaseTypeName(releaseType),
        tags: mergeTags(
          Array.isArray(r.season_tags) ? r.season_tags.map(String) : [],
          Array.isArray(r.scene_tags) ? r.scene_tags.map(String) : [],
          Array.isArray(r.element_tags) ? r.element_tags.map(String) : [],
          Array.isArray(r.recommended_tags) ? r.recommended_tags.map(String) : [],
        ),
        feedScore,
        rankingScore: feedScore,
        feedReason,
        badgeText: '',
        eventStartAt: '',
        eventEndAt: '',
        liked: false,
        saved: savedSet.has(product.id),
        sourceLabel: '搜索结果',
        publishedAt: product.createdAt,
        createdAt: product.createdAt,
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

  async getTrendSummary(period: string = '30d'): Promise<TrendSummary> {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const cutoffSql = `'${cutoff}'::timestamptz`;

    // 品牌趋势：聚合品牌的商品数、再贩数、平均价格
    const brandRows = await this.sql.unsafe(
      `select
        b.id as brand_id,
        b.name as brand_name,
        b.heat_score,
        count(distinct p.id) as product_count,
        count(distinct case when p.created_at >= ${cutoffSql} then p.id end) as new_product_count,
        count(distinct case when pr.is_rerelease and pr.created_at >= ${cutoffSql} then pr.id end) as rerelease_count,
        coalesce(avg(case when p.created_at >= ${cutoffSql} then p.current_price end), 0)::int as avg_price_current,
        coalesce(avg(case when p.created_at < ${cutoffSql} then p.current_price end), 0)::int as avg_price_prev
       from brands b
       left join products p on p.brand_id = b.id and p.deleted_at is null
       left join product_releases pr on pr.product_id = p.id and pr.deleted_at is null
       where b.deleted_at is null
       group by b.id, b.name, b.heat_score
       having count(distinct p.id) > 0
       order by b.heat_score desc
       limit 10`,
    );

    const brandTrends = brandRows.map((row) => {
      const r = row as Row;
      const avgCurrent = numberValue(r.avg_price_current);
      const avgPrev = numberValue(r.avg_price_prev);
      const priceChange = avgPrev > 0 ? Math.round(((avgCurrent - avgPrev) / avgPrev) * 100) : 0;
      return {
        brandId: stringValue(r.brand_id),
        brandName: stringValue(r.brand_name),
        period,
        newProductCount: numberValue(r.new_product_count),
        rereleaseCount: numberValue(r.rerelease_count),
        avgPriceCents: avgCurrent,
        priceChangePercent: priceChange,
        heatScore: numberValue(r.heat_score),
        productCount: numberValue(r.product_count),
      };
    });

    // 商品趋势：价格变化、热度变化、状态变化
    const productRows = await this.sql.unsafe(
      `select
        p.id as product_id,
        p.display_name as product_name,
        b.name as brand_name,
        p.pit_type as category,
        p.current_price as current_price,
        p.feed_score as current_feed_score,
        p.sale_status as current_sale_status,
        (select ps.price_cents from price_snapshots ps where ps.product_id = p.id and ps.fetched_at < ${cutoffSql} order by ps.fetched_at desc limit 1) as prev_price,
        p.sale_status as prev_sale_status
       from products p
       left join brands b on b.id = p.brand_id
       where p.deleted_at is null
         and p.visibility_status = 'published'
         and p.updated_at >= ${cutoffSql}
       order by p.feed_score desc
       limit 20`,
    );

    const productTrends = productRows.map((row) => {
      const r = row as Row;
      const currentPrice = numberValue(r.current_price);
      const prevPrice = numberValue(r.prev_price);
      const priceChange = currentPrice - prevPrice;
      const priceChangePercent = prevPrice > 0 ? Math.round(((currentPrice - prevPrice) / prevPrice) * 100) : 0;
      const currentSaleStatus = stringValue(r.current_sale_status);
      const prevSaleStatus = stringValue(r.prev_sale_status);

      return {
        productId: stringValue(r.product_id),
        productName: stringValue(r.product_name),
        brandName: stringValue(r.brand_name),
        category: stringValue(r.category),
        period,
        priceChange,
        priceChangePercent,
        feedScoreChange: 0, // 需要历史数据，简化为0
        saleStatusChanged: currentSaleStatus !== prevSaleStatus,
        currentSaleStatus,
        previousSaleStatus: prevSaleStatus,
      };
    });

    return buildTrendSummary(brandTrends, productTrends);
  }

  async listCalendar(month: string, limit: number = 50): Promise<CalendarEvent[]> {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return [];
    const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
    const rows = await this.sql`
      select ev.id, ev.title, ev.brand_name, ev.brand_id, ev.category, ev.event_type,
             ev.start_at, ev.end_at, ev.price_cents, ev.deposit_cents, ev.balance_cents,
             ev.product_id, ev.status, ev.source
      from (
        select pr.id, coalesce(nullif(pr.release_name, ''), p.display_name) as title,
               b.name as brand_name, b.id as brand_id, p.pit_type as category,
               pr.release_type::text as event_type, pr.start_at, pr.end_at,
               pr.full_price_cents as price_cents, pr.deposit_price_cents as deposit_cents,
               pr.balance_price_cents as balance_cents, pr.product_id, pr.sale_status::text as status,
               'release' as source
        from product_releases pr
        join products p on p.id = pr.product_id and p.deleted_at is null
        left join brands b on b.id = p.brand_id
        where pr.deleted_at is null and pr.visibility_status = 'published'
          and pr.start_at is not null and pr.start_at >= ${start} and pr.start_at < ${end}
        union all
        select se.id, coalesce(nullif(se.title, ''), p.display_name) as title,
               b.name as brand_name, b.id as brand_id, p.pit_type as category,
               se.event_type::text as event_type, se.start_at, se.end_at,
               (coalesce(se.deposit_amount, 0) + coalesce(se.balance_amount, 0)) as price_cents,
               se.deposit_amount as deposit_cents, se.balance_amount as balance_cents,
               se.product_id, se.status::text as status, 'sale_event' as source
        from sale_events se
        join products p on p.id = se.product_id and p.deleted_at is null
        left join brands b on b.id = p.brand_id
        where se.start_at is not null and se.start_at >= ${start} and se.start_at < ${end}
      ) ev
      order by ev.start_at asc, ev.id asc
      limit ${Math.min(100, Math.max(1, limit))}
    `;
    return (rows as Row[]).map((r) => ({
      id: stringValue(r.id),
      title: stringValue(r.title),
      brandName: stringValue(r.brand_name),
      brandId: stringValue(r.brand_id),
      category: stringValue(r.category),
      eventType: stringValue(r.event_type),
      startAt: dateValue(r.start_at),
      endAt: r.end_at != null ? dateValue(r.end_at) : null,
      priceCents: numberValue(r.price_cents),
      depositCents: numberValue(r.deposit_cents),
      balanceCents: numberValue(r.balance_cents),
      productId: stringValue(r.product_id),
      status: stringValue(r.status),
      source: (r.source === 'sale_event' ? 'sale_event' : 'release') as CalendarEvent['source'],
    }));
  }

  async generateNotifications(userId: string): Promise<UserAsset[]> {
    const now = new Date();
    const day = (offset: number): string => new Date(now.getTime() + offset * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const today = day(0);
    const tomorrow = day(1);
    const in3Days = day(3);
    const weekAgoIso = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();

    type Draft = { type: string; title: string; body: string; actionTarget: string; key: string };
    const drafts: Draft[] = [];

    // 1. 提醒到期（reminders：PENDING 且 remindDate <= 明天）
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

    // 2. 订单尾款/到货（purchases：未完成 + 日期在 3 天内）
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
          type: 'price',
          title: '尾款即将截止',
          body: `${name} 尾款截止 ${due}`,
          actionTarget: `/pages/purchase/detail?id=${stringValue(row.id)}`,
          key: `BALANCE_${stringValue(row.id)}_${due}`,
        });
      }
      const arrival = String(p.arrivalDate ?? '');
      if (arrival !== '' && arrival >= today && arrival <= in3Days) {
        drafts.push({
          type: 'system',
          title: '预计到货',
          body: `${name} 预计 ${arrival} 到货`,
          actionTarget: `/pages/purchase/detail?id=${stringValue(row.id)}`,
          key: `ARRIVAL_${stringValue(row.id)}_${arrival}`,
        });
      }
    }

    // 3. 关注品牌 7 天新品（brand_followers + products）
    const followedRows = await this.sql`select brand_id from brand_followers where user_id = ${userId}`;
    const followedBrandIds = (followedRows as Row[]).map((r) => stringValue(r.brand_id)).filter((id) => id !== '');
    if (followedBrandIds.length > 0) {
      const newProductRows = await this.sql`
        select p.id, p.display_name, b.name as brand_name
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
          type: 'release',
          title: `${brandName} 上新`,
          body: stringValue(row.display_name),
          actionTarget: `/pages/search/index?q=${encodeURIComponent(brandName)}`,
          key: `BRAND_NEW_${stringValue(row.id)}`,
        });
      }
    }

    // 4. 幂等写入（同 key 已存在则跳过）
    await this.sql.begin(async (tx) => {
      for (const draft of drafts) {
        const assetId = `not_${createHash('sha256').update(draft.key).digest('hex').slice(0, 24)}`;
        const exists = await tx`
          select id from user_assets
          where user_id = ${userId} and asset_type = 'notification' and id = ${assetId}
        `;
        if (exists.length > 0) continue;
        const payload = {
          type: draft.type,
          title: draft.title,
          body: draft.body,
          actionTarget: draft.actionTarget,
          read: false,
        };
        await tx`
          insert into user_assets (user_id, asset_type, id, payload_json)
          values (${userId}, 'notification', ${assetId}, ${this.sql.json(payload)})
        `;
      }
    });

    return this.listUserAssets(userId, 'notification');
  }

  async getProduct(_userId: string | null, productId: string, releaseId?: string): Promise<Product | null> {
    const rows = await this.sql`
      select p.*, b.name as brand_name,
        coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images,
        coalesce((select jsonb_agg(jsonb_build_object(
            'id', v.id, 'name', v.name, 'colorName', v.color, 'sizeName', v.size,
            'skuCode', v.sku, 'priceCents', v.price_cents, 'stockStatus', v.stock_status)
          order by v.color, v.size) from product_variants v where v.product_id = p.id), '[]'::jsonb) as variants,
        pr.id as release_id, pr.release_name, pr.release_type, pr.sale_status as release_sale_status,
        pr.lifecycle_status, pr.is_rerelease, pr.deposit_price_cents, pr.balance_price_cents,
        pr.full_price_cents, pr.start_at, pr.end_at, pr.balance_due_at, pr.ship_at
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
    product.currentRelease = releaseType === '' ? null : {
      id: stringValue(r.release_id),
      releaseName: stringValue(r.release_name),
      releaseType,
      saleStatus: stringValue(r.release_sale_status) || product.status,
      lifecycleStatus: stringValue(r.lifecycle_status),
      isRerelease: Boolean(r.is_rerelease),
      depositCents: numberValue(r.deposit_price_cents),
      balanceCents: numberValue(r.balance_price_cents),
      fullPriceCents: numberValue(r.full_price_cents),
      startAt: r.start_at != null ? dateValue(r.start_at) : '',
      endAt: r.end_at != null ? dateValue(r.end_at) : '',
      balanceDueAt: r.balance_due_at != null ? dateValue(r.balance_due_at) : '',
      shipAt: r.ship_at != null ? dateValue(r.ship_at) : '',
    };
    return product;
  }

  async getStyle(styleId: string): Promise<StyleDetail | null> {
    const rows = await this.sql`
      select s.*, b.name as brand_name,
        (select count(*)::int from products p
          where p.style_id = s.id and p.deleted_at is null and p.visibility_status = 'published') as product_count
      from styles s
      left join brands b on b.id = s.brand_id
      where s.id = ${styleId} and s.deleted_at is null
    `;
    if (rows.length === 0) return null;
    const row = rows[0] as Row;
    const productRows = await this.sql`
      select p.*, b.name as brand_name
      from products p
      left join brands b on b.id = p.brand_id
      where p.style_id = ${styleId} and p.deleted_at is null and p.visibility_status = 'published'
      order by p.feed_score desc, p.id desc
    `;
    return {
      id: stringValue(row.id),
      brandId: stringValue(row.brand_id),
      brandName: stringValue(row.brand_name),
      canonicalName: stringValue(row.canonical_name),
      category: stringValue(row.category),
      subCategory: stringValue(row.sub_category),
      styleTags: Array.isArray(row.style_tags) ? (row.style_tags as unknown[]).map(String) : [],
      description: stringValue(row.description),
      productCount: numberValue(row.product_count),
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
      products: productRows.map((r) => mapProduct(r as Row)),
    };
  }

  // ─── Phase 2.6: 品牌目录 ────────────────────────────────────────────

  async listBrands(userId?: string | null): Promise<BrandInfo[]> {
    const rows = await this.sql`
      select b.*, (select count(*)::int from products p
          where p.brand_id = b.id and p.deleted_at is null and p.visibility_status = 'published') as product_count
      from brands b
      where b.deleted_at is null
      order by b.heat_score desc, b.follower_count desc, b.name asc
      limit 200
    `;
    const followed = userId ? await this.getFollowedBrandIds(userId) : [];
    const followedSet = new Set(followed);
    return (rows as Row[]).map((row) => this.mapBrandRow(row, followedSet));
  }

  async getBrandById(brandId: string, userId?: string | null): Promise<BrandInfo | null> {
    const rows = await this.sql`
      select b.*, (select count(*)::int from products p
          where p.brand_id = b.id and p.deleted_at is null and p.visibility_status = 'published') as product_count
      from brands b
      where b.id = ${brandId} and b.deleted_at is null
    `;
    if (rows.length === 0) return null;
    const followed = userId ? await this.getFollowedBrandIds(userId) : [];
    return this.mapBrandRow(rows[0] as Row, new Set(followed));
  }

  async listBrandProducts(brandId: string, limit = 50): Promise<BrandProductItem[]> {
    const cap = Math.min(100, Math.max(1, limit));
    const rows = await this.sql`
      select p.*, b.name as brand_name,
        coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi
          where pi.product_id = p.id), '{}') as images,
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
      let badgeText = '';
      if (saleStatus === 'PRE_ORDER' || releaseType === 'reservation') badgeText = '预约';
      else if (releaseType === 'first_release') badgeText = '新品';
      else if (saleStatus === 'ON_SALE') badgeText = '现货';
      return {
        id: stringValue(row.id),
        title: stringValue(row.display_name) || stringValue(row.canonical_name),
        description: stringValue(row.description),
        brandId: stringValue(row.brand_id),
        brandName: stringValue(row.brand_name),
        category: stringValue(row.pit_type),
        priceCents: numberValue(row.current_price),
        originalPriceCents: numberValue(row.original_price),
        badgeText,
        coverUrl: Array.isArray(row.images) && (row.images as unknown[]).length > 0
          ? String((row.images as unknown[])[0]) : '',
        createdAt: dateValue(row.created_at),
      };
    });
  }

  // ─── Phase 2.6: 三坑榜单 ────────────────────────────────────────────

  async getRanking(tab: RankingTab, limit = 50): Promise<RankingItem[]> {
    const cap = Math.min(100, Math.max(1, limit));
    let rows: PendingQuery<Row[]> | Row[] = [];
    if (tab === 'hot') {
      // 热榜：按收藏数 desc，无收藏的按 feed_score 兜底
      rows = await this.sql`
        select p.*, b.name as brand_name,
          coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi
            where pi.product_id = p.id), '{}') as images,
          (select count(*)::int from wishlist_items w
            where w.product_id = p.id) as favorite_count,
          (select pr.release_type from product_releases pr
            where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
          (select count(*)::int from product_releases pr
            where pr.product_id = p.id and pr.release_type = 'reservation' and pr.deleted_at is null) as reservation_count
        from products p
        left join brands b on b.id = p.brand_id
        where p.deleted_at is null and p.visibility_status = 'published'
        order by (select count(*)::int from wishlist_items w where w.product_id = p.id) desc, p.feed_score desc, p.id desc
        limit ${cap}
      `;
    } else if (tab === 'new') {
      // 上新榜：最近 30 天创建/发售的新品，按时间倒序
      rows = await this.sql`
        select p.*, b.name as brand_name,
          coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi
            where pi.product_id = p.id), '{}') as images,
          (select pr.release_type from product_releases pr
            where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
          (select count(*)::int from product_releases pr
            where pr.product_id = p.id and pr.release_type = 'reservation' and pr.deleted_at is null) as reservation_count
        from products p
        left join brands b on b.id = p.brand_id
        where p.deleted_at is null and p.visibility_status = 'published'
          and p.created_at >= now() - interval '30 days'
        order by p.created_at desc, p.id desc
        limit ${cap}
      `;
    }
    return (rows as Row[]).map((row, index) => this.mapRankingRow(row, index + 1));
  }

  private mapBrandRow(row: Row, followedSet: Set<string>): BrandInfo {
    return {
      id: stringValue(row.id),
      name: stringValue(row.name),
      nameEn: stringValue(row.name_en),
      logo: stringValue(row.logo_url),
      description: stringValue(row.description),
      category: stringValue(row.category),
      officialUrl: stringValue(row.official_url),
      followerCount: numberValue(row.follower_count),
      isFollowed: followedSet.has(stringValue(row.id)),
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
    };
  }

  private mapRankingRow(row: Row, rank: number): RankingItem {
    const releaseType = stringValue(row.release_type);
    const priceCents = numberValue(row.current_price);
    return {
      rank,
      entityId: stringValue(row.id),
      title: stringValue(row.display_name) || stringValue(row.canonical_name),
      brandName: stringValue(row.brand_name),
      coverUrl: Array.isArray(row.images) && (row.images as unknown[]).length > 0
        ? String((row.images as unknown[])[0]) : '',
      priceCents,
      category: stringValue(row.pit_type),
      favoriteCount: numberValue(row.favorite_count),
      releaseTypeName: getReleaseTypeName(releaseType),
      daysAgo: Math.max(0, Math.floor((Date.now() - new Date(dateValue(row.created_at)).getTime()) / 86400000)),
      reservationCount: numberValue(row.reservation_count),
    };
  }

  async applySyncBatch(userId: string, operations: SyncOperationInput[]): Promise<SyncReceipt[]> {
    return this.sql.begin(async (tx) => {
      const receipts: SyncReceipt[] = [];
      for (const operation of operations) {
        const version = Date.now();
        // 同步负载是前端 JSON 字符串：sql.json 保留字符串语义（jsonb 文本）
        const inserted = await tx`
          insert into sync_operations
            (user_id, op_id, device_id, entity_type, entity_id, action, payload_json, result, server_version, client_created_at)
          values
            (${userId}, ${operation.opId}, ${operation.deviceId}, ${operation.entityType}, ${operation.entityId},
             ${operation.action}, ${this.sql.json(operation.payload)}, 'accepted', ${version}, ${new Date(Number(operation.createdAt) || Date.now())})
          on conflict (user_id, op_id) do nothing
          returning op_id, result, server_version
        `;
        const rows = inserted.length > 0 ? inserted : await tx`
          select op_id, result, server_version from sync_operations where user_id = ${userId} and op_id = ${operation.opId}
        `;
        const row = rows[0] as Row;
        receipts.push({ opId: stringValue(row.op_id), result: stringValue(row.result) as SyncReceipt['result'], serverVersion: numberValue(row.server_version) });
      }
      return receipts;
    });
  }

  async getSyncCheckpoint(userId: string): Promise<string> {
    const rows = await this.sql`select max(accepted_at) as checkpoint from sync_operations where user_id = ${userId}`;
    return rows[0]?.checkpoint == null ? '' : dateValue(rows[0].checkpoint);
  }

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

  async createAiTask(task: AiImportTask): Promise<AiImportTask> {
    await this.sql.begin(async (tx) => {
      await tx`
        insert into ai_import_tasks
          (id, user_id, object_key, media_id, task_type, source_platform, source_link, state, request_id,
           model_provider, model_name, model_version, created_at, expires_at)
        values
          (${task.taskId}, ${task.userId}, ${task.objectKey}, ${task.mediaId}, ${task.taskType}, ${task.sourcePlatform}, ${task.sourceLink},
           ${task.state}, ${task.requestId}, ${task.model.provider},
           ${task.model.name}, ${task.model.version}, ${task.createdAt}, ${task.expiresAt})
      `;
      await tx`
        insert into ai_import_suggestions
          (task_id, suggestion_json, confidence, field_confidence_json, evidence_json, warnings_json)
        values
          (${task.taskId}, ${task.suggestion}::jsonb, ${task.confidence},
           ${task.fieldConfidence}::jsonb, ${task.evidence}::jsonb,
           ${task.warnings}::jsonb)
      `;
    });
    return task;
  }

  async getAiTask(userId: string, taskId: string): Promise<AiImportTask | null> {
    const rows = await this.sql`
      select t.*, s.suggestion_json, s.confidence, s.field_confidence_json, s.evidence_json, s.warnings_json
      from ai_import_tasks t join ai_import_suggestions s on s.task_id = t.id
      where t.id = ${taskId} and t.user_id = ${userId}
    `;
    return rows.length === 0 ? null : mapAiTask(rows[0] as Row);
  }

  async updateAiTask(
    taskId: string,
    userId: string,
    patch: Partial<Pick<AiImportTask, 'state' | 'suggestion' | 'confidence' | 'fieldConfidence' | 'evidence' | 'warnings' | 'model'>>,
  ): Promise<AiImportTask | null> {
    return this.sql.begin(async (tx) => {
      const tasks = await tx`
        update ai_import_tasks
        set state = ${patch.state ?? ''},
            model_provider = ${patch.model?.provider ?? 'vision'},
            model_name = ${patch.model?.name ?? ''},
            model_version = ${patch.model?.version ?? ''}
        where id = ${taskId} and user_id = ${userId}
        returning *
      `;
      if (tasks.length === 0) return null;
      const suggestion = patch.suggestion ?? { name: '', brand: '', shopName: '', category: 'OTHER', orderNumber: '', orderDate: '', totalCents: 0, depositCents: 0, paidCents: 0, balanceDueDate: '', arrivalDate: '', note: '' };
      await tx`
        insert into ai_import_suggestions
          (task_id, suggestion_json, confidence, field_confidence_json, evidence_json, warnings_json)
        values
          (${taskId}, ${suggestion}::jsonb, ${patch.confidence ?? 0},
           ${patch.fieldConfidence ?? {}}::jsonb, ${patch.evidence ?? []}::jsonb,
           ${patch.warnings ?? []}::jsonb)
        on conflict (task_id) do update
          set suggestion_json = excluded.suggestion_json,
              confidence = excluded.confidence,
              field_confidence_json = excluded.field_confidence_json,
              evidence_json = excluded.evidence_json,
              warnings_json = excluded.warnings_json
      `;
      const row = await tx`
        select t.*, s.suggestion_json, s.confidence, s.field_confidence_json, s.evidence_json, s.warnings_json
        from ai_import_tasks t join ai_import_suggestions s on s.task_id = t.id
        where t.id = ${taskId}
      `;
      return mapAiTask(row[0] as Row);
    });
  }

  async confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask> {
    return this.sql.begin(async (tx) => {
      const taskRows = await tx`
        select t.*, s.suggestion_json, s.confidence, s.field_confidence_json, s.evidence_json, s.warnings_json
        from ai_import_tasks t join ai_import_suggestions s on s.task_id = t.id
        where t.id = ${taskId} and t.user_id = ${userId} for update
      `;
      if (taskRows.length === 0) throw notFound('AI 导入任务不存在');
      const task = mapAiTask(taskRows[0] as Row);
      if (task.state === 'confirmed') return task; // 幂等：已确认直接返回
      if (task.state !== 'ready') throw conflict('任务尚未识别完成，无法确认');

      // 校验 target purchase 存在且属于当前用户；仅记录审计关联，不建单、不覆盖
      const purchase = await tx`
        select id from user_assets
        where user_id = ${userId} and asset_type = 'purchase' and id = ${input.targetId} and deleted_at is null
      `;
      if (purchase.length === 0) throw notFound('目标订单不存在或不属于当前用户');

      if (input.opId) {
        const existingOp = await tx`select id from ai_import_confirmations where user_id = ${userId} and op_id = ${input.opId}`;
        if (existingOp.length > 0) return task; // 同 opId 网络重试：不重复记录
      }

      await tx`
        insert into ai_import_confirmations
          (id, task_id, user_id, target_type, target_id, confirmed_json, correction_json, op_id)
        values
          (${newId('aic')}, ${taskId}, ${userId}, 'purchase', ${input.targetId},
           ${input.confirmed}::jsonb,
           ${{ before: task.suggestion, after: input.confirmed }}::jsonb,
           ${input.opId ?? ''})
        on conflict (task_id) do nothing
      `;
      const updated = await tx`
        update ai_import_tasks set state = 'confirmed', confirmed_at = now(), target_type = 'purchase', target_id = ${input.targetId}
        where id = ${taskId}
        returning *, ${task.suggestion}::jsonb as suggestion_json, ${task.confidence}::double precision as confidence,
          ${task.fieldConfidence}::jsonb as field_confidence_json, ${task.evidence}::jsonb as evidence_json,
          ${task.warnings}::jsonb as warnings_json
      `;
      return mapAiTask(updated[0] as Row);
    });
  }

  // ─── D8: 用户行为事件 ──────────────────────────────────────

  async recordEvent(userId: string | null, input: CreateUserEventInput): Promise<UserEvent> {
    const id = newId('evt');
    if (userId) {
      await this.sql`INSERT INTO user_events (id, user_id, event_type, target_type, target_id, metadata)
        VALUES (${id}, ${userId}, ${input.eventType}, ${input.targetType}, ${input.targetId}, ${input.metadata ?? {}}::jsonb)`;
    } else {
      await this.sql`INSERT INTO user_events (id, event_type, target_type, target_id, metadata)
        VALUES (${id}, ${input.eventType}, ${input.targetType}, ${input.targetId}, ${input.metadata ?? {}}::jsonb)`;
    }
    return {
      id, userId, eventType: input.eventType,
      targetType: input.targetType, targetId: input.targetId,
      metadata: input.metadata ?? {}, createdAt: new Date().toISOString(),
    };
  }

  async getUserEvents(userId: string, eventType?: string, limit: number = 50): Promise<UserEvent[]> {
    let rows;
    if (eventType) {
      rows = await this.sql`SELECT * FROM user_events WHERE user_id = ${userId} AND event_type = ${eventType}
        ORDER BY created_at DESC LIMIT ${limit}`;
    } else {
      rows = await this.sql`SELECT * FROM user_events WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT ${limit}`;
    }
    return rows.map((r: Row) => ({
      id: stringValue(r.id),
      userId: r.user_id == null ? null : stringValue(r.user_id),
      eventType: stringValue(r.event_type) as UserEvent['eventType'],
      targetType: stringValue(r.target_type),
      targetId: stringValue(r.target_id),
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: dateValue(r.created_at),
    }));
  }

  // ─── D8: 收藏体系 ─────────────────────────────────────────

  async addWishlist(userId: string, input: CreateWishlistInput): Promise<WishlistItem> {
    // 幂等：同一用户 + 同一 productId 重复 POST 返回既有条目，绝不创建重复收藏
    if (input.productId) {
      const existing = await this.sql`
        select * from wishlist_items where user_id = ${userId} and product_id = ${input.productId} limit 1
      `;
      if (existing.length > 0) return this.mapWishlist(existing[0] as Row);
    }
    const id = newId('wli');
    const now = new Date();
    const rows = await this.sql`
      INSERT INTO wishlist_items (id, user_id, title, status, product_id, release_id, note, created_at, updated_at)
      VALUES (${id}, ${userId}, ${input.title}, ${input.status},
        ${input.productId ?? null}, ${input.releaseId ?? null}, ${input.note ?? ''}, ${now}, ${now})
      ON CONFLICT (user_id, product_id) WHERE product_id IS NOT NULL DO NOTHING
      RETURNING *`;
    if (rows.length === 0 && input.productId) {
      // 并发竞争：返回既有条目
      const raced = await this.sql`
        select * from wishlist_items where user_id = ${userId} and product_id = ${input.productId} limit 1
      `;
      return this.mapWishlist(raced[0] as Row);
    }
    return this.mapWishlist(rows[0] as Row);
  }

  async updateWishlistStatus(wishlistId: string, userId: string, status: string): Promise<WishlistItem> {
    const rows = await this.sql`UPDATE wishlist_items SET status = ${status}, updated_at = now()
      WHERE id = ${wishlistId} AND user_id = ${userId} RETURNING *`;
    if (rows.length === 0) throw notFound('收藏项不存在');
    return this.mapWishlist(rows[0] as Row);
  }

  async removeWishlist(wishlistId: string, userId: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM wishlist_items WHERE id = ${wishlistId} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
  }

  async listWishlist(userId: string, status?: string): Promise<WishlistItem[]> {
    let rows;
    if (status) {
      rows = await this.sql`SELECT * FROM wishlist_items WHERE user_id = ${userId} AND status = ${status} ORDER BY created_at DESC`;
    } else {
      rows = await this.sql`SELECT * FROM wishlist_items WHERE user_id = ${userId} ORDER BY created_at DESC`;
    }
    return rows.map((r: Row) => this.mapWishlist(r));
  }

  async isProductWishlisted(userId: string, productId: string): Promise<boolean> {
    const rows = await this.sql`SELECT 1 FROM wishlist_items WHERE user_id = ${userId} AND product_id = ${productId} LIMIT 1`;
    return rows.length > 0;
  }

  private mapWishlist(row: Row): WishlistItem {
    return {
      id: stringValue(row.id),
      userId: stringValue(row.user_id),
      title: stringValue(row.title),
      status: stringValue(row.status) as WishlistItem['status'],
      productId: row.product_id == null ? null : stringValue(row.product_id),
      releaseId: row.release_id == null ? null : stringValue(row.release_id),
      note: stringValue(row.note),
      payloadJson: (row.payload_json ?? {}) as Record<string, unknown>,
      createdAt: dateValue(row.created_at),
      updatedAt: dateValue(row.updated_at),
    };
  }

  // ─── D8: 品牌关注 ─────────────────────────────────────────

  /** 品牌 id 或品牌名 → 品牌 id（兼容按名关注） */
  private async resolveBrandId(brandId: string): Promise<string | null> {
    const byId = await this.sql`select id from brands where id = ${brandId} and deleted_at is null`;
    if (byId.length > 0) return stringValue((byId[0] as Row).id);
    const byName = await this.sql`select id from brands where name = ${brandId} and deleted_at is null limit 1`;
    return byName.length > 0 ? stringValue((byName[0] as Row).id) : null;
  }

  async followBrand(userId: string, brandId: string): Promise<BrandFollower> {
    const resolved = await this.resolveBrandId(brandId);
    if (!resolved) throw notFound('品牌不存在');
    await this.sql`INSERT INTO brand_followers (user_id, brand_id) VALUES (${userId}, ${resolved})
      ON CONFLICT (user_id, brand_id) DO NOTHING`;
    const rows = await this.sql`SELECT * FROM brand_followers WHERE user_id = ${userId} AND brand_id = ${resolved}`;
    const row = rows[0];
    if (!row) throw notFound('品牌关注不存在');
    return { userId: stringValue(row.user_id), brandId: stringValue(row.brand_id), createdAt: dateValue(row.created_at) };
  }

  async unfollowBrand(userId: string, brandId: string): Promise<boolean> {
    const resolved = await this.resolveBrandId(brandId);
    if (!resolved) return false;
    const rows = await this.sql`DELETE FROM brand_followers WHERE user_id = ${userId} AND brand_id = ${resolved} RETURNING user_id`;
    return rows.length > 0;
  }

  async isFollowingBrand(userId: string, brandId: string): Promise<boolean> {
    const rows = await this.sql`SELECT 1 FROM brand_followers WHERE user_id = ${userId} AND brand_id = ${brandId} LIMIT 1`;
    return rows.length > 0;
  }

  async getFollowedBrandIds(userId: string): Promise<string[]> {
    const rows = await this.sql`SELECT brand_id FROM brand_followers WHERE user_id = ${userId}`;
    return rows.map((r: Row) => stringValue(r.brand_id));
  }

  // ─── D8: 个性化评分 ───────────────────────────────────────

  async getUserPreference(userId: string): Promise<UserPreference> {
    const followedBrandIds = await this.getFollowedBrandIds(userId);

    // 收藏的品类
    const catRows = await this.sql`SELECT DISTINCT p.pit_type as category
      FROM wishlist_items w JOIN products p ON p.id = w.product_id
      WHERE w.user_id = ${userId} AND w.product_id IS NOT NULL`;
    const wishlistCategories = catRows.map((r: Row) => stringValue(r.category));

    // 收藏的标签
    const tagRows = await this.sql`SELECT DISTINCT unnest(
      COALESCE(p.season_tags, '{}') || COALESCE(p.scene_tags, '{}') || COALESCE(p.element_tags, '{}')
    ) AS tag
      FROM wishlist_items w JOIN products p ON p.id = w.product_id
      WHERE w.user_id = ${userId} AND w.product_id IS NOT NULL`;
    const wishlistTags = tagRows.map((r: Row) => stringValue(r.tag));

    // 浏览的品类
    const viewRows = await this.sql`SELECT DISTINCT p.pit_type as category
      FROM user_events e JOIN products p ON p.id = e.target_id
      WHERE e.user_id = ${userId} AND e.event_type = 'VIEW_PRODUCT'`;
    const viewedCategories = viewRows.map((r: Row) => stringValue(r.category));

    // 搜索关键词
    const searchRows = await this.sql`SELECT metadata->>'q' AS q
      FROM user_events WHERE user_id = ${userId} AND event_type = 'SEARCH'
      AND metadata->>'q' IS NOT NULL ORDER BY created_at DESC LIMIT 20`;
    const searchedKeywords = searchRows.map((r: Row) => stringValue(r.q));

    return { followedBrandIds, wishlistCategories, wishlistTags, viewedCategories, searchedKeywords };
  }

  async computePersonalScore(input: PersonalScoreInput): Promise<PersonalScoreResult> {
    const preference = await this.getUserPreference(input.userId);
    return computePersonalScore(input, preference);
  }
  // ─── V2.5: 页面级用户资产 ──────────────────────────────────

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
      values (${userId}, ${kind}, ${assetId}, ${payload}::jsonb)
      returning id, asset_type, payload_json, version, created_at, updated_at
    `;
    return mapUserAsset(rows[0] as Row);
  }

  async updateUserAsset(userId: string, kind: UserAssetKind, assetId: string, patch: Record<string, unknown>): Promise<UserAsset | null> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        update user_assets
        set payload_json = payload_json || ${patch}::jsonb,
            version = version + 1,
            updated_at = now()
        where user_id = ${userId} and asset_type = ${kind} and id = ${assetId} and deleted_at is null
        returning id, asset_type, payload_json, version, created_at, updated_at
      `;
      if (rows.length === 0) return null;
      // 尾款日期联动：更新订单尾款日 → 同步更新关联 BALANCE 提醒（remindDate），避免提醒与订单脱节
      if (kind === 'purchase') {
        const newDeadline = (patch.balanceDueDate ?? patch.deadline) as unknown;
        if (typeof newDeadline === 'string' && newDeadline !== '') {
          await tx`
            update user_assets
            set payload_json = jsonb_set(payload_json, '{remindDate}', to_jsonb(${newDeadline}), true),
                payload_json = jsonb_set(payload_json, '{resyncedFrom}', to_jsonb(${assetId}), true),
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
        // 删除订单 → 同步软删关联提醒，杜绝孤儿提醒
        await tx`
          update user_assets set deleted_at = now(), version = version + 1, updated_at = now()
          where user_id = ${userId} and asset_type = 'reminder' and deleted_at is null
            and payload_json->>'relatedPurchaseId' = ${assetId}
        `;
      }
      return true;
    });
  }

  async getUserSetting(userId: string, key: UserSettingKey): Promise<Record<string, unknown>> {
    const rows = await this.sql`select payload_json from user_settings where user_id = ${userId} and setting_key = ${key}`;
    return rows.length === 0 ? {} : (rows[0] as Row).payload_json as Record<string, unknown>;
  }

  async putUserSetting(userId: string, key: UserSettingKey, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rows = await this.sql`
      insert into user_settings (user_id, setting_key, payload_json)
      values (${userId}, ${key}, ${payload}::jsonb)
      on conflict (user_id, setting_key) do update
        set payload_json = excluded.payload_json, updated_at = now()
      returning payload_json
    `;
    return (rows[0] as Row).payload_json as Record<string, unknown>;
  }

  private async communityPage(viewerUserId: string | null, query: CommunityPostQuery, authorUserId = '', productId = ''): Promise<CommunityPostPage> {
    const offset = Math.max(0, Number.parseInt(query.cursor || '0', 10) || 0);
    const limit = Math.min(51, Math.max(2, query.limit + 1));
    const viewerId = viewerUserId ?? '';
    const category = query.category ?? '';
    const topic = query.topic ?? '';
    const rows = await this.sql`
      select p.id, p.author_user_id, u.nickname as author_nickname, p.media_id, p.image_url, p.caption, p.category, p.topic, p.product_id, p.created_at, p.updated_at,
        (select count(*)::int from community_post_likes l where l.post_id = p.id) as like_count,
        exists(select 1 from community_post_likes l where l.post_id = p.id and l.user_id = ${viewerId}) as liked,
        count(*) over() as total_count
      from community_posts p
      join users u on u.id = p.author_user_id
      where p.deleted_at is null
        and (${authorUserId} = '' or p.author_user_id = ${authorUserId})
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

  /** Phase 2.3-A：商品关联社区内容（商品详情「真实买家」模块数据源） */
  async listProductCommunityPosts(productId: string, query: Pick<CommunityPostQuery, 'cursor' | 'limit'>): Promise<CommunityPostPage> {
    return this.communityPage(null, query, '', productId);
  }

  async createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost> {
    const rows = await this.sql`
      insert into community_posts (id, author_user_id, media_id, image_url, caption, category, topic, product_id)
      values (${input.id}, ${userId}, ${input.mediaId}, ${input.imageUrl}, ${input.caption}, ${input.category}, ${input.topic}, ${input.productId ?? null})
      returning id, author_user_id, media_id, image_url, caption, category, topic, product_id, created_at, updated_at
    `;
    const row = rows[0] as Row;
    return {
      id: stringValue(row.id), authorUserId: stringValue(row.author_user_id),
      authorNickname: (await this.getUser(userId))?.nickname ?? '三坑同好',
      mediaId: stringValue(row.media_id), imageUrl: stringValue(row.image_url),
      caption: stringValue(row.caption), category: stringValue(row.category), topic: stringValue(row.topic),
      productId: row.product_id == null ? null : stringValue(row.product_id),
      likeCount: 0, liked: false, createdAt: dateValue(row.created_at), updatedAt: dateValue(row.updated_at),
    };
  }

  async getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null> {
    const viewerId = viewerUserId ?? '';
    const rows = await this.sql`
      select p.id, p.author_user_id, u.nickname as author_nickname, p.media_id, p.image_url, p.caption, p.category, p.topic, p.product_id, p.created_at, p.updated_at,
        (select count(*)::int from community_post_likes l where l.post_id = p.id) as like_count,
        exists(select 1 from community_post_likes l where l.post_id = p.id and l.user_id = ${viewerId}) as liked
      from community_posts p join users u on u.id = p.author_user_id
      where p.id = ${postId} and p.deleted_at is null and (p.visibility = 'public' or p.author_user_id = ${viewerId})
    `;
    return rows.length === 0 ? null : mapCommunityPost(rows[0] as Row);
  }

  async setCommunityPostLike(userId: string, postId: string, liked: boolean): Promise<{ liked: boolean; likeCount: number } | null> {
    const post = await this.sql`select id from community_posts where id = ${postId} and deleted_at is null and visibility = 'public'`;
    if (post.length === 0) return null;
    if (liked) {
      await this.sql`insert into community_post_likes (post_id, user_id) values (${postId}, ${userId}) on conflict do nothing`;
    } else {
      await this.sql`delete from community_post_likes where post_id = ${postId} and user_id = ${userId}`;
    }
    const rows = await this.sql`
      select count(*)::int as like_count,
        exists(select 1 from community_post_likes where post_id = ${postId} and user_id = ${userId}) as liked
      from community_post_likes where post_id = ${postId}
    `;
    return { liked: (rows[0] as Row).liked === true, likeCount: numberValue((rows[0] as Row).like_count) };
  }

  async deleteCommunityPost(userId: string, postId: string): Promise<boolean> {
    const rows = await this.sql`
      update community_posts set deleted_at = now(), updated_at = now()
      where id = ${postId} and author_user_id = ${userId} and deleted_at is null
      returning id
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

  // ─── Phase 2.6: 意见反馈 ─────────────────────────────────────────────

  async createFeedback(userId: string | null, input: CreateFeedbackInput): Promise<FeedbackRecord> {
    await this.sql`
      insert into feedback_records (id, user_id, type, content, contact, images, created_at)
      values (${input.id}, ${userId}, ${input.type}, ${input.content}, ${input.contact},
              ${this.sql.json(input.images)}, ${new Date(Number(input.createdAt) || Date.now())})
      on conflict (id) do nothing
    `;
    return {
      id: input.id,
      userId,
      type: input.type,
      content: input.content,
      contact: input.contact,
      images: input.images,
      status: 'open',
      createdAt: input.createdAt,
    };
  }

}
