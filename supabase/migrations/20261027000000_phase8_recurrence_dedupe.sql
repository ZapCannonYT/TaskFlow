-- Repeats: the next occurrence inherits its parent's details, so it belongs on its scheduled day, not in Inbox.
-- Also allow only one open occurrence per parent so completing on two devices cannot create duplicates.

-- 1. Keep the oldest open occurrence of each parent and soft-delete any extra copies.
with ranked as (
  select id, row_number() over (partition by recurrence_parent_id order by created_at, id) as copy
  from public.tasks
  where recurrence_parent_id is not null and status = 'open' and deleted_at is null
)
update public.tasks t
set deleted_at = now(), updated_at = now()
from ranked
where t.id = ranked.id and ranked.copy > 1;

-- 2. Move open repeat occurrences that were sent to Inbox onto their scheduled day.
update public.tasks
set is_inbox = false, details_prompted_at = coalesce(details_prompted_at, now()), updated_at = now()
where recurrence_parent_id is not null and status = 'open' and deleted_at is null and is_inbox;

-- 3. Their Inbox "add details" prompts no longer apply.
update public.task_reminders r
set status = 'cancelled'
from public.tasks t
where r.task_id = t.id and r.kind = 'details_prompt' and r.status in ('pending', 'failed', 'processing')
  and t.recurrence_parent_id is not null and not t.is_inbox;

-- 4. One open occurrence per parent from now on.
create unique index if not exists tasks_one_open_occurrence_per_parent
  on public.tasks (recurrence_parent_id)
  where recurrence_parent_id is not null and status = 'open' and deleted_at is null;
