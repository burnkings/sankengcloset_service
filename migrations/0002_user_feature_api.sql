-- V2.5: 为现有 UniApp X 页面提供真正可恢复的用户数据与圈子内容资源。
-- 个人资产用 JSONB 保存页面字段，避免把 Android 客户端的 UI 字段丢在同步回执里。

create table if not exists user_assets (
  user_id text not null references users(id) on delete cascade,
  asset_type text not null check (asset_type in ('wardrobe', 'purchase', 'reminder', 'wish', 'notification')),
  id text not null,
  payload_json jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, asset_type, id)
);
create index if not exists user_assets_active_idx
  on user_assets(user_id, asset_type, updated_at desc)
  where deleted_at is null;

create table if not exists user_settings (
  user_id text not null references users(id) on delete cascade,
  setting_key text not null check (setting_key in ('budget', 'preferences')),
  payload_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, setting_key)
);

create table if not exists community_posts (
  id text primary key,
  author_user_id text not null references users(id) on delete cascade,
  media_id text not null references media_objects(id) on delete restrict,
  image_url text not null,
  caption text not null default '',
  category text not null check (category in ('JK', 'LOLITA', 'HANFU', 'MIXED')),
  topic text not null,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists community_posts_public_idx
  on community_posts(category, topic, created_at desc)
  where deleted_at is null and visibility = 'public';
create index if not exists community_posts_author_idx
  on community_posts(author_user_id, created_at desc)
  where deleted_at is null;

create table if not exists community_post_likes (
  post_id text not null references community_posts(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists community_post_likes_user_idx
  on community_post_likes(user_id, created_at desc);
