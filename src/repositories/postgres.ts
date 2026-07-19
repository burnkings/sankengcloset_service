import postgres, { type Sql } from 'postgres';
import { conflict, notFound } from '../lib/problem.js';
import { newId, nowIso } from '../lib/id.js';
import type { AppRepository, FeedQuery, FeedResult } from './contracts.js';
import type {
  AiConfirmationInput,
  AiImportTask,
  AiSuggestion,
  MediaObject,
  Product,
  SyncOperationInput,
  SyncReceipt,
  UserProfile,
} from '../types.js';

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
    title: stringValue(row.title),
    category: stringValue(row.category) as Product['category'],
    status: stringValue(row.status),
    coverUrl: stringValue(row.cover_url),
    images,
    priceCents: numberValue(row.price_cents),
    originalPriceCents: numberValue(row.original_price_cents),
    description: stringValue(row.description),
    shopUrl: stringValue(row.shop_url),
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
    const clauses = ['p.deleted_at is null'];
    const allowedCategories = new Set(['JK', 'LOLITA', 'HANFU', 'OTHER']);
    if (allowedCategories.has(query.category)) clauses.push(`p.category = '${query.category}'`);
    if (query.channel === 'reservation') clauses.push(`p.status = 'PRE_ORDER'`);
    if (query.channel === 'new') clauses.push(`p.status = 'UPCOMING'`);
    const offset = Math.max(0, Number.parseInt(query.cursor || '0', 10) || 0);
    const limit = Math.min(51, Math.max(2, query.limit + 1));
    const rows = await this.sql.unsafe(
      `select p.*, count(*) over() as total_count,
        coalesce((select array_agg(pi.object_key order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images
       from products p where ${clauses.join(' and ')}
       order by p.created_at desc, p.id desc offset ${offset} limit ${limit}`,
    );
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const items = visible.map((row) => {
      const product = mapProduct(row as Row);
      return {
        id: `feed_${product.id}`,
        feedType: 'product', entityId: product.id, title: product.title, subtitle: product.brandName,
        coverUrl: product.coverUrl, secondaryCoverUrl: product.images[1] ?? '', brandId: product.brandId,
        brandName: product.brandName, price: product.priceCents, originalPrice: product.originalPriceCents,
        badgeText: product.status === 'PRE_ORDER' ? '预约' : product.status === 'UPCOMING' ? '新品' : '',
        eventStartAt: '', eventEndAt: '', liked: false, saved: false, sourceLabel: '官方资料', rankingScore: 1,
        category: product.category, createdAt: product.createdAt,
      };
    });
    return {
      items,
      nextCursor: hasMore ? String(offset + query.limit) : '',
      hasMore,
      totalHint: rows.length === 0 ? 0 : numberValue((rows[0] as Row).total_count),
    };
  }

  async getProduct(_userId: string | null, productId: string): Promise<Product | null> {
    const rows = await this.sql`
      select p.*,
        coalesce((select array_agg(pi.object_key order by pi.sort_order) from product_images pi where pi.product_id = p.id), '{}') as images
      from products p where p.id = ${productId} and p.deleted_at is null
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
}
