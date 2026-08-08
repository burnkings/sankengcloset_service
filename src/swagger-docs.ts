/**
 * swagger-docs.ts — 三坑绮橱 API 文档元数据
 *
 * 通过 @fastify/swagger 的 transform 钩子做「纯文档注入」：
 *  - 不改任何路由的运行时行为（请求校验仍走各路由内的 zod parse）
 *  - 只为 OpenAPI 文档补充 tags / summary / description / 参数 / 鉴权标注
 *  - zod schema 经 zod-to-json-schema 转 JSON Schema，与运行时校验同源
 */

import type { FastifySchema } from 'fastify';
import { z, type ZodTypeAny } from 'zod';

import { feedQuerySchema, searchQuerySchema, trendQuerySchema, productParamsSchema } from './routes/content.js';
import { devLoginSchema, refreshSchema, wechatSchema } from './routes/sessions.js';
import {
  createEventSchema, getEventsSchema, addWishlistSchema, updateWishlistSchema, wishlistQuerySchema, followBrandSchema,
} from './routes/interaction.js';
import { batchSchema } from './routes/sync.js';
import { prepareSchema, uploadParamsSchema, mediaParamsSchema, sourceSchema } from './routes/uploads.js';
import {
  assetParamsSchema, pageSchema, preferenceSchema, budgetSchema,
  postCreateSchema, postParamsSchema, postLikeSchema, postQuerySchema,
  wardrobeSchema, purchaseSchema, reminderSchema, wishSchema, notificationSchema,
} from './routes/user-data.js';
import { createSchema as aiCreateSchema, taskParamsSchema, confirmSchema } from './routes/ai-import.js';
import { updateVisibilitySchema, batchUpdateSchema } from './routes/review.js';

// ─── API 标签分组 ─────────────────────────────────────────────

export const API_TAGS = [
  { name: 'health', description: '健康检查（探活）' },
  { name: 'sessions', description: '会话与认证（微信登录 / 刷新 / 登出 / 当前用户）' },
  { name: 'content', description: '内容发现（首页 Feed / 搜索 / 趋势 / 商品详情）' },
  { name: 'user-assets', description: '用户资产（衣橱 / 账单 / 提醒 / 心愿 / 通知）' },
  { name: 'preferences', description: '偏好与预算设置' },
  { name: 'community', description: '圈子动态（穿搭分享）' },
  { name: 'interaction', description: '互动（行为事件 / 商品收藏 / 品牌关注）' },
  { name: 'sync', description: '离线同步' },
  { name: 'uploads', description: '图片上传与媒体读取' },
  { name: 'ai-import', description: 'AI 拍照识别建档（内部功能）' },
  { name: 'review', description: '审核管理（后台用，App 不调）' },
] as const;

// ─── 文档条目类型 ─────────────────────────────────────────────

type RouteDoc = {
  tags: string[];
  summary: string;
  description?: string;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  body?: ZodTypeAny;
  /** true = 需要 Bearer 登录 */
  security?: boolean;
  /** 响应码说明，缺省用通用模板 */
  responses?: Record<string, { description: string }>;
};

const idParam = z.object({ id: z.string().min(1).max(128) });
const brandIdParam = z.object({ brandId: z.string().min(1).max(128) });
const reviewParams = z.object({ id: z.string().min(1).max(128) });

const DEFAULT_RESPONSES = {
  200: { description: '成功（data 为业务数据）' },
  400: { description: '参数校验失败 VALIDATION_FAILED' },
  401: { description: '未登录或令牌失效 UNAUTHORIZED' },
  404: { description: '资源不存在' },
  500: { description: '服务内部错误 SERVER_ERROR' },
};

// ─── 路由文档表（key = "method url"）──────────────────────────

