export function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

export function localDateTime(day: string, time: string, timezone: string) {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time.slice(0, 5).split(':').map(Number)
  let guess = Date.UTC(year, month - 1, date, hour, minute)
  for (let i = 0; i < 3; i++) {
    const parts = localParts(new Date(guess), timezone)
    const [localYear, localMonth, localDate] = parts.day.split('-').map(Number)
    const delta = Date.UTC(year, month - 1, date, hour, minute) - Date.UTC(localYear, localMonth - 1, localDate, parts.hour, parts.minute)
    if (delta === 0) break
    guess += delta
  }
  return new Date(guess)
}

export function quietEndAt(now: Date, timezone: string, quietStart: string, quietEnd: string) {
  const current = localParts(now, timezone)
  const minutesNow = current.hour * 60 + current.minute
  const start = Number(quietStart.slice(0, 2)) * 60 + Number(quietStart.slice(3, 5))
  const end = Number(quietEnd.slice(0, 2)) * 60 + Number(quietEnd.slice(3, 5))
  const quiet = start === end ? true : start < end ? minutesNow >= start && minutesNow < end : minutesNow >= start || minutesNow < end
  if (!quiet) return null
  let day = current.day
  if (start >= end && minutesNow >= start) {
    const next = new Date(`${day}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    day = next.toISOString().slice(0, 10)
  }
  return localDateTime(day, quietEnd, timezone)
}

export function constantTimeEqual(first: string, second: string) {
  if (first.length !== second.length) return false
  let difference = 0
  for (let i = 0; i < first.length; i++) difference |= first.charCodeAt(i) ^ second.charCodeAt(i)
  return difference === 0
}

export function isSupportedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const host = url.hostname.toLowerCase()
    return host === 'fcm.googleapis.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.push.services.mozilla.com')
      || host.endsWith('.notify.windows.com')
  } catch {
    return false
  }
}

export function safeTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  } catch {
    return 'UTC'
  }
}

export function selectSupabaseKey(legacyKey: string | undefined, namedKeys: string | undefined) {
  if (legacyKey) return legacyKey
  if (!namedKeys) return undefined
  try {
    const keys = JSON.parse(namedKeys) as Record<string, unknown>
    const defaultKey = keys.default
    if (typeof defaultKey === 'string') return defaultKey
    const first = Object.values(keys).find(value => typeof value === 'string')
    return typeof first === 'string' ? first : undefined
  } catch {
    return undefined
  }
}
