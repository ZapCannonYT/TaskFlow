import type { Task } from './supabase'

type AuditFields = Pick<Task, 'due_at' | 'due_is_approx' | 'size' | 'is_important' | 'label_id'>
  & Partial<Pick<Task, 'recurrence_rule' | 'description' | 'reminder_offset' | 'details_prompted_at'>>

export function isBasicTask(task: AuditFields) {
  const setFields = Number(Boolean(task.due_at && !task.due_is_approx)) + Number(Boolean(task.size)) + Number(task.is_important) + Number(Boolean(task.label_id))
    + Number(Boolean(task.recurrence_rule)) + Number(Boolean(task.description?.trim()))
    + Number(Boolean(task.due_at && !task.due_is_approx && task.reminder_offset && task.reminder_offset !== 'none'))
  return setFields <= 3
}

export function needsDetailsPrompt(task: AuditFields & Pick<Task, 'status' | 'deleted_at'>) {
  return task.status === 'open' && !task.deleted_at && !task.details_prompted_at && isBasicTask(task)
}
