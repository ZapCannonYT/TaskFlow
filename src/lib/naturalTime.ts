const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const SHORT_DAYS: Record<string, string> = { mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' }

function nextWeekday(now: Date, name: string, forceNext: boolean) {
  const date = new Date(now)
  const target = weekdays.indexOf(SHORT_DAYS[name.toLowerCase()] ?? name.toLowerCase())
  let offset = (target - date.getDay() + 7) % 7
  if (forceNext && offset === 0) offset = 7
  date.setDate(date.getDate() + offset)
  return date
}

/**
 * Conservatively pull explicit dates/times out of task text and return a clean title, e.g.
 * "dentist friday at 3pm" -> "dentist", due Friday 3 PM. Words that only look like times are left alone.
 */
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
    // A bare weekday name counts ("dentist friday"); short forms need a prefix, since "sun" and "sat" are words.
    const weekday = text.match(/\b(next\s+|on\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
      ?? text.match(/\b(next\s+|on\s+|this\s+)(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\b/i)
    if (weekday) {
      dueDate = nextWeekday(now, weekday[2], (weekday[1] ?? '').trim().toLowerCase() === 'next')
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
    // A time already gone today with no day named means the next one: "standup 9:30" typed at 3pm is tomorrow.
    if (!explicitDate && !existingDueAt && dueDate < now) dueDate.setDate(dueDate.getDate() + 1)
    remove(time)
    return finish(cleanTitle, dueDate, true)
  }

  // "in 2 hours", "in 30 min": counted from now.
  const inPhrase = !explicitDate && text.match(/\bin\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/i)
  if (inPhrase) {
    dueDate = new Date(now.getTime() + Number(inPhrase[1]) * (/^h/i.test(inPhrase[2]) ? 60 : 1) * 60_000)
    dueDate.setSeconds(0, 0)
    remove(inPhrase)
    return finish(cleanTitle, dueDate, true)
  }

  // Words that carry their own time of day.
  const partOfDay = text.match(/\b(?:at\s+)?(noon|midday)\b|\b(tonight)\b|\bthis\s+(morning|afternoon|evening)\b/i)
  if (partOfDay) {
    const word = (partOfDay[1] ?? partOfDay[2] ?? partOfDay[3]).toLowerCase()
    const hour = word === 'noon' || word === 'midday' ? 12 : word === 'morning' ? 9 : word === 'afternoon' ? 15 : word === 'evening' ? 18 : 20
    dueDate ??= new Date(now)
    dueDate.setHours(hour, 0, 0, 0)
    remove(partOfDay)
    return finish(cleanTitle, dueDate, true)
  }

  // "gym at 7": the next 7 o'clock still ahead, morning or evening. On a named day, 7 to 11 means morning.
  const bareHour = text.match(/\bat\s+(1[0-2]|[1-9])\b(?![:.%/]\d)/i)
  if (bareHour) {
    const hour = Number(bareHour[1])
    if (explicitDate && dueDate) dueDate.setHours(hour >= 7 && hour <= 11 ? hour : hour % 12 + 12, 0, 0, 0)
    else {
      const [morning, evening] = [hour % 12, hour % 12 + 12].map(h => { const d = new Date(now); d.setHours(h, 0, 0, 0); return d })
      dueDate = morning > now ? morning : evening > now ? evening : (morning.setDate(morning.getDate() + 1), morning)
    }
    remove(bareHour)
    return finish(cleanTitle, dueDate, true)
  }

  if (explicitDate) dueDate?.setHours(12, 0, 0, 0)
  return finish(cleanTitle, dueDate, false, explicitDate)
}

function finish(text: string, dueDate: Date | null, hasTime: boolean, matched = hasTime) {
  let title = text.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1')
  if (matched) title = title.replace(/\b(?:due|on|at|by)\s*$/i, '')
  title = title.replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').trim()
  return { title, due_at: dueDate?.toISOString() ?? null, has_time: hasTime }
}
