-- Sankeng Closet 14表新基线，替换废止的26表稿
-- 仅在空的独立数据库执行；现有服务尚未适配此结构。
-- 不包含旧表兼容、数据搬运、DROP SCHEMA 或自动生产迁移。
-- 所有应用表建在 public；Directus 系统表不在本文件管理范围。
BEGIN;
SET LOCAL search_path TO public;

CREATE TABLE users (
  id text PRIMARY KEY,
  nickname text NOT NULL,
  login_provider text,
  login_subject text,
  preferences_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(preferences_json)='object'),
  budget_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(budget_json)='object'),
  UNIQUE(login_provider,login_subject),
  CHECK ((login_provider IS NULL) = (login_subject IS NULL)),
  avatar_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS '应用账号；与 Directus 管理员账号分离';
COMMENT ON COLUMN users.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN users.nickname IS '昵称';
COMMENT ON COLUMN users.avatar_url IS '头像地址';
COMMENT ON COLUMN users.status IS '账号状态';
COMMENT ON COLUMN users.created_at IS '创建时间';
COMMENT ON COLUMN users.updated_at IS '修改时间';

CREATE TABLE user_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  refresh_token_hash text NOT NULL UNIQUE,
  device_id text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_sessions IS '刷新令牌会话';
COMMENT ON COLUMN user_sessions.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN user_sessions.user_id IS '所属用户';
COMMENT ON COLUMN user_sessions.refresh_token_hash IS '只存令牌哈希';
COMMENT ON COLUMN user_sessions.device_id IS '设备标识';
COMMENT ON COLUMN user_sessions.platform IS '客户端平台';
COMMENT ON COLUMN user_sessions.expires_at IS '过期时间';
COMMENT ON COLUMN user_sessions.revoked_at IS '撤销时间';
COMMENT ON COLUMN user_sessions.created_at IS '创建时间';
COMMENT ON COLUMN user_sessions.last_used_at IS '最近使用时间';

CREATE TABLE brands (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name))>0),
  name_en text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN ('JK','LOLITA','HANFU','OTHER')),
  logo_url text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  official_url text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  popular_series text[] NOT NULL DEFAULT '{}',
  brand_status text NOT NULL DEFAULT 'active' CHECK (brand_status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE brands IS '品牌目录，不以店铺名自动创建品牌';
COMMENT ON COLUMN brands.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN brands.name IS '品牌名称';
COMMENT ON COLUMN brands.name_en IS '英文名称';
COMMENT ON COLUMN brands.category IS '坑向';
COMMENT ON COLUMN brands.logo_url IS '品牌图';
COMMENT ON COLUMN brands.description IS '介绍';
COMMENT ON COLUMN brands.official_url IS '官方外链';
COMMENT ON COLUMN brands.source_url IS '资料出处';
COMMENT ON COLUMN brands.popular_series IS '展示用系列名称，不承担关联 ID';
COMMENT ON COLUMN brands.brand_status IS '品牌状态';
COMMENT ON COLUMN brands.created_at IS '创建时间';
COMMENT ON COLUMN brands.updated_at IS '修改时间';
COMMENT ON COLUMN brands.deleted_at IS '软删除时间';

CREATE TABLE products (
  id text PRIMARY KEY,
  title text NOT NULL CHECK(length(btrim(title))>0),
  brand_id text REFERENCES brands(id),
  shop_name text NOT NULL DEFAULT '',
  category text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','OTHER')),
  sub_category text NOT NULL DEFAULT '',
  group_key text,
  images jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(images)='array'),
  variants jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(variants)='array'),
  view_count bigint NOT NULL DEFAULT 0 CHECK(view_count>=0),
  reviewed_by text REFERENCES users(id),
  reviewed_at timestamptz,
  description text NOT NULL DEFAULT '',
  sale_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_status IN ('UPCOMING','ON_SALE','PRE_ORDER','SOLD_OUT','ENDED','UNKNOWN')),
  price_cents integer CHECK(price_cents>=0),
  price_type text NOT NULL DEFAULT 'UNKNOWN' CHECK(price_type IN ('FULL','DEPOSIT','BALANCE','INTENTION','UNKNOWN')),
  original_price_cents integer CHECK(original_price_cents>=0),
  currency text NOT NULL DEFAULT 'CNY',
  source_platform text NOT NULL,
  external_id text,
  canonical_url text NOT NULL,
  color_tags text[] NOT NULL DEFAULT '{}',
  material_tags text[] NOT NULL DEFAULT '{}',
  style_tags text[] NOT NULL DEFAULT '{}',
  season_tags text[] NOT NULL DEFAULT '{}',
  scene_tags text[] NOT NULL DEFAULT '{}',
  element_tags text[] NOT NULL DEFAULT '{}',
  recommended_tags text[] NOT NULL DEFAULT '{}',
  feed_score integer NOT NULL DEFAULT 0,
  visibility_status text NOT NULL DEFAULT 'draft' CHECK(visibility_status IN ('draft','reviewing','published','hidden')),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE products IS '商品介绍主表；一个来源商品链接一个 ID';
