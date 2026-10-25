import type { Task } from './supabase'

const RECENT_DUPLICATE_MS = 15_000

/** The same open title and due date added seconds ago is almost always a double tap or a repeated voice note. */
export function isRecentDuplicate(tasks: Task[], title: string, dueAt: string | null, now = Date.now()) {
  const key = title.toLocaleLowerCase()
  return tasks.some(task => !task.deleted_at && task.status === 'open' && task.title.toLocaleLowerCase() === key
    && (task.due_at ?? null) === dueAt && now - new Date(task.created_at).getTime() < RECENT_DUPLICATE_MS)
}

/** Keep a local row that was edited after the fetched copy, so a slow reload cannot undo a delete or edit. */
export function preferNewer(fetched: Task[], currentById: ReadonlyMap<string, Task>): Task[] {
  return fetched.map(task => {
    const local = currentById.get(task.id)
    return local && Date.parse(local.updated_at) > Date.parse(task.updated_at) ? local : task
  })
}