export const ROUTE_DOCS: Record<string, RouteDoc> = {
  // ── 健康检查 ──
  'get /health': { tags: ['health'], summary: '健康探活', description: '服务进程存活检查，返回固定状态快照' },
  'get /ready': { tags: ['health'], summary: '就绪探活', description: '数据库连通检查，异常时返回 503' },
  'get /admin': { tags: ['health'], summary: '管理面板页面（HTML）', description: '返回管理后台 HTML 页面，非 API' },

  // ── 会话与认证 ──
  'post /api/v1/sessions/dev': {
    tags: ['sessions'], summary: '开发登录（仅 test 环境）', security: false,
    body: devLoginSchema, responses: DEFAULT_RESPONSES,
  },
  'post /api/v1/sessions/wechat': {
    tags: ['sessions'], summary: '微信登录', description: '用微信 code 换登录令牌，未配置 AppID/Secret 时返回 503',
    body: wechatSchema, responses: DEFAULT_RESPONSES,
  },
  'post /api/v1/sessions/refresh': {
    tags: ['sessions'], summary: '刷新访问令牌', body: refreshSchema, responses: DEFAULT_RESPONSES,
  },
  'delete /api/v1/sessions/current': {
    tags: ['sessions'], summary: '登出（注销当前会话）', security: true,
    responses: { 204: { description: '成功无返回体' }, ...DEFAULT_RESPONSES },
  },
  'get /api/v1/me': {
    tags: ['sessions'], summary: '当前用户信息', security: true, responses: DEFAULT_RESPONSES,
  },

  // ── 内容发现 ──
  'get /api/v1/feed': {
    tags: ['content'], summary: '首页 Feed（支持个性化与坑向筛选）',
    description: '频道 channel（recommend/new/reservation/price_drop/outfit）+ 坑向 category/categories 过滤；匿名可访问，登录后叠加行为个性化评分',
    query: feedQuerySchema, responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/search': {
    tags: ['content'], summary: '商品搜索',
    description: '关键词 q 匹配商品名/品牌名（ILIKE）+ 坑向别名；支持分类/销售状态/品牌/价格区间筛选，cursor 分页',
    query: searchQuerySchema, responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/trends': {
    tags: ['content'], summary: '价格趋势汇总', query: trendQuerySchema, responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/products/:id': {
    tags: ['content'], summary: '商品详情', params: productParamsSchema, responses: DEFAULT_RESPONSES,
  },

  // ── 互动 ──
  'post /api/v1/events': {
    tags: ['interaction'], summary: '上报用户行为事件', description: '匿名可上报（userId 为空时记录匿名事件）',
    body: createEventSchema, responses: { 201: { description: '创建成功' }, ...DEFAULT_RESPONSES },
  },
  'get /api/v1/events': {
    tags: ['interaction'], summary: '查询我的行为事件', query: getEventsSchema, responses: DEFAULT_RESPONSES,
  },
  'post /api/v1/wishlist': {
    tags: ['interaction'], summary: '新增商品收藏', security: true, body: addWishlistSchema,
    responses: { 201: { description: '创建成功' }, ...DEFAULT_RESPONSES },
  },
  'get /api/v1/wishlist': {
    tags: ['interaction'], summary: '查询商品收藏列表', security: true, query: wishlistQuerySchema,
    responses: DEFAULT_RESPONSES,
  },
  'patch /api/v1/wishlist/:id': {
    tags: ['interaction'], summary: '更新收藏状态', security: true, params: idParam, body: updateWishlistSchema,
    responses: DEFAULT_RESPONSES,
  },
  'delete /api/v1/wishlist/:id': {
    tags: ['interaction'], summary: '删除收藏', security: true, params: idParam,
    responses: { 204: { description: '成功无返回体' }, ...DEFAULT_RESPONSES },
  },
  'post /api/v1/brands/follow': {
    tags: ['interaction'], summary: '关注品牌', security: true, body: followBrandSchema,
    responses: { 201: { description: '创建成功' }, ...DEFAULT_RESPONSES },
  },
  'delete /api/v1/brands/:brandId/follow': {
    tags: ['interaction'], summary: '取消关注品牌', security: true, params: brandIdParam,
    responses: { 204: { description: '成功无返回体' }, ...DEFAULT_RESPONSES },
  },
  'get /api/v1/brands/followed': {
    tags: ['interaction'], summary: '我关注的品牌 ID 列表', security: true, responses: DEFAULT_RESPONSES,
  },

  // ── 同步 ──
  'post /api/v1/sync/operations:batch': {
    tags: ['sync'], summary: '批量提交离线操作', security: true, body: batchSchema, responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/sync/checkpoint': {
    tags: ['sync'], summary: '查询同步检查点', security: true, responses: DEFAULT_RESPONSES,
  },

  // ── 上传与媒体 ──
  'get /api/v1/media/:mediaId': {
    tags: ['uploads'], summary: '读取已上传图片（公开，圈子动态图）',
    params: mediaParamsSchema, responses: { 200: { description: '图片二进制' }, 404: { description: '图片不存在' } },
  },
  'post /api/v1/uploads:prepare': {
    tags: ['uploads'], summary: '创建上传任务', security: true,
    description: '返回 uploadId + PUT 地址，随后用原始二进制 PUT content',
    body: prepareSchema, responses: DEFAULT_RESPONSES,
  },
  'put /api/v1/uploads/:uploadId/content': {
    tags: ['uploads'], summary: '上传图片二进制（PUT 原始 body）', security: true,
    description: 'body 为原始图片字节流（application/octet-stream），非 multipart',
    params: uploadParamsSchema,
    responses: { 201: { description: '上传成功' }, 413: { description: '图片过大' }, ...DEFAULT_RESPONSES },
  },
  'delete /api/v1/media/source': {
    tags: ['uploads'], summary: '删除已上传媒体', security: true, body: sourceSchema,
    responses: { 204: { description: '成功无返回体' }, ...DEFAULT_RESPONSES },
  },

  // ── 偏好与预算 ──
  'get /api/v1/me/budget': { tags: ['preferences'], summary: '查询月度预算', security: true, responses: DEFAULT_RESPONSES },
  'put /api/v1/me/budget': {
    tags: ['preferences'], summary: '设置月度预算', security: true, body: budgetSchema, responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/me/preferences': {
    tags: ['preferences'], summary: '查询内容偏好（坑向/关注品牌/价格区间/主题）', security: true, responses: DEFAULT_RESPONSES,
  },
  'put /api/v1/me/preferences': {
    tags: ['preferences'], summary: '保存内容偏好', security: true, body: preferenceSchema, responses: DEFAULT_RESPONSES,
  },

  // ── 圈子动态 ──
  'get /api/v1/community/posts': {
    tags: ['community'], summary: '圈子动态流（公开）', query: postQuerySchema, responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/me/community/posts': {
    tags: ['community'], summary: '我发布的动态', security: true, query: pageSchema, responses: DEFAULT_RESPONSES,
  },
  'post /api/v1/community/posts': {
    tags: ['community'], summary: '发布穿搭动态', security: true,
    description: '需先完成图片上传（uploads:prepare → PUT content）拿到 mediaId',
    body: postCreateSchema, responses: { 201: { description: '创建成功' }, ...DEFAULT_RESPONSES },
  },
  'get /api/v1/community/posts/:id': {
    tags: ['community'], summary: '动态详情（公开）', params: postParamsSchema, responses: DEFAULT_RESPONSES,
  },
  'put /api/v1/community/posts/:id/like': {
    tags: ['community'], summary: '点赞 / 取消点赞', security: true, params: postParamsSchema, body: postLikeSchema,
    responses: DEFAULT_RESPONSES,
  },
  'delete /api/v1/community/posts/:id': {
    tags: ['community'], summary: '删除动态（仅作者）', security: true, params: postParamsSchema,
    responses: { 204: { description: '成功无返回体' }, ...DEFAULT_RESPONSES },
  },

  // ── AI 导入（内部功能）──
  'post /api/v1/ai/import-tasks': {
    tags: ['ai-import'], summary: '创建 AI 识别任务', security: true, body: aiCreateSchema,
    responses: { 202: { description: '任务已受理' }, ...DEFAULT_RESPONSES },
  },
  'get /api/v1/ai/import-tasks/:taskId': {
    tags: ['ai-import'], summary: '查询识别任务', security: true, params: taskParamsSchema, responses: DEFAULT_RESPONSES,
  },
  'post /api/v1/ai/import-tasks/:taskId/confirm': {
    tags: ['ai-import'], summary: '确认识别结果并入档', security: true, params: taskParamsSchema, body: confirmSchema,
    responses: DEFAULT_RESPONSES,
  },
  'delete /api/v1/ai/import-tasks/:taskId/source': {
    tags: ['ai-import'], summary: '删除任务与源图片', security: true, params: taskParamsSchema,
    responses: { 204: { description: '成功无返回体' }, ...DEFAULT_RESPONSES },
  },

  // ── 审核（后台用）──
  'patch /api/v1/review/products/:id/visibility': {
    tags: ['review'], summary: '审核单个商品可见性', params: reviewParams, body: updateVisibilitySchema,
    responses: DEFAULT_RESPONSES,
  },
  'post /api/v1/review/products/batch-visibility': {
    tags: ['review'], summary: '批量审核商品可见性', body: batchUpdateSchema, responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/review/products': {
    tags: ['review'], summary: '待审核商品列表',
    query: z.object({ status: z.string().default('draft'), limit: z.coerce.number().default(20), offset: z.coerce.number().default(0) }),
    responses: DEFAULT_RESPONSES,
  },
  'get /api/v1/review/history': {
    tags: ['review'], summary: '审核历史',
    query: z.object({ entity_type: z.string().default('product'), entity_id: z.string().default(''), limit: z.coerce.number().default(20) }),
    responses: DEFAULT_RESPONSES,
  },
};

