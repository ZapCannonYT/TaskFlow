const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function nextWeekday(now: Date, name: string, forceNext: boolean) {
  const date = new Date(now)
  const target = weekdays.indexOf(name.toLowerCase())
  let offset = (target - date.getDay() + 7) % 7
  if (forceNext && offset === 0) offset = 7
  date.setDate(date.getDate() + offset)
  return date
}

/** Conservatively pull explicit dates/times out of task text and return a clean title. */
export function parseNaturalTask(text: string, existingDueAt: string | null, now = new Date()) {
  let cleanTitle = text
  let dueDate: Date | null = existingDueAt ? new Date(existingDueAt) : null
  let explicitDate = false
  const remove = (match: RegExpMatchArray) => { cleanTitle = cleanTitle.replace(match[0], ' ') }

  const relative = text.match(/\b(today|tomorrow)\b/i)
  if (relative) {
    dueDate = new Date(now)
    if (relative[1].toLowerCase() === 'tomorrow') dueDate.setDate(dueDate.getDate() + 1)
    explicitDate = true
    remove(relative)
  } else {
    const weekday = text.match(/\b(next\s+|on\s+)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
    if (weekday) {
      dueDate = nextWeekday(now, weekday[2], weekday[1].trim().toLowerCase() === 'next')
      explicitDate = true
      remove(weekday)
    } else {
      const isoDate = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
      const monthDate = text.match(/\b(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i)
      if (isoDate) {
        dueDate = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
        explicitDate = true
        remove(isoDate)
      } else if (monthDate) {
        const month = new Date(`${monthDate[1]} 1, 2000`).getMonth()
        let year = monthDate[3] ? Number(monthDate[3]) : now.getFullYear()
        dueDate = new Date(year, month, Number(monthDate[2]))
        explicitDate = true
        if (!monthDate[3] && dueDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
          year++
          dueDate = new Date(year, month, Number(monthDate[2]))
        }
        remove(monthDate)
      }
    }
  }

  const time = text.match(/\b(?:at\s+)?(?:1[0-2]|0?\d)(?::([0-5]\d))?\s*(am|pm)\b/i)
    ?? text.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i)
  if (time) {
    const twelveHour = /am|pm/i.test(time[0])
    const hourMatch = (twelveHour
      ? time[0].match(/(?:at\s+)?(1[0-2]|0?\d)/)
      : time[0].match(/(?:at\s+)?([01]?\d|2[0-3]):/))!
    let hour = Number(hourMatch[1])
    const minuteMatch = time[0].match(/:(\d{2})/)
    const minute = minuteMatch ? Number(minuteMatch[1]) : 0
    if (twelveHour) hour = hour % 12 + (/pm/i.test(time[0]) ? 12 : 0)
    dueDate ??= new Date(now)
    dueDate.setHours(hour, minute, 0, 0)
    remove(time)
  } else if (explicitDate) dueDate?.setHours(12, 0, 0, 0)

  let title = cleanTitle.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1')
  if (explicitDate || time) title = title.replace(/\b(?:due|on|at|by)\s*$/i, '')
  title = title.replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').trim()
  return { title, due_at: dueDate?.toISOString() ?? null, has_time: Boolean(time) }
}
