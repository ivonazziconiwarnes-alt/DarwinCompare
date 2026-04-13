create extension if not exists pgcrypto;

create table if not exists public.comparisons (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nueva comparacion',
  category text not null default 'General',
  my_name text not null default 'Mi publicacion',
  my_url text not null default '',
  my_manual jsonb null,
  last_result jsonb null,
  sync_status text not null default 'pending',
  last_synced_at timestamptz null,
  sync_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.comparisons add column if not exists my_manual jsonb null;
alter table public.comparisons add column if not exists last_result jsonb null;
alter table public.comparisons add column if not exists sync_status text not null default 'pending';
alter table public.comparisons add column if not exists last_synced_at timestamptz null;
alter table public.comparisons add column if not exists sync_error text null;

create table if not exists public.comparison_competitors (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  name text not null,
  url text not null,
  position integer not null default 0,
  manual_override jsonb null,
  created_at timestamptz not null default now()
);

alter table public.comparison_competitors add column if not exists manual_override jsonb null;

create index if not exists comparison_competitors_comparison_id_idx
  on public.comparison_competitors (comparison_id, position);

create table if not exists public.comparison_runs (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  status text not null default 'pending',
  trigger_source text not null default 'web',
  requested_by text null,
  requested_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  worker_id text null,
  error text null,
  result_summary jsonb null,
  comparison_snapshot jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists comparison_runs_comparison_id_idx
  on public.comparison_runs (comparison_id, requested_at desc);

create index if not exists comparison_runs_status_idx
  on public.comparison_runs (status, requested_at asc);

create table if not exists public.comparison_run_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.comparison_runs(id) on delete cascade,
  position integer not null default 0,
  role text not null,
  name text not null,
  url text not null default '',
  item_id text null,
  title text null,
  price numeric null,
  currency text null,
  image_url text null,
  source text not null default 'worker',
  source_kind text null,
  error text null,
  diff numeric null,
  pct numeric null,
  created_at timestamptz not null default now()
);

create index if not exists comparison_run_rows_run_id_idx
  on public.comparison_run_rows (run_id, position);
