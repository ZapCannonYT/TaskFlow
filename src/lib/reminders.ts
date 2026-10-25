import type { Task } from './supabase'

export type ReminderOffset = Task['reminder_offset']
export type ReminderUnit = 'minutes' | 'hours' | 'days'

export const REMINDER_OPTIONS: ReadonlyArray<readonly [ReminderOffset, string]> = [
  ['none', 'No reminder'],
  ['at_time', 'At due time'],
  ['1_hour_before', '1 hour before'],
  ['1_day_before', '1 day before'],
  ['2_days_before', '2 days before'],
  ['custom', 'Custom…'],
]

export const UNIT_MINUTES: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440 }
export const MAX_REMINDER_MINUTES = 40320
export const DEFAULT_CUSTOM_MINUTES = 30

/** Show a stored minute count in the largest unit that divides it evenly. */
export function splitMinutes(minutes: number): { amount: number; unit: ReminderUnit } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'days' }
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' }
  return { amount: minutes, unit: 'minutes' }
}

export function toMinutes(amount: number, unit: ReminderUnit): number {
  return Math.min(MAX_REMINDER_MINUTES, Math.max(1, Math.round(amount * UNIT_MINUTES[unit])))
}

export function reminderLabel(task: Pick<Task, 'reminder_offset' | 'reminder_minutes'>): string {
  if (task.reminder_offset === 'custom' && task.reminder_minutes) {
    const { amount, unit } = splitMinutes(task.reminder_minutes)
    const short = unit === 'minutes' ? 'min' : unit === 'hours' ? (amount === 1 ? 'hour' : 'hours') : (amount === 1 ? 'day' : 'days')
    return `${amount} ${short} before`
  }
  if (task.reminder_offset === 'at_time') return 'At due time'
  return REMINDER_OPTIONS.find(([value]) => value === task.reminder_offset)?.[1] ?? ''
}

/** Values to save when the Reminder select changes. */
export function reminderChange(offset: ReminderOffset, currentMinutes?: number | null): Pick<Task, 'reminder_offset' | 'reminder_minutes'> {
  if (offset === 'custom') return { reminder_offset: 'custom', reminder_minutes: currentMinutes ?? DEFAULT_CUSTOM_MINUTES }
  return { reminder_offset: offset, reminder_minutes: null }
}