COMMENT ON COLUMN products.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN products.title IS '唯一正式名称，替代 canonical_name/display_name';
COMMENT ON COLUMN products.brand_id IS '品牌，可未知';
COMMENT ON COLUMN products.shop_name IS '店铺展示名';
COMMENT ON COLUMN products.category IS '坑向';
COMMENT ON COLUMN products.sub_category IS '商品分类';
COMMENT ON COLUMN products.description IS '商品说明，允许部件价格/尺码/不确定时间原文';
COMMENT ON COLUMN products.sale_status IS '当前人工确认状态';
COMMENT ON COLUMN products.price_cents IS '商品层参考报价；未知 NULL';
COMMENT ON COLUMN products.price_type IS '报价含义';
COMMENT ON COLUMN products.original_price_cents IS '核实的原价；不是现货价';
COMMENT ON COLUMN products.currency IS '币种';
COMMENT ON COLUMN products.source_platform IS '来源平台代码';
COMMENT ON COLUMN products.external_id IS '来源商品 ID；无则 NULL';
COMMENT ON COLUMN products.canonical_url IS '清除追踪参数后的商品外链';
COMMENT ON COLUMN products.color_tags IS '颜色信息，不推断 SKU 组合';
COMMENT ON COLUMN products.material_tags IS '材质';
COMMENT ON COLUMN products.style_tags IS '风格；原 tags/product_tags 汇入此或相应标签数组';
COMMENT ON COLUMN products.season_tags IS '季节';
COMMENT ON COLUMN products.scene_tags IS '场景';
COMMENT ON COLUMN products.element_tags IS '元素';
COMMENT ON COLUMN products.recommended_tags IS '运营标签';
COMMENT ON COLUMN products.feed_score IS '推荐排序分，不冒充浏览数';
COMMENT ON COLUMN products.visibility_status IS '唯一发布状态';
COMMENT ON COLUMN products.version IS '修改版本';
COMMENT ON COLUMN products.created_at IS '创建时间';
COMMENT ON COLUMN products.updated_at IS '修改时间';
COMMENT ON COLUMN products.deleted_at IS '软删除时间';

