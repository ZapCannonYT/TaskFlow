-- Replace one "add details" push per task with a single Inbox digest per user per day.
-- Each new Inbox capture pushes the digest back to an hour later, so it arrives after you stop adding.

-- 1. Stop the old per-task prompts that are still queued.
update public.task_reminders
set status = 'cancelled', locked_at = null
where kind = 'details_prompt' and task_id is not null and status in ('pending', 'failed', 'processing');

create or replace function public.sync_details_prompt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  user_timezone text;
  local_day text;
begin
  -- Only a task that newly lands in Inbox (captured, or moved back) schedules the digest.
  if new.status <> 'open' or new.deleted_at is not null or not coalesce(new.is_inbox, false) or new.details_prompted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.is_inbox, false) then
    return new;
  end if;

  select timezone into user_timezone from public.user_preferences where user_id = new.user_id;
  user_timezone := coalesce(user_timezone, new.timezone, 'UTC');
  begin
    perform now() at time zone user_timezone;
  exception when invalid_parameter_value then
    user_timezone := 'UTC';
  end;
  local_day := to_char(now() at time zone user_timezone, 'YYYY-MM-DD');

  insert into public.task_reminders(user_id, task_id, kind, scheduled_at, dedupe_key, payload)
  values (new.user_id, null, 'details_prompt', now() + interval '1 hour',
    'inbox-digest:' || new.user_id::text || ':' || local_day,
    jsonb_build_object('digest', true, 'local_day', local_day))
  on conflict (dedupe_key) do update set scheduled_at = excluded.scheduled_at, next_attempt_at = now()
    where public.task_reminders.status = 'pending';
  return new;
end;
$$;
