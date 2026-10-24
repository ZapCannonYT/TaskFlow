-- Phase 5: recurring task rules and a link to the next occurrence.
alter table public.tasks
  add column recurrence_rule text check (recurrence_rule is null or recurrence_rule in ('daily', 'weekdays', 'weekly', 'monthly')),
  add column recurrence_parent_id uuid references public.tasks(id) on delete set null,
  add column recurrence_day integer check (recurrence_day is null or recurrence_day between 1 and 31);

create unique index tasks_one_recurrence_child_idx
  on public.tasks(recurrence_parent_id)
  where recurrence_parent_id is not null and deleted_at is null;
