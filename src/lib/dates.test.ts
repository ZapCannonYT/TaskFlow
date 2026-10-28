import { describe, expect, it } from 'vitest'
import { addLocalDays, classifyView, dateForChoice, getSevenDays, isDueOnDay, isMissed, movedToToday, rankOneThing, startOfLocalWeek } from './dates'

describe('dateForChoice', () => {
  const now = new Date(2026, 9, 21, 15, 30)

  it('uses exact local calendar days for today and tomorrow', () => {
    const today = dateForChoice('today', now)
    const tomorrow = dateForChoice('tomorrow', now)
    expect(new Date(today.due_at).getDate()).toBe(21)
    expect(today.due_is_approx).toBe(false)
    expect(new Date(tomorrow.due_at).getDate()).toBe(22)
    expect(tomorrow.due_is_approx).toBe(false)
  })

  it('marks weekend and next week as approximate Sunday dates', () => {
    const weekend = dateForChoice('weekend', now)
    const nextWeek = dateForChoice('next-week', now)
    expect(new Date(weekend.due_at).getDay()).toBe(0)
    expect(new Date(nextWeek.due_at).getDay()).toBe(0)
    expect(weekend.due_is_approx).toBe(true)
    expect(new Date(nextWeek.due_at).getTime() - new Date(weekend.due_at).getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

describe('classifyView', () => {
  const today = new Date(2026, 9, 21, 15)

  it('routes undated, dated and completed tasks into their Phase 1 views', () => {
    expect(classifyView({ due_at: null, status: 'open' }, today)).toBe('Inbox')
    expect(classifyView({ due_at: new Date(2026, 9, 21, 0).toISOString(), status: 'open' }, today)).toBe('Today')
    expect(classifyView({ due_at: new Date(2026, 9, 22, 0).toISOString(), status: 'open' }, today)).toBe('Later')
    expect(classifyView({ due_at: null, status: 'completed' }, today)).toBe('Done')
  })
})

describe('Phase 2 date views', () => {
  const today = new Date(2026, 9, 21, 15)
  const openTask = (due_at: string | null, overrides: Partial<{ is_important: boolean; created_at: string }> = {}) => ({
    due_at,
    is_important: false,
    created_at: '2026-10-21T08:00:00.000Z',
    ...overrides,
  })

  it('builds a seven-day strip from local midnight across month boundaries', () => {
    const days = getSevenDays(new Date(2026, 9, 29, 20))
    expect(days).toHaveLength(7)
    expect(days.map(day => `${day.getMonth() + 1}-${day.getDate()}`)).toEqual(['10-29', '10-30', '10-31', '11-1', '11-2', '11-3', '11-4'])
    expect(days.every(day => day.getHours() === 0)).toBe(true)
  })

  it('uses a Monday week start and identifies missed tasks separately from the selected day', () => {
    expect(startOfLocalWeek(new Date(2026, 9, 21, 15)).getDay()).toBe(1)
    const yesterday = openTask(new Date(2026, 9, 20, 9).toISOString())
    expect(isDueOnDay(yesterday, today)).toBe(false)
    expect(isDueOnDay(yesterday, addLocalDays(today, -1))).toBe(true)
    expect(isMissed(yesterday, today)).toBe(true)
    expect(isMissed(openTask(new Date(2026, 9, 21, 9).toISOString()), today)).toBe(false)
  })

  it('orders the one thing by importance, then due date, then oldest creation', () => {
    const ranked = rankOneThing([
      openTask('2026-10-21T00:00:00.000Z'),
      openTask('2026-10-21T02:00:00.000Z', { is_important: true }),
      openTask('2026-10-21T00:00:00.000Z', { created_at: '2026-10-21T07:00:00.000Z' }),
    ])
    expect(ranked[0].is_important).toBe(true)
    expect(ranked[1].created_at).toBe('2026-10-21T07:00:00.000Z')
  })
})

describe('movedToToday', () => {
  const now = new Date(2026, 9, 28, 15, 0)
  it('keeps the time of day for a timed task', () => {
    const moved = movedToToday({ due_at: new Date(2026, 9, 20, 9, 30).toISOString(), is_all_day: false }, now)
    expect(new Date(moved.due_at)).toEqual(new Date(2026, 9, 28, 9, 30))
    expect(moved.due_is_approx).toBe(false)
  })
  it('moves an all-day task to the start of today', () => {
    const moved = movedToToday({ due_at: new Date(2026, 9, 20, 12).toISOString(), is_all_day: true }, now)
    expect(new Date(moved.due_at)).toEqual(new Date(2026, 9, 28))
  })
})
