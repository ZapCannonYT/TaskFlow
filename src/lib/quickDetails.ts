import type { Task } from './supabase'

export function isBasicTask(task: Pick<Task, 'due_at' | 'due_is_approx' | 'size' | 'is_important' | 'label_id'>) {
  const setFields = Number(Boolean(task.due_at && !task.due_is_approx)) + Number(Boolean(task.size)) + Number(task.is_important) + Number(Boolean(task.label_id))
  return setFields <= 2
}

export function needsDetailsPrompt(task: Pick<Task, 'due_at' | 'due_is_approx' | 'size' | 'is_important' | 'label_id' | 'status' | 'deleted_at'>) {
  return task.status === 'open' && !task.deleted_at && isBasicTask(task)
}
