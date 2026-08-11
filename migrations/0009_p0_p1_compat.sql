-- P0/P1 兼容迁移（2026-08-11）
-- 目标：补齐 统一 API 约定 所需的核心表与约束，全部 IF NOT EXISTS / 可重复执行。

-- 1) 用户会话（refresh token 轮换 + 撤销），对应 sessions/refresh_tokens
create table if not exists user_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  refresh_token_hash text not null,
  device_id text not null default '',
  platform text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists user_sessions_user_idx on user_sessions(user_id, created_at desc);
create index if not exists user_sessions_hash_idx on user_sessions(refresh_token_hash);

-- 2) 用户头像（GET /api/v1/me 返回 avatarUrl）
alter table users add column if not exists avatar_url text not null default '';

-- 3) 收藏幂等：同一用户 + 同一商品唯一；重复 POST 返回既有条目
create unique index if not exists wishlist_items_user_product_uniq
  on wishlist_items(user_id, product_id)
  where product_id is not null;

-- 4) AI 导入任务：支持 mediaId 契约 + 订单截图来源信息
alter table ai_import_tasks add column if not exists media_id text references media_objects(id) on delete set null;
alter table ai_import_tasks add column if not exists task_type text not null default 'purchase_order';
alter table ai_import_tasks add column if not exists source_platform text not null default '';
alter table ai_import_tasks add column if not exists source_link text not null default '';

-- 5) AI 确认记录：target 支持 purchase（仅审计，不建单），每任务只确认一次
alter table ai_import_confirmations drop constraint if exists ai_import_confirmations_target_type_check;
alter table ai_import_confirmations add constraint ai_import_confirmations_target_type_check
  check (target_type in ('wardrobe', 'wishlist', 'purchase'));
create unique index if not exists ai_import_confirmations_task_uniq on ai_import_confirmations(task_id);
