create table if not exists users (
  id text primary key,
  nickname text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_identities (
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  created_at timestamptz not null default now(),
  primary key (provider, provider_subject)
);

create table if not exists products (
  id text primary key,
  brand_id text not null,
  brand_name text not null,
  title text not null,
  category text not null check (category in ('JK', 'LOLITA', 'HANFU', 'OTHER')),
  status text not null,
  cover_url text not null default '',
  price_cents integer not null default 0 check (price_cents >= 0),
  original_price_cents integer not null default 0 check (original_price_cents >= 0),
  description text not null default '',
  shop_url text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists products_category_created_idx on products(category, created_at desc);

create table if not exists product_images (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  object_key text not null,
  sort_order integer not null,
  unique(product_id, sort_order)
);

create table if not exists release_events (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  event_type text not null,
  start_at timestamptz,
  end_at timestamptz,
  status text not null,
  source_id text,
  created_at timestamptz not null default now()
);
create index if not exists release_events_product_start_idx on release_events(product_id, start_at);

create table if not exists sync_operations (
  user_id text not null references users(id) on delete cascade,
  op_id text not null,
  device_id text not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  payload_json jsonb not null default '{}'::jsonb,
  result text not null check (result in ('accepted', 'rejected', 'conflict')),
  server_version bigint not null,
  client_created_at timestamptz not null,
  accepted_at timestamptz not null default now(),
  primary key(user_id, op_id)
);

create table if not exists media_objects (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  object_key text not null unique,
  upload_id text not null unique,
  purpose text not null,
  content_type text not null,
  size_bytes integer not null default 0,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  retention_until timestamptz,
  deleted_at timestamptz
);

create table if not exists ai_import_tasks (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  object_key text not null references media_objects(object_key),
  state text not null,
  request_id text not null,
  model_provider text not null,
  model_name text not null,
  model_version text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  target_type text,
  target_id text
);
create index if not exists ai_import_tasks_user_state_idx on ai_import_tasks(user_id, state);

create table if not exists ai_import_suggestions (
  task_id text primary key references ai_import_tasks(id) on delete cascade,
  suggestion_json jsonb not null,
  confidence double precision not null,
  field_confidence_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '[]'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb
);

create table if not exists wardrobe_items (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  category text not null,
  title text not null,
  payload_json jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists wardrobe_items_user_category_idx on wardrobe_items(user_id, category);

create table if not exists wishlist_items (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  title text not null,
  status text not null,
  payload_json jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists wishlist_items_user_status_idx on wishlist_items(user_id, status);

create table if not exists ai_import_confirmations (
  id text primary key,
  task_id text not null references ai_import_tasks(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('wardrobe', 'wishlist')),
  target_id text not null,
  confirmed_json jsonb not null,
  correction_json jsonb not null,
  op_id text not null,
  created_at timestamptz not null default now(),
  unique(user_id, op_id)
);
