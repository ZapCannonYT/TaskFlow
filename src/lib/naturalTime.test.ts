import { describe, expect, it } from 'vitest'
import { parseNaturalTask } from './naturalTime'

// Wednesday 28 October 2026, 3:00 PM local time.
const now = new Date(2026, 9, 28, 15, 0)
const parse = (text: string) => {
  const result = parseNaturalTask(text, null, now)
  return { title: result.title, due: result.due_at ? new Date(result.due_at) : null, hasTime: result.has_time }
}

describe('parseNaturalTask', () => {
  it('takes a time out of the title', () => {
    expect(parse('Call mom at 5pm')).toEqual({ title: 'Call mom', due: new Date(2026, 9, 28, 17, 0), hasTime: true })
  })
  it('reads a bare weekday with a time', () => {
    expect(parse('dentist friday at 3pm')).toEqual({ title: 'dentist', due: new Date(2026, 9, 30, 15, 0), hasTime: true })
  })
  it('moves a time already past today to tomorrow', () => {
    expect(parse('standup 9:30').due).toEqual(new Date(2026, 9, 29, 9, 30))
  })
  it('picks the next o\'clock for "at 7"', () => {
    expect(parse('gym at 7')).toEqual({ title: 'gym', due: new Date(2026, 9, 28, 19, 0), hasTime: true })
  })
  it('understands tonight, noon and this morning', () => {
    expect(parse('dinner tonight')).toEqual({ title: 'dinner', due: new Date(2026, 9, 28, 20, 0), hasTime: true })
    expect(parse('meeting tomorrow at noon')).toEqual({ title: 'meeting', due: new Date(2026, 9, 29, 12, 0), hasTime: true })
  })
  it('counts "in 2 hours" from now', () => {
    expect(parse('pay rent in 2 hours')).toEqual({ title: 'pay rent', due: new Date(2026, 9, 28, 17, 0), hasTime: true })
  })
  it('keeps a date-only phrase all day', () => {
    expect(parse('Groceries tomorrow')).toEqual({ title: 'Groceries', due: new Date(2026, 9, 29, 12, 0), hasTime: false })
  })
  it('leaves words that only look like days or times alone', () => {
    expect(parse('Buy sun cream')).toEqual({ title: 'Buy sun cream', due: null, hasTime: false })
    expect(parse('Read chapter 7')).toEqual({ title: 'Read chapter 7', due: null, hasTime: false })
  })
})
