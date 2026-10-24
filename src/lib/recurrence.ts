export type RecurrenceRule = 'daily' | 'weekdays' | 'weekly' | 'monthly'

export function nextOccurrence(rule: RecurrenceRule, dueAt: string, monthDay?: number | null, after = new Date()) {
  const next = new Date(dueAt)
  const anchoredMonthDay = monthDay ?? next.getDate()
  const advance = () => {
    if (rule === 'daily' || rule === 'weekdays') {
      next.setDate(next.getDate() + 1)
      if (rule === 'weekdays') while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1)
    }
    if (rule === 'weekly') next.setDate(next.getDate() + 7)
    if (rule === 'monthly') {
      next.setDate(1)
      next.setMonth(next.getMonth() + 1)
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(anchoredMonthDay, lastDay))
    }
  }
  do { advance() } while (next.getTime() <= after.getTime())
  return next.toISOString()
}
