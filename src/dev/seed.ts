import type { Task } from '../lib/supabase'
import { addLocalDays, dateForChoice } from '../lib/dates'

export type SeedTask = Pick<Task, 'title'> & Partial<Pick<Task,
  'status' | 'due_at' | 'due_is_approx' | 'size' | 'is_important' | 'completed_at' | 'reminder_offset'
>>

const atMidday = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).toISOString()

export function buildSeedTasks(now: Date): SeedTask[] {
  const today = dateForChoice('today', now)
  const tomorrow = dateForChoice('tomorrow', now)
  const weekend = dateForChoice('weekend', now)
  const nextWeek = dateForChoice('next-week', now)
  const completedAt = new Date(now.getTime() - 60_000).toISOString()

  return [
    { title: '[seed] Missed yesterday', due_at: atMidday(addLocalDays(now, -1)) },
    { title: '[seed] Missed last week', due_at: atMidday(addLocalDays(now, -6)) },
    { title: '[seed] Quick task today', ...today, size: 'quick' },
    { title: '[seed] Hour task today', ...today, size: 'hour', is_important: true },
    { title: '[seed] Big task today', ...today, size: 'big' },
    { title: '[seed] Big important tomorrow', ...tomorrow, size: 'big', is_important: true },
    { title: '[seed] Sometime this weekend', ...weekend },
    { title: '[seed] Sometime next week', ...nextWeek },
    { title: '[seed] Inbox: buy coffee' },
    { title: '[seed] Inbox: read article' },
    { title: '[seed] Inbox: reply to email' },
    { title: '[seed] Open task with details', ...tomorrow, size: 'hour', is_important: true },
    { title: '[seed] Finished task one', status: 'completed', completed_at: completedAt },
    { title: '[seed] Finished task two', status: 'completed', completed_at: completedAt },
  ]
}
