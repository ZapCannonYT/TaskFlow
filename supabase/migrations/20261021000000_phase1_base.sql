-- Phase 1: per-user labels and tasks with soft delete, exact/approximate dates,
-- one size, one important flag, and at most one label.
create extension if not exists pgcrypto;

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 32),
  created_at timestamptz not null default now(),
  unique (user_id, name),
  unique (user_id, id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'completed')),
  due_at timestamptz,
  due_is_approx boolean not null default false,
  is_all_day boolean not null default true,
  timezone text not null default 'Asia/Kolkata',
  size text check (size is null or size in ('quick', 'hour', 'big')),
  is_important boolean not null default false,
  label_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  constraint tasks_label_owner_fk foreign key (user_id, label_id)
    references public.labels(user_id, id) on delete set null (label_id)
);

create index tasks_user_open_idx on public.tasks(user_id, due_at, created_at desc)
  where status = 'open' and deleted_at is null;
create index tasks_user_done_idx on public.tasks(user_id, completed_at desc)
  where status = 'completed' and deleted_at is null;
create index tasks_user_deleted_idx on public.tasks(user_id, deleted_at desc)
  where deleted_at is not null;

alter table public.labels enable row level security;
alter table public.tasks enable row level security;

create policy "Users manage their labels" on public.labels
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users manage their tasks" on public.tasks
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.labels, public.tasks from anon;
grant select, insert, update, delete on public.labels, public.tasks to authenticated;

-- Publish tasks and labels for live cross-device updates.
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.labels;
