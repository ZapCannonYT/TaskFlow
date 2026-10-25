-- Phase 6 follow-up: task descriptions, Inbox review state, and a broader audit.
alter table public.tasks
  add column description text not null default '' check (char_length(description) <= 5000),
  add column is_inbox boolean not null default false;

create or replace function public.sync_task_inbox()
returns trigger language plpgsql set search_path = '' as $$
declare
  optional_count integer;
begin
  optional_count := (case when new.due_at is not null and not new.due_is_approx then 1 else 0 end)
    + (case when new.size is not null then 1 else 0 end)
    + (case when new.is_important then 1 else 0 end)
    + (case when new.label_id is not null then 1 else 0 end)
    + (case when new.recurrence_rule is not null then 1 else 0 end)
    + (case when char_length(btrim(coalesce(new.description, ''))) > 0 then 1 else 0 end)
    + (case when new.reminder_offset <> 'none' then 1 else 0 end);
  new.is_inbox := new.status = 'open' and new.deleted_at is null
    and new.details_prompted_at is null and optional_count < 5;
  return new;
end;
$$;
revoke all on function public.sync_task_inbox() from public, anon, authenticated;
drop trigger if exists tasks_sync_inbox on public.tasks;
create trigger tasks_sync_inbox before insert or update on public.tasks
  for each row execute function public.sync_task_inbox();

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
    + (case when new.reminder_offset <> 'none' then 1 else 0 end);

  if new.status <> 'open' or new.deleted_at is not null or optional_count >= 5 then
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
revoke all on function public.sync_details_prompt() from public, anon, authenticated;

grant select (description, is_inbox), insert (description, is_inbox), update (description, is_inbox) on public.tasks to authenticated;

-- Recompute Inbox state and queue the broadened audit for existing open tasks.
update public.tasks set is_inbox = false;
