export type RecurrenceRule = 'daily' | 'weekdays' | 'weekly' | 'monthly'

export function nextOccurrence(rule: RecurrenceRule, dueAt: string, monthDay?: number | null) {
  const next = new Date(dueAt)
  if (rule === 'daily') next.setDate(next.getDate() + 1)
  if (rule === 'weekdays') {
    do { next.setDate(next.getDate() + 1) } while (next.getDay() === 0 || next.getDay() === 6)
  }
  if (rule === 'weekly') next.setDate(next.getDate() + 7)
  if (rule === 'monthly') {
    const day = monthDay ?? next.getDate()
    next.setDate(1)
    next.setMonth(next.getMonth() + 1)
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    next.setDate(Math.min(day, lastDay))
  }
  return next.toISOString()
}