CREATE TABLE product_releases (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  release_name text NOT NULL DEFAULT '',
  release_no integer NOT NULL CHECK(release_no>0),
  release_type text NOT NULL DEFAULT 'unknown' CHECK(release_type IN ('first_release','rerelease','reservation','spot','lottery','unknown')),
  sale_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(sale_status IN ('UPCOMING','ON_SALE','PRE_ORDER','SOLD_OUT','ENDED','UNKNOWN')),
  deposit_cents integer CHECK(deposit_cents>=0),
  balance_cents integer CHECK(balance_cents>=0),
  full_price_cents integer CHECK(full_price_cents>=0),
  start_at timestamptz,
  end_at timestamptz,
  balance_due_at timestamptz,
  ship_at timestamptz,
  CHECK(end_at IS NULL OR start_at IS NULL OR end_at>=start_at),
  shipping_note text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  visibility_status text NOT NULL DEFAULT 'draft' CHECK(visibility_status IN ('draft','reviewing','published','hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(id,product_id),
  UNIQUE(product_id,release_no)
);
COMMENT ON TABLE product_releases IS '同一商品的不同发售批次，保存批次参考金额';
COMMENT ON COLUMN product_releases.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN product_releases.product_id IS '商品';
COMMENT ON COLUMN product_releases.release_name IS '批次名称';
COMMENT ON COLUMN product_releases.release_no IS '商品内批次序号';
COMMENT ON COLUMN product_releases.release_type IS '批次类型';
COMMENT ON COLUMN product_releases.sale_status IS '该批次状态';
COMMENT ON COLUMN product_releases.deposit_cents IS '核实的批次定金';
COMMENT ON COLUMN product_releases.balance_cents IS '核实的批次尾款';
COMMENT ON COLUMN product_releases.full_price_cents IS '核实的批次全价';
COMMENT ON COLUMN product_releases.shipping_note IS '不确定的发货说明原文';
COMMENT ON COLUMN product_releases.source_url IS '批次资料来源';
COMMENT ON COLUMN product_releases.visibility_status IS '批次发布状态';
COMMENT ON COLUMN product_releases.created_at IS '创建时间';
COMMENT ON COLUMN product_releases.updated_at IS '修改时间';
COMMENT ON COLUMN product_releases.deleted_at IS '软删除时间';

CREATE TABLE product_favorites (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  product_id text NOT NULL REFERENCES products(id),
  release_id text,
  intent_status text CHECK(intent_status IN ('WANT','WATCHING','WAIT_RELEASE','WAIT_BALANCE','PURCHASED')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,product_id),
  FOREIGN KEY(release_id,product_id) REFERENCES product_releases(id,product_id)
);
COMMENT ON TABLE product_favorites IS '替代 wishlist_items；商品收藏及待购意向';
COMMENT ON COLUMN product_favorites.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN product_favorites.user_id IS '所属用户';
COMMENT ON COLUMN product_favorites.product_id IS '被收藏商品，禁止空关联';
COMMENT ON COLUMN product_favorites.release_id IS '关注批次，可空';
COMMENT ON COLUMN product_favorites.intent_status IS 'NULL 表示无待购意向；收藏由关系存在表示';
COMMENT ON COLUMN product_favorites.note IS '个人备注';
COMMENT ON COLUMN product_favorites.created_at IS '创建时间';
COMMENT ON COLUMN product_favorites.updated_at IS '修改时间';

CREATE TABLE brand_followers (
  user_id text NOT NULL REFERENCES users(id),
  brand_id text NOT NULL REFERENCES brands(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,brand_id)
);
COMMENT ON TABLE brand_followers IS '唯一品牌关注数据源';
COMMENT ON COLUMN brand_followers.user_id IS '所属用户';
COMMENT ON COLUMN brand_followers.brand_id IS '品牌 ID，禁止存名称';
COMMENT ON COLUMN brand_followers.created_at IS '创建时间';

CREATE TABLE user_assets (
  user_id text NOT NULL REFERENCES users(id),
  asset_type text NOT NULL CHECK(asset_type IN ('wardrobe','purchase','reminder','wish','notification')),
  id text NOT NULL,
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY(user_id,asset_type,id)
);
COMMENT ON TABLE user_assets IS '个人衣橱/购买/提醒/手写心愿/通知的唯一存储';
COMMENT ON COLUMN user_assets.user_id IS '所属用户';
COMMENT ON COLUMN user_assets.asset_type IS '资产类型';
COMMENT ON COLUMN user_assets.id IS '类型内资产 ID';
COMMENT ON COLUMN user_assets.payload_json IS '严格按类型校验，字段字典见设计文档';
COMMENT ON COLUMN user_assets.version IS '乐观锁版本';
COMMENT ON COLUMN user_assets.created_at IS '创建时间';
COMMENT ON COLUMN user_assets.updated_at IS '修改时间';
COMMENT ON COLUMN user_assets.deleted_at IS '软删除时间';

CREATE TABLE media_objects (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(id),
  object_key text NOT NULL UNIQUE,
  upload_id text NOT NULL UNIQUE,
  purpose text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK(size_bytes>=0),
  uploaded_at timestamptz,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE media_objects IS '用户上传图片，不重复承载外站商品图片';
COMMENT ON COLUMN media_objects.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN media_objects.owner_user_id IS '上传人';
COMMENT ON COLUMN media_objects.object_key IS '对象存储键';
COMMENT ON COLUMN media_objects.upload_id IS '上传会话';
COMMENT ON COLUMN media_objects.purpose IS '用途，沿用上传接口枚举';
COMMENT ON COLUMN media_objects.content_type IS '媒体类型';
COMMENT ON COLUMN media_objects.size_bytes IS '文件大小';
COMMENT ON COLUMN media_objects.uploaded_at IS '上传完成时间';
COMMENT ON COLUMN media_objects.retention_until IS '保留期限';
COMMENT ON COLUMN media_objects.created_at IS '创建时间';
COMMENT ON COLUMN media_objects.deleted_at IS '软删除时间';

CREATE TABLE community_posts (
  id text PRIMARY KEY,
  author_user_id text NOT NULL REFERENCES users(id),
  media_id text NOT NULL REFERENCES media_objects(id),
  caption text NOT NULL DEFAULT '' CHECK(length(caption)<=600),
  category text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','MIXED')),
  topic text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
  product_id text REFERENCES products(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE community_posts IS '轻社区动态；当前接口一帖一图';
COMMENT ON COLUMN community_posts.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN community_posts.author_user_id IS '作者';
COMMENT ON COLUMN community_posts.media_id IS '已上传图片；imageUrl 由媒体接口生成';
COMMENT ON COLUMN community_posts.caption IS '正文';
COMMENT ON COLUMN community_posts.category IS '坑向';
COMMENT ON COLUMN community_posts.topic IS '单话题，不扩展话题关系表';
COMMENT ON COLUMN community_posts.visibility IS '可见范围';
COMMENT ON COLUMN community_posts.product_id IS '可选关联商品';
COMMENT ON COLUMN community_posts.created_at IS '创建时间';
COMMENT ON COLUMN community_posts.updated_at IS '修改时间';
COMMENT ON COLUMN community_posts.deleted_at IS '软删除时间';

CREATE TABLE community_post_likes (
  post_id text NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(post_id,user_id)
);
COMMENT ON TABLE community_post_likes IS '点赞关系；不等同收藏';
COMMENT ON COLUMN community_post_likes.post_id IS '动态';
COMMENT ON COLUMN community_post_likes.user_id IS '所属用户';
COMMENT ON COLUMN community_post_likes.created_at IS '创建时间';

CREATE TABLE feedback_records (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  type text NOT NULL,
  content text NOT NULL,
  contact text NOT NULL DEFAULT '',
  images text[] NOT NULL DEFAULT '{}',
  target_type text,
  target_id text,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','processing','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE feedback_records IS '反馈及举报共用，避免重复后台';
COMMENT ON COLUMN feedback_records.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN feedback_records.user_id IS '反馈人，可匿名';
COMMENT ON COLUMN feedback_records.type IS '问题类型';
COMMENT ON COLUMN feedback_records.content IS '说明';
COMMENT ON COLUMN feedback_records.contact IS '自愿联系方式';
COMMENT ON COLUMN feedback_records.images IS '附件地址';
COMMENT ON COLUMN feedback_records.target_type IS '举报对象类型，可空';
COMMENT ON COLUMN feedback_records.target_id IS '举报对象 ID，可空';
COMMENT ON COLUMN feedback_records.status IS '处理状态';
COMMENT ON COLUMN feedback_records.created_at IS '创建时间';
COMMENT ON COLUMN feedback_records.updated_at IS '修改时间';
COMMENT ON COLUMN feedback_records.deleted_at IS '软删除时间';

CREATE TABLE ai_import_tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  media_id text REFERENCES media_objects(id) ON DELETE SET NULL,
  state text NOT NULL,
  request_id text NOT NULL,
  task_type text NOT NULL DEFAULT 'purchase_order',
  model_provider text NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL DEFAULT '',
  source_platform text NOT NULL DEFAULT '',
  source_link text NOT NULL DEFAULT '',
  suggestion_json jsonb,
  confidence double precision CHECK(confidence BETWEEN 0 AND 1),
  field_confidence_json jsonb NOT NULL DEFAULT '{}',
  evidence_json jsonb NOT NULL DEFAULT '[]',
  warnings_json jsonb NOT NULL DEFAULT '[]',
  confirmed_json jsonb,
  correction_json jsonb,
  confirmation_op_id text,
  target_id text,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,confirmation_op_id),
  CHECK(confirmation_op_id IS NULL OR length(confirmation_op_id)>0)
);
COMMENT ON TABLE ai_import_tasks IS '合并建议和确认记录；一任务一次识别结果与确认';
COMMENT ON COLUMN ai_import_tasks.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN ai_import_tasks.user_id IS '所属用户';
COMMENT ON COLUMN ai_import_tasks.media_id IS '来源媒体';
COMMENT ON COLUMN ai_import_tasks.state IS '识别状态，服务端状态机校验';
COMMENT ON COLUMN ai_import_tasks.request_id IS '追踪请求 ID';
COMMENT ON COLUMN ai_import_tasks.task_type IS '识别用途';
COMMENT ON COLUMN ai_import_tasks.model_provider IS '服务商';
COMMENT ON COLUMN ai_import_tasks.model_name IS '模型';
COMMENT ON COLUMN ai_import_tasks.model_version IS '模型版本';
COMMENT ON COLUMN ai_import_tasks.source_platform IS '来源平台';
COMMENT ON COLUMN ai_import_tasks.source_link IS '来源链接';
COMMENT ON COLUMN ai_import_tasks.suggestion_json IS '识别建议';
COMMENT ON COLUMN ai_import_tasks.confidence IS '总置信度';
COMMENT ON COLUMN ai_import_tasks.field_confidence_json IS '字段置信度';
COMMENT ON COLUMN ai_import_tasks.evidence_json IS '识别依据';
COMMENT ON COLUMN ai_import_tasks.warnings_json IS '不确定项';
COMMENT ON COLUMN ai_import_tasks.confirmed_json IS '用户确认的最终值';
COMMENT ON COLUMN ai_import_tasks.correction_json IS '用户改动';
COMMENT ON COLUMN ai_import_tasks.confirmation_op_id IS '幂等确认操作 ID；缺失 NULL，禁止空串';
COMMENT ON COLUMN ai_import_tasks.target_id IS '确认关联的购买记录 ID；服务端校验同用户 purchase';
COMMENT ON COLUMN ai_import_tasks.expires_at IS '过期时间';
COMMENT ON COLUMN ai_import_tasks.confirmed_at IS '确认时间';
COMMENT ON COLUMN ai_import_tasks.created_at IS '创建时间';
COMMENT ON COLUMN ai_import_tasks.updated_at IS '修改时间';

CREATE TABLE schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE schema_migrations IS '仅记录新基线及后续实际执行过的迁移';
COMMENT ON COLUMN schema_migrations.filename IS '迁移文件名';
COMMENT ON COLUMN schema_migrations.applied_at IS '执行时间';

CREATE UNIQUE INDEX brands_live_name ON brands(name,category) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_live_source ON products(source_platform,external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX products_live_url ON products(canonical_url) WHERE deleted_at IS NULL;
CREATE INDEX products_feed ON products(category,feed_score DESC,id) WHERE deleted_at IS NULL AND visibility_status='published';
CREATE INDEX products_brand ON products(brand_id,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX products_group ON products(group_key) WHERE deleted_at IS NULL;
CREATE INDEX releases_product ON product_releases(product_id,release_no DESC) WHERE deleted_at IS NULL;
CREATE INDEX favorites_product ON product_favorites(product_id);
CREATE INDEX favorites_user ON product_favorites(user_id,created_at DESC,id);
CREATE INDEX followers_brand ON brand_followers(brand_id);
CREATE INDEX assets_user ON user_assets(user_id,asset_type,updated_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX assets_purchase_reminders ON user_assets(user_id,(payload_json->>'relatedPurchaseId')) WHERE asset_type='reminder' AND deleted_at IS NULL;
CREATE INDEX community_public ON community_posts(created_at DESC,id DESC) WHERE deleted_at IS NULL AND visibility='public';
CREATE INDEX community_author ON community_posts(author_user_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX community_product ON community_posts(product_id,created_at DESC,id DESC) WHERE deleted_at IS NULL AND visibility='public';
CREATE INDEX sessions_user ON user_sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX ai_user ON ai_import_tasks(user_id,created_at DESC);
COMMENT ON COLUMN users.login_provider IS '当前单一登录提供方';
COMMENT ON COLUMN users.login_subject IS '提供方唯一用户标识';
COMMENT ON COLUMN users.preferences_json IS '主题及推荐偏好，不重复存关注关系';
COMMENT ON COLUMN users.budget_json IS '预算配置，金额整数分';
COMMENT ON COLUMN products.group_key IS '同款归组键';
COMMENT ON COLUMN products.images IS '有序图片URL数组，第一张封面，唯一图片来源';
COMMENT ON COLUMN products.variants IS '展示规格对象数组，不推断库存或组合';
COMMENT ON COLUMN products.view_count IS '累计浏览次数，非独立人数';
COMMENT ON COLUMN products.reviewed_by IS '最近审核人';
COMMENT ON COLUMN products.reviewed_at IS '最近审核时间';
COMMENT ON COLUMN product_releases.start_at IS '批次开始时间';
COMMENT ON COLUMN product_releases.end_at IS '批次结束时间';
COMMENT ON COLUMN product_releases.balance_due_at IS '明确尾款截止时间';
COMMENT ON COLUMN product_releases.ship_at IS '明确发货时间，不确定信息写shipping_note';
COMMIT;
