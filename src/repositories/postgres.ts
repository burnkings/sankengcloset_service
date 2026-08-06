import postgres, { type Sql } from 'postgres';
import { conflict, notFound } from '../lib/problem.js';
import { newId, nowIso } from '../lib/id.js';
import type { AppRepository, CommunityPost, CommunityPostPage, CommunityPostQuery, CreateCommunityPostInput, FeedQuery, FeedResult, UserAsset, UserAssetKind, UserSettingKey } from './contracts.js';
import type {
  AiConfirmationInput,
  AiImportTask,
  AiSuggestion,
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

function stringValue(value: unknown): string { return value == null ? '' : String(value); }
function numberValue(value: unknown): number { return Number(value ?? 0); }
function dateValue(value: unknown): string { return value instanceof Date ? value.toISOString() : stringValue(value); }

function mapUser(row: Row): UserProfile {
  return {
    id: stringValue(row.id),
    nickname: stringValue(row.nickname),
    status: 'active',
    createdAt: dateValue(row.created_at),
  };
}

function mapProduct(row: Row): Product {
  const images = Array.isArray(row.images) ? row.images.map(String) : [];
  return {
    id: stringValue(row.id),
    brandId: stringValue(row.brand_id),
    brandName: stringValue(row.brand_name),
    title: stringValue(row.display_name || row.canonical_name),
    category: (stringValue(row.category) || '') as Product['category'],
    status: stringValue(row.sale_status || row.status),
    coverUrl: stringValue(row.cover_url),
    images,
    priceCents: numberValue(row.current_price || row.price_cents),
    originalPriceCents: numberValue(row.original_price || row.original_price_cents),
    description: stringValue(row.description),
    shopUrl: stringValue(row.source_url),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
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
      returning id, nickname, status, created_at
    `;
    return mapUser(rows[0] as Row);
  }

  async ensureWechatUser(openId: string, nickname: string): Promise<UserProfile> {
    return this.sql.begin(async (tx) => {
      const existing = await tx`
        select u.id, u.nickname, u.status, u.created_at
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
        const created = await tx`select id, nickname, status, created_at from users where id = ${userId}`;
        return mapUser(created[0] as Row);
      }

      await tx`delete from users where id = ${userId}`;
      const raced = await tx`
        select u.id, u.nickname, u.status, u.created_at
        from user_identities i join users u on u.id = i.user_id
        where i.provider = 'wechat' and i.provider_subject = ${openId} and u.status = 'active'
      `;
      return mapUser(raced[0] as Row);
    });
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    const rows = await this.sql`select id, nickname, status, created_at from users where id = ${userId} and status = 'active'`;
    return rows.length === 0 ? null : mapUser(rows[0] as Row);
  }

  async listFeed(_userId: string | null, query: FeedQuery): Promise<FeedResult> {
    const allowedCategories = new Set(['JK', 'LOLITA', 'HANFU', 'OTHER']);

    // Resolve category filter: categories (comma-separated) takes precedence over single category
    let categoryFilter: string[] = [];
    if (query.categories) {
      categoryFilter = query.categories
        .split(',')
        .map(c => c.trim().toUpperCase())
        .filter(c => allowedCategories.has(c));
    } else if (allowedCategories.has(query.category)) {
      categoryFilter = [query.category];
    }

    const channelReservation = query.channel === 'reservation';
    const channelNew = query.channel === 'new';
    const offset = Math.max(0, Number.parseInt(query.cursor || '0', 10) || 0);
    const limit = Math.min(51, Math.max(2, query.limit + 1));

    // Build WHERE clauses with postgres.js tagged-template parameterization
    const staticClauses = [
      this.sql`p.deleted_at is null`,
      this.sql`p.visibility_status = 'published'`,
    ];
    if (categoryFilter.length > 0) {
      staticClauses.push(this.sql`p.category IN ${this.sql(categoryFilter)}`);
    }
    if (channelReservation) {
      staticClauses.push(this.sql`p.sale_status = 'PRE_ORDER'`);
    }
    if (channelNew) {
      staticClauses.push(this.sql`p.sale_status = 'UPCOMING'`);
    }

    // Combine all WHERE clauses with AND
    const whereClause = staticClauses.reduce((acc, clause, i) =>
      i === 0 ? clause : this.sql`${acc} AND ${clause}`
    );

    const rows = await this.sql`
      select p.*,
        b.name as brand_name,
        b.heat_score as brand_heat_score,
        count(*) over() as total_count,
        coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images,
        -- 最新 release
        (select pr.release_type from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
        (select pr.release_name from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_name,
        (select pr.is_rerelease from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as is_rerelease,
        (select pr.end_at from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_end_at,
        (select pr.lifecycle_status from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_lifecycle,
        (select ps.price_cents from price_snapshots ps where ps.product_id = p.id order by ps.fetched_at desc limit 1) as snapshot_price
       from products p
       left join brands b on b.id = p.brand_id
       where ${whereClause}
       order by p.feed_score desc, p.created_at desc, p.id desc offset ${offset} limit ${limit}
    `;
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
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

      // 判断是否新品（7天内）
      const createdAt = new Date(product.createdAt).getTime();
      const isNew = (Date.now() - createdAt) / (1000 * 60 * 60 * 24) <= 7;

      // 价格变化检测
      const snapshotPrice = numberValue(r.snapshot_price);
      const hasPriceDrop = snapshotPrice > 0 && snapshotPrice < product.priceCents;

      const feedReason = generateFeedReason({
        saleStatus,
        releaseType,
        isRerelease,
        isNew,
        brandHeatScore,
        hasPriceDrop,
        priceTrend: hasPriceDrop ? 'down' : 'stable',
        feedScore,
        eventEndAt: releaseEndAt,
      });

      // 前端期望的 badgeText 字段
      const badgeText: string =
        hasPriceDrop ? '降价'
        : saleStatus === 'PRE_ORDER' ? '预约'
        : isNew ? '新品'
        : '';

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
        price: product.priceCents,
        originalPrice: product.originalPriceCents,
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
        badgeText,
        eventStartAt: '',
        eventEndAt: releaseEndAt,
        liked: false,
        saved: false,
        sourceLabel: '官方资料',
        publishedAt: product.createdAt,
        createdAt: product.createdAt,
      };
    });
    return {
      items,
      nextCursor: hasMore ? String(offset + query.limit) : '',
      hasMore,
      totalHint: rows.length === 0 ? 0 : numberValue((rows[0] as Row).total_count),
    };
  }

  /**
   * 搜索关键词 → 坑向分类别名映射：
   * 洛丽塔/Lolita/LOLITA → LOLITA；汉服/HANFU → HANFU；JK/制服 → JK。
   * 命中别名时额外按 p.category 匹配，确保「搜洛丽塔出 Lolita 分类」。
   */
  resolveAliasCategory(q: string): string {
    const lower = q.trim().toLowerCase();
    if (lower.includes('洛丽塔') || lower === 'lolita') return 'LOLITA';
    if (lower.includes('汉服') || lower === 'hanfu') return 'HANFU';
    if (lower === 'jk' || lower.includes('jk') || lower.includes('制服')) return 'JK';
    return '';
  }

  async searchProducts(query: SearchQuery): Promise<SearchResult> {
  const clauses: string[] = ['p.deleted_at is null', "p.visibility_status = 'published'"];
  const params: any[] = [];
  let paramIdx = 1;

  // 关键词搜索（title/brand ILIKE + pg_trgm 相似度 + 别名命中 category）
  if (query.q) {
    const q = query.q;
    const aliasCategory = this.resolveAliasCategory(q);
    const likeParam = `%${q}%`;
    params.push(likeParam);
    // 搜索范围：display_name / canonical_name / brand name（ILIKE + pg_trgm 相似度）
    let kwClause = `(p.display_name ILIKE $${paramIdx} OR p.canonical_name ILIKE $${paramIdx} OR b.name ILIKE $${paramIdx})`;
    paramIdx += 1;
    params.push(q);
    kwClause += ` OR p.display_name % $${paramIdx} OR p.canonical_name % $${paramIdx} OR b.name % $${paramIdx}`;
    paramIdx += 1;
    if (aliasCategory !== '') {
      params.push(aliasCategory);
      kwClause += ` OR p.category = $${paramIdx}`;
      paramIdx += 1;
    }
    clauses.push(kwClause);
  }

  // 分类过滤
  const allowedCategories = new Set(['JK', 'LOLITA', 'HANFU', 'OTHER']);
  if (query.category && allowedCategories.has(query.category)) {
    params.push(query.category);
    clauses.push(`p.category = $${paramIdx}`);
    paramIdx += 1;
  }

  // 发售状态
  if (query.saleStatus) {
    params.push(query.saleStatus);
    clauses.push(`p.sale_status = $${paramIdx}`);
    paramIdx += 1;
  }

  // 发售类型
  if (query.releaseStatus) {
    params.push(query.releaseStatus);
    clauses.push(`exists (select 1 from product_releases pr where pr.product_id = p.id and pr.release_type = $${paramIdx} and pr.deleted_at is null)`);
    paramIdx += 1;
  }

  // 品牌ID
  if (query.brandId) {
    params.push(query.brandId);
    clauses.push(`p.brand_id = $${paramIdx}`);
    paramIdx += 1;
  }

  // 价格范围
  if (query.minPrice > 0) {
    params.push(query.minPrice);
    clauses.push(`p.current_price >= $${paramIdx}`);
    paramIdx += 1;
  }
  if (query.maxPrice > 0) {
    params.push(query.maxPrice);
    clauses.push(`p.current_price <= $${paramIdx}`);
    paramIdx += 1;
  }

  const offset = Math.max(0, Number.parseInt(query.cursor || '0', 10) || 0);
  const limit = Math.min(51, Math.max(2, query.limit + 1));

  const rows = await this.sql.unsafe(
    `select p.*,
      b.name as brand_name,
      b.heat_score as brand_heat_score,
      count(*) over() as total_count,
      coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images,
      (select pr.release_type from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as release_type,
      (select pr.is_rerelease from product_releases pr where pr.product_id = p.id and pr.deleted_at is null order by pr.created_at desc limit 1) as is_rerelease
     from products p
     left join brands b on b.id = p.brand_id
     where ${clauses.join(' and ')}
     order by p.feed_score desc, p.created_at desc, p.id desc offset ${offset} limit ${limit}`,
    params,
  );

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
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
        saleStatus,
        releaseType,
        isRerelease,
        isNew,
        brandHeatScore,
        hasPriceDrop: false,
        priceTrend: 'stable',
        feedScore,
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
        price: product.priceCents,
        originalPrice: product.originalPriceCents,
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
        saved: false,
        sourceLabel: '搜索结果',
        publishedAt: product.createdAt,
        createdAt: product.createdAt,
      };
    });

    return {
      items,
      nextCursor: hasMore ? String(offset + query.limit) : '',
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
        p.category,
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

  async getProduct(_userId: string | null, productId: string): Promise<Product | null> {
    const rows = await this.sql`
      select p.*, b.name as brand_name,
        coalesce((select array_agg(pi.url order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images
      from products p
      left join brands b on b.id = p.brand_id
      where p.id = ${productId} and p.deleted_at is null and p.visibility_status = 'published'
    `;
    return rows.length === 0 ? null : mapProduct(rows[0] as Row);
  }

  async applySyncBatch(userId: string, operations: SyncOperationInput[]): Promise<SyncReceipt[]> {
    return this.sql.begin(async (tx) => {
      const receipts: SyncReceipt[] = [];
      for (const operation of operations) {
        const version = Date.now();
        const inserted = await tx`
          insert into sync_operations
            (user_id, op_id, device_id, entity_type, entity_id, action, payload_json, result, server_version, client_created_at)
          values
            (${userId}, ${operation.opId}, ${operation.deviceId}, ${operation.entityType}, ${operation.entityId},
             ${operation.action}, ${operation.payload}::jsonb, 'accepted', ${version}, ${new Date(Number(operation.createdAt) || Date.now())})
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
          (id, user_id, object_key, state, request_id, model_provider, model_name, model_version, created_at, expires_at)
        values
          (${task.taskId}, ${task.userId}, ${task.objectKey}, ${task.state}, ${task.requestId}, ${task.model.provider},
           ${task.model.name}, ${task.model.version}, ${task.createdAt}, ${task.expiresAt})
      `;
      await tx`
        insert into ai_import_suggestions
          (task_id, suggestion_json, confidence, field_confidence_json, evidence_json, warnings_json)
        values
          (${task.taskId}, ${JSON.stringify(task.suggestion)}::jsonb, ${task.confidence},
           ${JSON.stringify(task.fieldConfidence)}::jsonb, ${JSON.stringify(task.evidence)}::jsonb,
           ${JSON.stringify(task.warnings)}::jsonb)
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

  async confirmAiTask(userId: string, taskId: string, input: AiConfirmationInput): Promise<AiImportTask> {
    return this.sql.begin(async (tx) => {
      const taskRows = await tx`
        select t.*, s.suggestion_json, s.confidence, s.field_confidence_json, s.evidence_json, s.warnings_json
        from ai_import_tasks t join ai_import_suggestions s on s.task_id = t.id
        where t.id = ${taskId} and t.user_id = ${userId} for update
      `;
      if (taskRows.length === 0) throw notFound('AI 导入任务不存在');
      const task = mapAiTask(taskRows[0] as Row);
      if (task.state === 'confirmed') {
        if (task.targetType !== input.targetType) throw conflict('该任务已经确认到其他目标');
        return task;
      }
      const existing = await tx`select id from ai_import_confirmations where user_id = ${userId} and op_id = ${input.opId}`;
      if (existing.length > 0) return task;
      const targetId = newId(input.targetType === 'wardrobe' ? 'wdi' : 'wli');
      if (input.targetType === 'wardrobe') {
        await tx`insert into wardrobe_items (id, user_id, category, title, payload_json) values (${targetId}, ${userId}, ${input.confirmed.category}, ${input.confirmed.name}, ${JSON.stringify(input.confirmed)}::jsonb)`;
      } else {
        await tx`insert into wishlist_items (id, user_id, title, status, payload_json) values (${targetId}, ${userId}, ${input.confirmed.name}, 'WISH', ${JSON.stringify(input.confirmed)}::jsonb)`;
      }
      await tx`
        insert into ai_import_confirmations (id, task_id, user_id, target_type, target_id, confirmed_json, correction_json, op_id)
        values (${newId('aic')}, ${taskId}, ${userId}, ${input.targetType}, ${targetId}, ${JSON.stringify(input.confirmed)}::jsonb,
          ${JSON.stringify({ before: task.suggestion, after: input.confirmed })}::jsonb, ${input.opId})
      `;
      const updated = await tx`
        update ai_import_tasks set state = 'confirmed', confirmed_at = now(), target_type = ${input.targetType}, target_id = ${targetId}
        where id = ${taskId}
        returning *, ${JSON.stringify(input.confirmed)}::jsonb as suggestion_json, ${task.confidence}::double precision as confidence,
          ${JSON.stringify(task.fieldConfidence)}::jsonb as field_confidence_json, ${JSON.stringify(task.evidence)}::jsonb as evidence_json,
          ${JSON.stringify(task.warnings)}::jsonb as warnings_json
      `;
      return mapAiTask(updated[0] as Row);
    });
  }

  // ─── D8: 用户行为事件 ──────────────────────────────────────

  async recordEvent(userId: string | null, input: CreateUserEventInput): Promise<UserEvent> {
    const id = newId('evt');
    const metadataJson = JSON.stringify(input.metadata ?? {});
    if (userId) {
      await this.sql`INSERT INTO user_events (id, user_id, event_type, target_type, target_id, metadata)
        VALUES (${id}, ${userId}, ${input.eventType}, ${input.targetType}, ${input.targetId}, ${metadataJson}::jsonb)`;
    } else {
      await this.sql`INSERT INTO user_events (id, event_type, target_type, target_id, metadata)
        VALUES (${id}, ${input.eventType}, ${input.targetType}, ${input.targetId}, ${metadataJson}::jsonb)`;
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
    const id = newId('wli');
    const now = new Date();
    const rows = await this.sql`
      INSERT INTO wishlist_items (id, user_id, title, status, product_id, release_id, note, created_at, updated_at)
      VALUES (${id}, ${userId}, ${input.title}, ${input.status},
        ${input.productId ?? null}, ${input.releaseId ?? null}, ${input.note ?? ''}, ${now}, ${now})
      RETURNING *`;
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

  async followBrand(userId: string, brandId: string): Promise<BrandFollower> {
    await this.sql`INSERT INTO brand_followers (user_id, brand_id) VALUES (${userId}, ${brandId})
      ON CONFLICT (user_id, brand_id) DO NOTHING`;
    const rows = await this.sql`SELECT * FROM brand_followers WHERE user_id = ${userId} AND brand_id = ${brandId}`;
    const row = rows[0];
    if (!row) throw notFound('品牌关注不存在');
    return { userId: stringValue(row.user_id), brandId: stringValue(row.brand_id), createdAt: dateValue(row.created_at) };
  }

  async unfollowBrand(userId: string, brandId: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM brand_followers WHERE user_id = ${userId} AND brand_id = ${brandId} RETURNING user_id`;
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
    const catRows = await this.sql`SELECT DISTINCT p.category
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
    const viewRows = await this.sql`SELECT DISTINCT p.category
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
    const payloadJson = JSON.stringify(payload);
    const rows = await this.sql`
      insert into user_assets (user_id, asset_type, id, payload_json)
      values (${userId}, ${kind}, ${assetId}, ${payloadJson}::jsonb)
      returning id, asset_type, payload_json, version, created_at, updated_at
    `;
    return mapUserAsset(rows[0] as Row);
  }

  async updateUserAsset(userId: string, kind: UserAssetKind, assetId: string, patch: Record<string, unknown>): Promise<UserAsset | null> {
    const patchJson = JSON.stringify(patch);
    const rows = await this.sql`
      update user_assets
      set payload_json = payload_json || ${patchJson}::jsonb,
          version = version + 1,
          updated_at = now()
      where user_id = ${userId} and asset_type = ${kind} and id = ${assetId} and deleted_at is null
      returning id, asset_type, payload_json, version, created_at, updated_at
    `;
    return rows.length === 0 ? null : mapUserAsset(rows[0] as Row);
  }

  async deleteUserAsset(userId: string, kind: UserAssetKind, assetId: string): Promise<boolean> {
    const rows = await this.sql`
      update user_assets set deleted_at = now(), version = version + 1, updated_at = now()
      where user_id = ${userId} and asset_type = ${kind} and id = ${assetId} and deleted_at is null
      returning id
    `;
    return rows.length > 0;
  }

  async getUserSetting(userId: string, key: UserSettingKey): Promise<Record<string, unknown>> {
    const rows = await this.sql`select payload_json from user_settings where user_id = ${userId} and setting_key = ${key}`;
    return rows.length === 0 ? {} : (rows[0] as Row).payload_json as Record<string, unknown>;
  }

  async putUserSetting(userId: string, key: UserSettingKey, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const payloadJson = JSON.stringify(payload);
    const rows = await this.sql`
      insert into user_settings (user_id, setting_key, payload_json)
      values (${userId}, ${key}, ${payloadJson}::jsonb)
      on conflict (user_id, setting_key) do update
        set payload_json = excluded.payload_json, updated_at = now()
      returning payload_json
    `;
    return (rows[0] as Row).payload_json as Record<string, unknown>;
  }

  private async communityPage(viewerUserId: string | null, query: CommunityPostQuery, authorUserId = ''): Promise<CommunityPostPage> {
    const offset = Math.max(0, Number.parseInt(query.cursor || '0', 10) || 0);
    const limit = Math.min(51, Math.max(2, query.limit + 1));
    const viewerId = viewerUserId ?? '';
    const category = query.category ?? '';
    const topic = query.topic ?? '';
    const rows = await this.sql`
      select p.id, p.author_user_id, u.nickname as author_nickname, p.media_id, p.image_url, p.caption, p.category, p.topic, p.created_at, p.updated_at,
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

  async createCommunityPost(userId: string, input: CreateCommunityPostInput): Promise<CommunityPost> {
    const rows = await this.sql`
      insert into community_posts (id, author_user_id, media_id, image_url, caption, category, topic)
      values (${input.id}, ${userId}, ${input.mediaId}, ${input.imageUrl}, ${input.caption}, ${input.category}, ${input.topic})
      returning id, author_user_id, media_id, image_url, caption, category, topic, created_at, updated_at
    `;
    const row = rows[0] as Row;
    return {
      id: stringValue(row.id), authorUserId: stringValue(row.author_user_id),
      authorNickname: (await this.getUser(userId))?.nickname ?? '三坑同好',
      mediaId: stringValue(row.media_id), imageUrl: stringValue(row.image_url),
      caption: stringValue(row.caption), category: stringValue(row.category), topic: stringValue(row.topic),
      likeCount: 0, liked: false, createdAt: dateValue(row.created_at), updatedAt: dateValue(row.updated_at),
    };
  }

  async getCommunityPost(viewerUserId: string | null, postId: string): Promise<CommunityPost | null> {
    const viewerId = viewerUserId ?? '';
    const rows = await this.sql`
      select p.id, p.author_user_id, u.nickname as author_nickname, p.media_id, p.image_url, p.caption, p.category, p.topic, p.created_at, p.updated_at,
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

}
