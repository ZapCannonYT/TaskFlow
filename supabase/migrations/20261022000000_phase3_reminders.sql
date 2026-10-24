-- Phase 3: explicit due reminders and the daily companion.
-- Secrets stay in Supabase Vault / Edge Function secrets, never in browser env.

alter table public.tasks
  add column reminder_offset text not null default 'none'
    check (reminder_offset in ('none', 'at_time', '1_day_before', '2_days_before'));

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  daily_nudge_enabled boolean not null default false,
  daily_nudge_time time not null default '18:30',
  quiet_hours_start time not null default '22:30',
  quiet_hours_end time not null default '08:00',
  weekly_summary_enabled boolean not null default true,
  weekly_summary_day smallint not null default 0 check (weekly_summary_day between 0 and 6),
  prompt_dismissals smallint not null default 0 check (prompt_dismissals between 0 and 2),
  prompt_reoffer_at timestamptz,
  skipped_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_user_preferences()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_user_preferences() from public, anon, authenticated;
create trigger user_preferences_touch_updated_at
  before update on public.user_preferences for each row execute function public.touch_user_preferences();

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  disabled_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint push_endpoint_length check (char_length(endpoint) between 16 and 2048),
  constraint push_keys_length check (char_length(p256dh) between 16 and 256 and char_length(auth) between 8 and 256),
  unique (user_id, id)
);
create index push_subscriptions_active_user_idx on public.push_subscriptions(user_id)
  where disabled_at is null;

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('advance', 'due', 'daily', 'daily_repeat', 'weekly')),
  scheduled_at timestamptz not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  action_at timestamptz,
  action text check (action is null or action in ('open', 'done', 'later', 'skip')),
  delivered_via text,
  last_error text,
  created_at timestamptz not null default now()
);
create index task_reminders_due_idx on public.task_reminders(scheduled_at, next_attempt_at)
  where status in ('pending', 'failed');
create index task_reminders_user_day_idx on public.task_reminders(user_id, scheduled_at desc);
create unique index task_reminders_daily_budget_idx
  on public.task_reminders(user_id, ((payload->>'local_day')), kind)
  where kind in ('daily', 'daily_repeat', 'weekly');

alter table public.user_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.task_reminders enable row level security;

create policy "Users read their preferences" on public.user_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their preferences" on public.user_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their preferences" on public.user_preferences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their push subscriptions" on public.push_subscriptions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read their reminders" on public.task_reminders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users record their reminder actions" on public.task_reminders
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_preferences, public.push_subscriptions, public.task_reminders from anon;
revoke all on public.task_reminders from authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.task_reminders to authenticated;
grant update (action_at, action) on public.task_reminders to authenticated;
grant all on public.user_preferences, public.push_subscriptions, public.task_reminders to service_role;

create or replace function public.create_taskflow_preferences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_preferences(user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_taskflow_preferences() from public, anon, authenticated;
create trigger taskflow_user_preferences_after_signup
  after insert on auth.users for each row execute function public.create_taskflow_preferences();

insert into public.user_preferences(user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Keep explicit reminders in sync with task dates and completion state.
create or replace function public.sync_task_reminder()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  prefs public.user_preferences%rowtype;
  local_day date;
  reminder_time timestamp;
  schedule_at timestamptz;
  day_offset integer := 0;
  task_timezone text;
begin
  task_timezone := new.timezone;
  begin
    perform now() at time zone task_timezone;
  exception when invalid_parameter_value then
    task_timezone := 'UTC';
  end;
  if tg_op = 'UPDATE' then
    if old.due_at is distinct from new.due_at
       or old.due_is_approx is distinct from new.due_is_approx
       or old.is_all_day is distinct from new.is_all_day
       or old.timezone is distinct from new.timezone
       or old.reminder_offset is distinct from new.reminder_offset
       or old.status is distinct from new.status
       or old.deleted_at is distinct from new.deleted_at then
      update public.task_reminders
      set status = 'cancelled'
      where task_id = new.id and kind in ('advance', 'due') and status in ('pending', 'failed', 'processing');
    else
      return new;
    end if;
  end if;

  if new.status <> 'open' or new.deleted_at is not null or new.due_at is null
     or new.due_is_approx or new.reminder_offset = 'none' then
    return new;
  end if;

  select * into prefs from public.user_preferences where user_id = new.user_id;
  if new.reminder_offset = '1_day_before' then day_offset := 1; end if;
  if new.reminder_offset = '2_days_before' then day_offset := 2; end if;

  if new.is_all_day then
    local_day := (new.due_at at time zone task_timezone)::date;
    reminder_time := local_day + coalesce(prefs.daily_nudge_time, time '18:30');
    schedule_at := (reminder_time - make_interval(days => day_offset)) at time zone task_timezone;
  else
    schedule_at := new.due_at - make_interval(days => day_offset);
  end if;

  if schedule_at <= now() then return new; end if;
  insert into public.task_reminders(user_id, task_id, kind, scheduled_at, dedupe_key, payload)
  values (
    new.user_id, new.id, case when new.reminder_offset = 'at_time' then 'due' else 'advance' end, schedule_at,
    'task:' || new.id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('task_id', new.id, 'reminder_offset', new.reminder_offset)
  ) on conflict (dedupe_key) do nothing;
  return new;
end;
$$;
revoke all on function public.sync_task_reminder() from public, anon, authenticated;
create trigger tasks_sync_explicit_reminder
  after insert or update on public.tasks for each row execute function public.sync_task_reminder();

create or replace function public.refresh_all_day_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  task_row record;
begin
  if old.daily_nudge_time is not distinct from new.daily_nudge_time then return new; end if;
  for task_row in
    select id, reminder_offset from public.tasks
    where user_id = new.user_id and is_all_day and status = 'open'
      and deleted_at is null and reminder_offset <> 'none'
  loop
    update public.tasks set reminder_offset = 'none' where id = task_row.id;
    update public.tasks set reminder_offset = task_row.reminder_offset where id = task_row.id;
  end loop;
  return new;
end;
$$;
revoke all on function public.refresh_all_day_reminders() from public, anon, authenticated;
create trigger preferences_refresh_all_day_reminders
  after update on public.user_preferences for each row execute function public.refresh_all_day_reminders();

-- Atomic queue claim. Only the Edge Function's service-role client can execute it.
create or replace function public.claim_taskflow_reminders(batch_size integer default 50)
returns setof public.task_reminders
language sql security definer set search_path = '' as $$
  with candidates as (
    select id from public.task_reminders
    where ((status in ('pending', 'failed') and next_attempt_at <= now())
       or (status = 'processing' and locked_at < now() - interval '5 minutes'))
      and attempt_count < 4
      and scheduled_at <= now()
    order by scheduled_at, created_at
    for update skip locked
    limit greatest(1, least(batch_size, 100))
  )
  update public.task_reminders as reminder
  set status = 'processing', locked_at = now(), attempt_count = attempt_count + 1
  from candidates
  where reminder.id = candidates.id
  returning reminder.*;
$$;
revoke all on function public.claim_taskflow_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_taskflow_reminders(integer) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;
