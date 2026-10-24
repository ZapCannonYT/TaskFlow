-- Local Whisper stays entirely in the browser. This migration adds the one-hour
-- details prompt queue entry for basic tasks; the existing dispatcher sends it.
alter table public.tasks add column if not exists details_prompted_at timestamptz;
alter table public.task_reminders drop constraint if exists task_reminders_kind_check;
alter table public.task_reminders add constraint task_reminders_kind_check
  check (kind in ('advance', 'due', 'daily', 'daily_repeat', 'weekly', 'details_prompt'));

create or replace function public.sync_details_prompt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  optional_count integer;
begin
  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status or old.deleted_at is distinct from new.deleted_at
       or old.due_at is distinct from new.due_at or old.due_is_approx is distinct from new.due_is_approx
       or old.size is distinct from new.size or old.is_important is distinct from new.is_important
       or old.label_id is distinct from new.label_id or new.details_prompted_at is distinct from old.details_prompted_at then
      optional_count := (case when new.due_at is not null and not new.due_is_approx then 1 else 0 end)
        + (case when new.size is not null then 1 else 0 end)
        + (case when new.is_important then 1 else 0 end)
        + (case when new.label_id is not null then 1 else 0 end);
      if new.status <> 'open' or new.deleted_at is not null or optional_count >= 3 then
        update public.task_reminders set status = 'cancelled'
          where task_id = new.id and kind = 'details_prompt' and status in ('pending', 'failed', 'processing');
        return new;
      end if;
      if new.details_prompted_at is distinct from old.details_prompted_at then
        update public.task_reminders set status = 'cancelled'
          where task_id = new.id and kind = 'details_prompt' and status in ('pending', 'failed', 'processing');
        return new;
      end if;
      return new;
    else
      return new;
    end if;
  end if;
  if new.status <> 'open' or new.deleted_at is not null or new.details_prompted_at is not null then return new; end if;
  optional_count := (case when new.due_at is not null and not new.due_is_approx then 1 else 0 end)
    + (case when new.size is not null then 1 else 0 end)
    + (case when new.is_important then 1 else 0 end)
    + (case when new.label_id is not null then 1 else 0 end);
  if optional_count <= 2 then
    insert into public.task_reminders(user_id, task_id, kind, scheduled_at, dedupe_key, payload)
    values (new.user_id, new.id, 'details_prompt', now() + interval '1 hour',
      'details:' || new.id::text || ':' || gen_random_uuid()::text,
      jsonb_build_object('task_id', new.id, 'title', 'Add details to this task', 'body', new.title))
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_details_prompt() from public, anon, authenticated;
create trigger tasks_sync_details_prompt after insert or update on public.tasks
  for each row execute function public.sync_details_prompt();
