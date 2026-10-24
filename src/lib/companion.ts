export type CompanionTask = {
  id: string
  title: string
  due_at: string | null
  due_is_approx: boolean
  size: 'quick' | 'hour' | 'big' | null
  is_important: boolean
  status: string
  created_at: string
  deleted_at?: string | null
}

const DAY = 24 * 60 * 60 * 1000

function calendarDay(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value)
  return Math.floor(Date.UTC(part('year'), part('month') - 1, part('day')) / DAY)
}

export function rankCompanionTasks<T extends CompanionTask>(tasks: T[], now = new Date(), timezone = 'UTC') {
  const open = tasks.filter(task => task.status === 'open' && !task.deleted_at)
  const dated = open.filter(task => task.due_at)
  const candidates = dated.length ? dated : open
  return candidates.map(task => {
    let score = 0
    const reasons: string[] = []
    const days = task.due_at ? calendarDay(new Date(task.due_at), timezone) - calendarDay(now, timezone) : null

    if (days !== null) {
      if (days < 0) { score += 100 + Math.min(20, Math.abs(days)); reasons.push('Missed') }
      else if (days === 0) { score += 80; reasons.push('Due today') }
      else if (days === 1) { score += 50; reasons.push('Due tomorrow') }
      else if (days <= 3) { score += 30; reasons.push('Due soon') }
      else if (days <= 7) { score += 15; reasons.push('Due this week') }
      else reasons.push('Upcoming')
    } else {
      const untouchedDays = Math.max(0, Math.floor((now.getTime() - new Date(task.created_at).getTime()) / DAY))
      score += Math.min(10, untouchedDays)
      reasons.push('In your Inbox')
    }

    if (task.is_important) { score += 25; reasons.push('Important') }
    if (task.size === 'big' && days !== null && days >= 0 && days <= 2) { score += 40; reasons.push('Big task') }
    if ((task.size === 'hour' || task.size === null) && days !== null && days >= 0 && days <= 1) { score += 15; reasons.push('About an hour') }

    return { task, score, reason: reasons.join(' · ') }
  }).sort((a, b) => b.score - a.score || new Date(a.task.created_at).getTime() - new Date(b.task.created_at).getTime())
}