// ─── 用户资产循环路由（5 实体 × 5 方法）───────────────────────

const ASSET_DEFS: { path: string; kind: string; label: string; create: z.ZodObject<z.ZodRawShape> }[] = [
  { path: 'wardrobe', kind: '衣橱', label: '衣橱条目', create: wardrobeSchema },
  { path: 'purchases', kind: '账单', label: '账单记录', create: purchaseSchema },
  { path: 'reminders', kind: '提醒', label: '提醒条目', create: reminderSchema },
  { path: 'wishes', kind: '心愿', label: '心愿条目', create: wishSchema },
  { path: 'notifications', kind: '通知', label: '通知条目', create: notificationSchema },
];

for (const def of ASSET_DEFS) {
  const base = `/api/v1/me/${def.path}`;
  ROUTE_DOCS[`get ${base}`] = {
    tags: ['user-assets'], summary: `查询${def.kind}列表`, security: true, responses: DEFAULT_RESPONSES,
  };
  ROUTE_DOCS[`get ${base}/:id`] = {
    tags: ['user-assets'], summary: `查询单个${def.kind}`, security: true, params: assetParamsSchema,
    responses: DEFAULT_RESPONSES,
  };
  ROUTE_DOCS[`post ${base}`] = {
    tags: ['user-assets'], summary: `新增${def.kind}`, security: true, body: def.create,
    responses: { 201: { description: '创建成功' }, ...DEFAULT_RESPONSES },
  };
  ROUTE_DOCS[`patch ${base}/:id`] = {
    tags: ['user-assets'], summary: `更新${def.kind}（部分字段）`, security: true, params: assetParamsSchema,
    body: def.create.partial(), responses: DEFAULT_RESPONSES,
  };
  ROUTE_DOCS[`delete ${base}/:id`] = {
    tags: ['user-assets'], summary: `删除${def.kind}`, security: true, params: assetParamsSchema,
    responses: { 204: { description: '成功无返回体' }, ...DEFAULT_RESPONSES },
  };
}

