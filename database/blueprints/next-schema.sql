-- Sankeng Closet 新基线设计稿，2026-09-15
-- 仅在空的独立数据库执行；现有服务尚未适配此结构。
-- 不包含旧表兼容、数据搬运、DROP SCHEMA 或自动生产迁移。
-- 所有应用表建在 public；Directus 系统表不在本文件管理范围。
BEGIN;
SET LOCAL search_path TO public;

CREATE TABLE users (
  id text PRIMARY KEY,
  nickname text NOT NULL,
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

CREATE TABLE user_identities (
  user_id text NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,provider_subject)
);
COMMENT ON TABLE user_identities IS '登录身份绑定';
COMMENT ON COLUMN user_identities.user_id IS '所属用户';
COMMENT ON COLUMN user_identities.provider IS '登录提供方';
COMMENT ON COLUMN user_identities.provider_subject IS '提供方唯一用户标识';
COMMENT ON COLUMN user_identities.created_at IS '创建时间';

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

CREATE TABLE user_settings (
  user_id text NOT NULL REFERENCES users(id),
  setting_key text NOT NULL CHECK (setting_key IN ('budget','preferences')),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,setting_key)
);
COMMENT ON TABLE user_settings IS '偏好与预算；关注品牌只存 brand_followers';
COMMENT ON COLUMN user_settings.user_id IS '所属用户';
COMMENT ON COLUMN user_settings.setting_key IS '设置类型';
COMMENT ON COLUMN user_settings.payload_json IS '按设置类型校验的 JSON 对象';
COMMENT ON COLUMN user_settings.updated_at IS '修改时间';

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

