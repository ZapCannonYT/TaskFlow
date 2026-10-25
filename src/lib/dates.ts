export type WhenChoice = 'today' | 'tomorrow' | 'weekend' | 'next-week'

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function dateForChoice(choice: WhenChoice, now = new Date()) {
  const date = startOfLocalDay(now)
  let approximate = false
  if (choice === 'tomorrow') date.setDate(date.getDate() + 1)
  if (choice === 'weekend' || choice === 'next-week') {
    const daysToSunday = (7 - date.getDay()) % 7
    date.setDate(date.getDate() + daysToSunday + (choice === 'next-week' ? 7 : 0))
    approximate = true
  }
  return { due_at: date.toISOString(), due_is_approx: approximate }
}

export function classifyView(task: { due_at: string | null; status: string; is_inbox?: boolean }, today = new Date()) {
  if (task.status === 'completed') return 'Done'
  if (task.is_inbox) return 'Inbox'
  if (!task.due_at) return 'Inbox'
  const due = new Date(task.due_at)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  return due < tomorrowStart ? 'Today' : 'Later'
}

export function addLocalDays(date: Date, days: number) {
  const result = startOfLocalDay(date)
  result.setDate(result.getDate() + days)
  return result
}

export function isSameLocalDay(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate()
}

export function startOfLocalWeek(date: Date) {
  const result = startOfLocalDay(date)
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7))
  return result
}

export function getSevenDays(today = new Date()) {
  return Array.from({ length: 7 }, (_, index) => addLocalDays(today, index))
}

export function isDueOnDay(task: { due_at: string | null }, day: Date) {
  if (!task.due_at) return false
  return isSameLocalDay(new Date(task.due_at), day)
}

export function isMissed(task: { due_at: string | null }, today = new Date()) {
  return Boolean(task.due_at && new Date(task.due_at) < startOfLocalDay(today))
}

export function rankOneThing<T extends {
  due_at: string | null
  is_important: boolean
  created_at: string
}>(tasks: T[]) {
  return [...tasks].sort((first, second) => {
    if (first.is_important !== second.is_important) return first.is_important ? -1 : 1
    const firstDue = first.due_at ? new Date(first.due_at).getTime() : Number.MAX_SAFE_INTEGER
    const secondDue = second.due_at ? new Date(second.due_at).getTime() : Number.MAX_SAFE_INTEGER
    if (firstDue !== secondDue) return firstDue - secondDue
    return new Date(first.created_at).getTime() - new Date(second.created_at).getTime()
  })
}

export function localDateInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function localTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function withLocalTime(value: string | null, time: string, fallback?: Date) {
  const date = value ? new Date(value) : new Date((fallback ?? new Date(dateForChoice('today').due_at!)).getTime())
  const [hours, minutes] = time.split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}
