import type { Task } from './supabase'

/** The fields that decide which list a task is in and where it sits there. */
const PLACEMENT_KEYS = ['due_at', 'due_is_approx', 'is_all_day', 'is_inbox'] as const
export type Placement = Pick<Task, typeof PLACEMENT_KEYS[number]>
export type EditLock = { id: string; placement: Placement }

export function lockTask(task: Task | undefined): EditLock | null {
  if (!task) return null
  return { id: task.id, placement: Object.fromEntries(PLACEMENT_KEYS.map(key => [key, task[key]])) as Placement }
}

/**
 * Tasks as they should be placed in lists: the task being edited keeps the place it had when it was opened,
 * so changing its date or time never moves it while the editor is open. Everything else about it stays live.
 */
export function placeTasks(tasks: Task[], lock: EditLock | null): Task[] {
  if (!lock) return tasks
  const index = tasks.findIndex(task => task.id === lock.id)
  if (index < 0) return tasks
  const task = tasks[index]
  if (PLACEMENT_KEYS.every(key => task[key] === lock.placement[key])) return tasks
  const placed = tasks.slice()
  placed[index] = { ...task, ...lock.placement }
  return placed
}
