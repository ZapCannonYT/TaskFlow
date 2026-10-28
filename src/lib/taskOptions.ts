import type { RecurrenceRule, Task } from './supabase'
import type { MenuOption } from '../components/SelectMenu'
import { dateForChoice, type WhenChoice } from './dates'
import { REMINDER_OPTIONS, type ReminderOffset } from './reminders'

export const REPEAT_OPTIONS: ReadonlyArray<readonly [RecurrenceRule, string]> = [['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]
export const SIZE_OPTIONS: ReadonlyArray<readonly [NonNullable<Task['size']>, string]> = [['quick', 'Quick'], ['hour', 'An hour'], ['big', 'Big']]

export const repeatLabel = (rule: RecurrenceRule) => REPEAT_OPTIONS.find(([key]) => key === rule)![1]
export const sizeLabel = (size: NonNullable<Task['size']>) => SIZE_OPTIONS.find(([key]) => key === size)![1]


const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export type WhenValue = '' | WhenChoice | 'date'

/** Choices for a task's day, each with the date it stands for. */
export function whenMenu(now = new Date()): MenuOption<WhenValue>[] {
  return [
    { value: '', label: 'No date', hint: 'Stays in Inbox' },
    { value: 'today', label: 'Today', hint: dayLabel(dateForChoice('today', now).due_at) },
    { value: 'tomorrow', label: 'Tomorrow', hint: dayLabel(dateForChoice('tomorrow', now).due_at) },
    { value: 'weekend', label: 'This weekend', hint: `Around ${dayLabel(dateForChoice('weekend', now).due_at)}` },
    { value: 'next-week', label: 'Next week', hint: `Around ${dayLabel(dateForChoice('next-week', now).due_at)}` },
    { value: 'date', label: 'Pick a date…', divider: true },
  ]
}

const REPEAT_HINTS: Record<RecurrenceRule, string> = { daily: 'Every day', weekdays: 'Monday to Friday', weekly: 'Same day each week', monthly: 'Same date each month' }
export const REPEAT_MENU: MenuOption<'' | RecurrenceRule>[] = [
  { value: '', label: 'Never', hint: 'Just once' },
  ...REPEAT_OPTIONS.map(([value, label]) => ({ value, label, hint: REPEAT_HINTS[value] })),
]

const SIZE_HINTS: Record<NonNullable<Task['size']>, string> = { quick: 'About 15 minutes', hour: 'About an hour', big: 'About 3 hours' }
export const SIZE_MENU: MenuOption<'' | NonNullable<Task['size']>>[] = [
  { value: '', label: 'Not set' },
  ...SIZE_OPTIONS.map(([value, label]) => ({ value, label, hint: SIZE_HINTS[value] })),
]

export const REMINDER_MENU: MenuOption<ReminderOffset>[] = REMINDER_OPTIONS.map(([value, label]) => ({ value, label, ...(value === 'custom' ? { divider: true } : {}) }))
