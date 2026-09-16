-- 补齐当前 D8 路由在旧 0001 数据库上的依赖。所有变更均可重复执行。

alter table wishlist_items add column if not exists product_id text;
alter table wishlist_items add column if not exists release_id text;
alter table wishlist_items add column if not exists note text not null default '';
alter table wishlist_items add column if not exists updated_at timestamptz not null default now();

create index if not exists wishlist_items_user_product_idx
  on wishlist_items(user_id, product_id)
  where product_id is not null;

create table if not exists user_events (
  id text primary key,
  user_id text references users(id) on delete set null,
  event_type text not null,
  target_type text not null,
  target_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists user_events_user_type_created_idx
  on user_events(user_id, event_type, created_at desc);

create table if not exists brand_followers (
  user_id text not null references users(id) on delete cascade,
  brand_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);