// ─── transform：纯文档注入 ────────────────────────────────────

type TransformArgs = {
  schema: FastifySchema;
  url: string;
  route: { method: string | string[] | undefined };
  [key: string]: unknown;
};

/**
 * @fastify/swagger transform 钩子：
 * 根据 method+url 查表，把文档元数据合并进该路由的 OpenAPI 定义。
 * 只影响文档生成，不改动路由运行时行为。
 */
export function swaggerTransform({ schema, url, route }: TransformArgs): { schema: FastifySchema; url: string } {
  const method = String(route.method ?? '').toLowerCase();
  const key = `${method} ${url}`;
  const doc = ROUTE_DOCS[key];
  if (!doc) return { schema, url };

  const result: Record<string, unknown> = { ...(schema ?? {}) };
  if (doc.tags) result.tags = [...doc.tags];
  if (doc.summary) result.summary = doc.summary;
  if (doc.description) result.description = doc.description;
  if (doc.query) result.querystring = toJsonSchema(doc.query);
  if (doc.params) result.params = toJsonSchema(doc.params);
  if (doc.body) result.body = toJsonSchema(doc.body);
  if (doc.security) result.security = [{ bearerAuth: [] }];
  if (doc.responses) result.response = doc.responses;

  return { schema: result as FastifySchema, url };
}

/**
 * zod v4 schema → OpenAPI 3 JSON Schema。
 * 使用 zod 4 原生 toJSONSchema()（4.4.3 内置），不依赖第三方转换库。
 * 附加处理：带 default 的字段从 required 中移除（OpenAPI 语义：有默认值 ≠ 必填）。
 */
function toJsonSchema(schema: ZodTypeAny): object {
  const json = (schema as { toJSONSchema(): { type?: string; properties?: Record<string, { default?: unknown }>; required?: string[] } }).toJSONSchema();
  if (json.type === 'object' && json.properties != null && Array.isArray(json.required)) {
    const optionalKeys = Object.entries(json.properties)
      .filter(([, prop]) => prop.default !== undefined)
      .map(([key]) => key);
    if (optionalKeys.length > 0) {
      json.required = json.required.filter((key) => optionalKeys.indexOf(key) < 0);
    }
  }
  return json;
}
