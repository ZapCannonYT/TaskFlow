-- Let a reminder fire any number of minutes before the due time.
alter table public.tasks add column if not exists reminder_minutes integer
  check (reminder_minutes is null or reminder_minutes between 1 and 40320);
alter table public.tasks drop constraint if exists tasks_reminder_offset_check;
alter table public.tasks add constraint tasks_reminder_offset_check
  check (reminder_offset in ('none', 'at_time', '1_hour_before', '1_day_before', '2_days_before', 'custom'));
alter table public.tasks drop constraint if exists tasks_custom_reminder_minutes_check;
alter table public.tasks add constraint tasks_custom_reminder_minutes_check
  check (reminder_offset <> 'custom' or reminder_minutes is not null);

create or replace function public.sync_task_reminder()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  prefs public.user_preferences%rowtype;
  local_day date;
  reminder_time timestamp;
  schedule_at timestamptz;
  day_offset integer := 0;
  hour_offset integer := 0;
  minute_offset integer := 0;
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
       or old.reminder_minutes is distinct from new.reminder_minutes
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
  if new.reminder_offset = 'custom' then minute_offset := coalesce(new.reminder_minutes, 0); end if;

  if new.is_all_day then
    local_day := (new.due_at at time zone task_timezone)::date;
    reminder_time := local_day + coalesce(prefs.daily_nudge_time, time '18:30');
    schedule_at := (reminder_time - make_interval(days => day_offset, hours => hour_offset, mins => minute_offset)) at time zone task_timezone;
  else
    schedule_at := new.due_at - make_interval(days => day_offset, hours => hour_offset, mins => minute_offset);
  end if;

  if schedule_at <= now() then return new; end if;
  insert into public.task_reminders(user_id, task_id, kind, scheduled_at, dedupe_key, payload)
  values (
    new.user_id, new.id, case when new.reminder_offset = 'at_time' then 'due' else 'advance' end, schedule_at,
    'task:' || new.id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('task_id', new.id, 'reminder_offset', new.reminder_offset, 'reminder_minutes', new.reminder_minutes)
  ) on conflict (dedupe_key) do nothing;
  return new;
end;
$$;
