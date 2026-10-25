-- Keep Inbox placement explicit until review is finished and support a one-hour reminder.
alter table public.tasks alter column reminder_offset set default '1_hour_before';
alter table public.tasks drop constraint if exists tasks_reminder_offset_check;
alter table public.tasks add constraint tasks_reminder_offset_check
  check (reminder_offset in ('none', 'at_time', '1_hour_before', '1_day_before', '2_days_before'));

create or replace function public.sync_task_reminder()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  prefs public.user_preferences%rowtype;
  local_day date;
  reminder_time timestamp;
  schedule_at timestamptz;
  day_offset integer := 0;
  hour_offset integer := 0;
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
      update public.task_reminders set status = 'cancelled'
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
  if new.reminder_offset = '1_hour_before' then hour_offset := 1; end if;
  if new.reminder_offset = '1_day_before' then day_offset := 1; end if;
  if new.reminder_offset = '2_days_before' then day_offset := 2; end if;

  if new.is_all_day then
    local_day := (new.due_at at time zone task_timezone)::date;
    reminder_time := local_day + coalesce(prefs.daily_nudge_time, time '18:30');
    schedule_at := (reminder_time - make_interval(days => day_offset, hours => hour_offset)) at time zone task_timezone;
  else
    schedule_at := new.due_at - make_interval(days => day_offset, hours => hour_offset);
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

create or replace function public.sync_task_inbox()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.is_inbox := coalesce(new.is_inbox, false)
    and new.status = 'open' and new.deleted_at is null and new.details_prompted_at is null;
  return new;
end;
$$;

create or replace function public.sync_details_prompt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  optional_count integer;
  relevant_change boolean;
begin
  optional_count := (case when new.due_at is not null and not new.due_is_approx then 1 else 0 end)
    + (case when new.size is not null then 1 else 0 end)
    + (case when new.is_important then 1 else 0 end)
    + (case when new.label_id is not null then 1 else 0 end)
    + (case when new.recurrence_rule is not null then 1 else 0 end)
    + (case when char_length(btrim(coalesce(new.description, ''))) > 0 then 1 else 0 end)
    + (case when new.due_at is not null and not new.due_is_approx and new.reminder_offset <> 'none' then 1 else 0 end);

  if new.status <> 'open' or new.deleted_at is not null or optional_count >= 4 then
    update public.task_reminders set status = 'cancelled'
      where task_id = new.id and kind = 'details_prompt' and status in ('pending', 'failed', 'processing');
    return new;
  end if;
  if new.details_prompted_at is not null then
    update public.task_reminders set status = 'cancelled'
      where task_id = new.id and kind = 'details_prompt' and status in ('pending', 'failed', 'processing');
    return new;
  end if;

  if tg_op = 'INSERT' then
    relevant_change := true;
  else
    relevant_change := old.status is distinct from new.status or old.deleted_at is distinct from new.deleted_at
      or old.due_at is distinct from new.due_at or old.due_is_approx is distinct from new.due_is_approx
      or old.size is distinct from new.size or old.is_important is distinct from new.is_important
      or old.label_id is distinct from new.label_id or old.recurrence_rule is distinct from new.recurrence_rule
      or old.description is distinct from new.description or old.reminder_offset is distinct from new.reminder_offset
      or old.details_prompted_at is distinct from new.details_prompted_at
      or old.is_inbox is distinct from new.is_inbox;
  end if;
  if relevant_change and not exists (
    select 1 from public.task_reminders where task_id = new.id and kind = 'details_prompt'
      and status in ('pending', 'failed', 'processing')
  ) then
    insert into public.task_reminders(user_id, task_id, kind, scheduled_at, dedupe_key, payload)
    values (new.user_id, new.id, 'details_prompt', now() + interval '1 hour',
      'details:' || new.id::text || ':' || gen_random_uuid()::text,
      jsonb_build_object('task_id', new.id, 'title', 'Add details to this task', 'body', new.title));
  end if;
  return new;
end;
$$;