CREATE TABLE aliases (
  id text PRIMARY KEY,
  term text NOT NULL,
  canonical_term text NOT NULL,
  alias_type text NOT NULL CHECK (alias_type IN ('category','brand','style')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(term,alias_type)
);
COMMENT ON TABLE aliases IS '搜索同义词，不另建分类字典层';
COMMENT ON COLUMN aliases.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN aliases.term IS '用户搜索词';
COMMENT ON COLUMN aliases.canonical_term IS '规范搜索词';
COMMENT ON COLUMN aliases.alias_type IS '别名类型';
COMMENT ON COLUMN aliases.status IS '是否参与搜索';
COMMENT ON COLUMN aliases.created_at IS '创建时间';
COMMENT ON COLUMN aliases.updated_at IS '修改时间';

CREATE TABLE styles (
  id text PRIMARY KEY,
  brand_id text REFERENCES brands(id),
  canonical_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('JK','LOLITA','HANFU','OTHER')),
  sub_category text NOT NULL DEFAULT '',
  style_tags text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
COMMENT ON TABLE styles IS '跨商品链接的同款归组；不是衣橱 style 或 variant.style_name';
COMMENT ON COLUMN styles.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN styles.brand_id IS '品牌，可未知';
COMMENT ON COLUMN styles.canonical_name IS '同款名称';
COMMENT ON COLUMN styles.category IS '坑向';
COMMENT ON COLUMN styles.sub_category IS '分类';
COMMENT ON COLUMN styles.style_tags IS '风格词';
COMMENT ON COLUMN styles.description IS '同款说明';
COMMENT ON COLUMN styles.created_at IS '创建时间';
COMMENT ON COLUMN styles.updated_at IS '修改时间';
COMMENT ON COLUMN styles.deleted_at IS '软删除时间';

CREATE TABLE import_batches (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('excel','json','manual')),
  file_name text NOT NULL DEFAULT '',
  file_hash text NOT NULL DEFAULT '',
  source_object_key text,
  operator_user_id text REFERENCES users(id),
  total_records integer NOT NULL DEFAULT 0 CHECK (total_records>=0),
  success_records integer NOT NULL DEFAULT 0 CHECK (success_records>=0),
  failed_records integer NOT NULL DEFAULT 0 CHECK (failed_records>=0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
  errors_json jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(errors_json)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
COMMENT ON TABLE import_batches IS 'Excel/JSON 导入结果；不保存抓取流水';
COMMENT ON COLUMN import_batches.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN import_batches.source IS '输入方式';
COMMENT ON COLUMN import_batches.file_name IS '原文件名称';
COMMENT ON COLUMN import_batches.file_hash IS '输入文件摘要';
COMMENT ON COLUMN import_batches.source_object_key IS '输入原件存储键，不内嵌大文件';
COMMENT ON COLUMN import_batches.operator_user_id IS '操作人，系统导入可空';
COMMENT ON COLUMN import_batches.total_records IS '总行数';
COMMENT ON COLUMN import_batches.success_records IS '成功行数';
COMMENT ON COLUMN import_batches.failed_records IS '失败行数';
COMMENT ON COLUMN import_batches.status IS '整批事务结果';
COMMENT ON COLUMN import_batches.errors_json IS '行号与错误说明';
COMMENT ON COLUMN import_batches.created_at IS '创建时间';
COMMENT ON COLUMN import_batches.finished_at IS '完成时间';

CREATE TABLE products (
  id text PRIMARY KEY,
  title text NOT NULL CHECK(length(btrim(title))>0),
  brand_id text REFERENCES brands(id),
  shop_name text NOT NULL DEFAULT '',
  category text NOT NULL CHECK(category IN ('JK','LOLITA','HANFU','OTHER')),
  sub_category text NOT NULL DEFAULT '',
  style_id text REFERENCES styles(id),
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
  import_batch_id text REFERENCES import_batches(id),
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
COMMENT ON COLUMN products.style_id IS '同款归组';
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
COMMENT ON COLUMN products.import_batch_id IS '最近一次成功导入批次';
COMMENT ON COLUMN products.version IS '修改版本';
COMMENT ON COLUMN products.created_at IS '创建时间';
COMMENT ON COLUMN products.updated_at IS '修改时间';
COMMENT ON COLUMN products.deleted_at IS '软删除时间';

CREATE TABLE product_images (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL,
  object_key text,
  width integer CHECK(width>0),
  height integer CHECK(height>0),
  sort_order integer NOT NULL CHECK(sort_order>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id,sort_order),
  UNIQUE(product_id,url)
);
COMMENT ON TABLE product_images IS '商品图片唯一数据源；封面取最小 sort_order';
COMMENT ON COLUMN product_images.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN product_images.product_id IS '所属商品';
COMMENT ON COLUMN product_images.url IS '图片地址';
COMMENT ON COLUMN product_images.object_key IS '自有图片对象键，可空';
COMMENT ON COLUMN product_images.width IS '已知宽度';
COMMENT ON COLUMN product_images.height IS '已知高度';
COMMENT ON COLUMN product_images.sort_order IS '顺序，最小值为封面';
COMMENT ON COLUMN product_images.created_at IS '创建时间';

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

CREATE TABLE product_variants (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  style_name text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  price_cents integer CHECK(price_cents>=0),
  stock_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(stock_status IN ('UNKNOWN','IN_STOCK','OUT_OF_STOCK')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id,style_name,color,size)
);
COMMENT ON TABLE product_variants IS '仅展示已确认的款式/颜色/尺码记录，不承担库存交易';
COMMENT ON COLUMN product_variants.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN product_variants.product_id IS '商品';
COMMENT ON COLUMN product_variants.name IS '规格展示名';
COMMENT ON COLUMN product_variants.style_name IS 'JSK/OP 等款式';
COMMENT ON COLUMN product_variants.color IS '颜色';
COMMENT ON COLUMN product_variants.size IS '尺码';
COMMENT ON COLUMN product_variants.price_cents IS '该规格参考全价，未核实 NULL';
COMMENT ON COLUMN product_variants.stock_status IS '仅已核实状态，不默认有货';
COMMENT ON COLUMN product_variants.created_at IS '创建时间';
COMMENT ON COLUMN product_variants.updated_at IS '修改时间';

CREATE TABLE sale_events (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  release_id text,
  event_type text NOT NULL CHECK(event_type IN ('PREVIEW','RESERVATION','DEPOSIT','FINAL_PAYMENT','RELEASE','RESTOCK','PRICE_DROP','SHIP')),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  status text NOT NULL DEFAULT 'UPCOMING' CHECK(status IN ('UPCOMING','ACTIVE','ENDED','CANCELLED')),
  source_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY(release_id,product_id) REFERENCES product_releases(id,product_id),
  CHECK(end_at IS NULL OR end_at>=start_at)
);
COMMENT ON TABLE sale_events IS '日历时间唯一数据源，关联可选发售批次';
COMMENT ON COLUMN sale_events.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN sale_events.product_id IS '商品';
COMMENT ON COLUMN sale_events.release_id IS '所属批次，可空';
COMMENT ON COLUMN sale_events.event_type IS '日历节点；SHIP 为明确发货节点';
COMMENT ON COLUMN sale_events.title IS '展示标题';
COMMENT ON COLUMN sale_events.description IS '节点说明';
COMMENT ON COLUMN sale_events.start_at IS '已确认的开始时间';
COMMENT ON COLUMN sale_events.end_at IS '结束时间';
COMMENT ON COLUMN sale_events.status IS '事件状态';
COMMENT ON COLUMN sale_events.source_url IS '出处';
COMMENT ON COLUMN sale_events.created_at IS '创建时间';
COMMENT ON COLUMN sale_events.updated_at IS '修改时间';
COMMENT ON COLUMN sale_events.deleted_at IS '软删除时间';

CREATE TABLE price_snapshots (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  release_id text,
  price_cents integer NOT NULL CHECK(price_cents>=0),
  price_type text NOT NULL CHECK(price_type IN ('FULL','DEPOSIT','BALANCE','INTENTION')),
  currency text NOT NULL DEFAULT 'CNY',
  source_url text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(release_id,product_id) REFERENCES product_releases(id,product_id)
);
COMMENT ON TABLE price_snapshots IS '同口径历史报价；支撑趋势，不因取消爬虫而删除';
COMMENT ON COLUMN price_snapshots.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN price_snapshots.product_id IS '商品';
COMMENT ON COLUMN price_snapshots.release_id IS '批次，可空';
COMMENT ON COLUMN price_snapshots.price_cents IS '核实金额';
COMMENT ON COLUMN price_snapshots.price_type IS '可比较报价类型';
COMMENT ON COLUMN price_snapshots.currency IS '币种';
COMMENT ON COLUMN price_snapshots.source_url IS '出处';
COMMENT ON COLUMN price_snapshots.recorded_at IS '记录时间';

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

CREATE TABLE user_events (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  event_type text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_events IS '互动统计事件；不用于同步本地浏览历史';
COMMENT ON COLUMN user_events.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN user_events.user_id IS '匿名可空';
COMMENT ON COLUMN user_events.event_type IS '事件类型，接口白名单';
COMMENT ON COLUMN user_events.target_type IS '目标类型，接口白名单';
COMMENT ON COLUMN user_events.target_id IS '目标 ID';
COMMENT ON COLUMN user_events.metadata IS '必要统计属性，不存私密内容';
COMMENT ON COLUMN user_events.created_at IS '创建时间';

CREATE TABLE sync_operations (
  user_id text NOT NULL REFERENCES users(id),
  op_id text NOT NULL,
  device_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  result text NOT NULL CHECK(result IN ('accepted','rejected','conflict')),
  server_version bigint NOT NULL,
  client_created_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,op_id)
);
COMMENT ON TABLE sync_operations IS '幂等回执；成功须代表业务写入已提交';
COMMENT ON COLUMN sync_operations.user_id IS '所属用户';
COMMENT ON COLUMN sync_operations.op_id IS '客户端操作 ID';
COMMENT ON COLUMN sync_operations.device_id IS '设备 ID';
COMMENT ON COLUMN sync_operations.entity_type IS '业务类型';
COMMENT ON COLUMN sync_operations.entity_id IS '业务 ID';
COMMENT ON COLUMN sync_operations.action IS '动作';
COMMENT ON COLUMN sync_operations.payload_json IS '业务对象，不再二次编码 JSON 字符串';
COMMENT ON COLUMN sync_operations.result IS '执行结果';
COMMENT ON COLUMN sync_operations.server_version IS '业务提交后的版本';
COMMENT ON COLUMN sync_operations.client_created_at IS '客户端时间';
COMMENT ON COLUMN sync_operations.accepted_at IS '服务端处理时间';

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

CREATE TABLE review_records (
  id text PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  field_changes jsonb NOT NULL DEFAULT '{}',
  reviewer_id text REFERENCES users(id),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE review_records IS '发布审计仍有实际后台接口';
COMMENT ON COLUMN review_records.id IS '业务 ID，由服务端生成；允许前端提交幂等 ID';
COMMENT ON COLUMN review_records.entity_type IS '对象类型';
COMMENT ON COLUMN review_records.entity_id IS '对象 ID';
COMMENT ON COLUMN review_records.action IS '审核动作';
COMMENT ON COLUMN review_records.field_changes IS '修改前后差异';
COMMENT ON COLUMN review_records.reviewer_id IS '审核人';
COMMENT ON COLUMN review_records.reason IS '原因';
COMMENT ON COLUMN review_records.created_at IS '创建时间';

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
CREATE INDEX products_style ON products(style_id) WHERE deleted_at IS NULL;
CREATE INDEX releases_product ON product_releases(product_id,release_no DESC) WHERE deleted_at IS NULL;
CREATE INDEX events_calendar ON sale_events(start_at,id) WHERE deleted_at IS NULL AND status<>'CANCELLED';
CREATE INDEX events_release ON sale_events(release_id,event_type,start_at) WHERE deleted_at IS NULL;
CREATE INDEX prices_history ON price_snapshots(product_id,price_type,currency,release_id,recorded_at DESC);
CREATE INDEX favorites_product ON product_favorites(product_id);
CREATE INDEX favorites_user ON product_favorites(user_id,created_at DESC,id);
CREATE INDEX followers_brand ON brand_followers(brand_id);
CREATE INDEX assets_user ON user_assets(user_id,asset_type,updated_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX assets_purchase_reminders ON user_assets(user_id,(payload_json->>'relatedPurchaseId')) WHERE asset_type='reminder' AND deleted_at IS NULL;
CREATE INDEX community_public ON community_posts(created_at DESC,id DESC) WHERE deleted_at IS NULL AND visibility='public';
CREATE INDEX community_author ON community_posts(author_user_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX community_product ON community_posts(product_id,created_at DESC,id DESC) WHERE deleted_at IS NULL AND visibility='public';
CREATE INDEX event_counts ON user_events(target_type,target_id,event_type,created_at);
CREATE INDEX sessions_user ON user_sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX ai_user ON ai_import_tasks(user_id,created_at DESC);
CREATE INDEX sync_user_time ON sync_operations(user_id,accepted_at,op_id);
CREATE INDEX review_entity ON review_records(entity_type,entity_id,created_at DESC);
COMMIT;
