import type { Task } from './supabase'

const RECENT_DUPLICATE_MS = 15_000

/** The same open title and due date added seconds ago is almost always a double tap or a repeated voice note. */
export function isRecentDuplicate(tasks: Task[], title: string, dueAt: string | null, now = Date.now()) {
  const key = title.toLocaleLowerCase()
  return tasks.some(task => !task.deleted_at && task.status === 'open' && task.title.toLocaleLowerCase() === key
    && (task.due_at ?? null) === dueAt && now - new Date(task.created_at).getTime() < RECENT_DUPLICATE_MS)
}

/**
 * Keep a local row that was edited after the fetched copy, so a slow reload cannot undo a delete or edit.
 * An unchanged row keeps its local object, so memoized rows do not re-render after every sync.
 */
export function preferNewer(fetched: Task[], currentById: ReadonlyMap<string, Task>): Task[] {
  return fetched.map(task => {
    const local = currentById.get(task.id)
    if (!local) return task
    const localTime = Date.parse(local.updated_at), fetchedTime = Date.parse(task.updated_at)
    if (localTime > fetchedTime) return local
    return localTime === fetchedTime && JSON.stringify(local) === JSON.stringify(task) ? local : task
  })
}

type Pending = { nextTask: Task | null }

/** A fetch merged into local state: completions still animating keep their local rows, and nothing changed means the same array. */
export function mergeFetched(fetched: Task[], current: Task[], pending: ReadonlyMap<string, Pending>): Task[] {
  const currentById = new Map(current.map(task => [task.id, task]))
  const remoteTasks = preferNewer(fetched, currentById)
  let merged = remoteTasks
  if (pending.size) {
    const pendingNextIds = new Set([...pending.values()].flatMap(entry => entry.nextTask ? [entry.nextTask.id] : []))
    const remoteIds = new Set(remoteTasks.map(task => task.id))
    merged = [
      ...remoteTasks.filter(task => !pendingNextIds.has(task.id)).map(task => pending.has(task.id) ? currentById.get(task.id) ?? task : task),
      ...[...pending.keys()].flatMap(id => !remoteIds.has(id) && currentById.has(id) ? [currentById.get(id)!] : []),
    ]
  }
  return merged.length === current.length && merged.every((task, index) => task === current[index]) ? current : merged
}
