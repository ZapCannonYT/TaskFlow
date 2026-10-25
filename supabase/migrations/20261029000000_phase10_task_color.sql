-- Optional colour per task, shown on its row, schedule block and Today card.
alter table public.tasks add column if not exists color text
  check (color is null or color in ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'));
