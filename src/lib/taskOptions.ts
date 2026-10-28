import type { RecurrenceRule, Task } from './supabase'

export const REPEAT_OPTIONS: ReadonlyArray<readonly [RecurrenceRule, string]> = [['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]
export const SIZE_OPTIONS: ReadonlyArray<readonly [NonNullable<Task['size']>, string]> = [['quick', 'Quick'], ['hour', 'An hour'], ['big', 'Big']]

export const repeatLabel = (rule: RecurrenceRule) => REPEAT_OPTIONS.find(([key]) => key === rule)![1]
export const sizeLabel = (size: NonNullable<Task['size']>) => SIZE_OPTIONS.find(([key]) => key === size)![1]
