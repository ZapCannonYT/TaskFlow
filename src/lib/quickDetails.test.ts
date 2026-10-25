import { describe, expect, it } from 'vitest'
import { isBasicTask, needsDetailsPrompt } from './quickDetails'

const basic = { due_at: null, due_is_approx: false, size: null, is_important: false, label_id: null, status: 'open' as const, deleted_at: null }

describe('Quick details', () => {
  it('treats three or fewer optional fields as basic', () => {
    expect(isBasicTask(basic)).toBe(true)
    expect(isBasicTask({ ...basic, due_at: '2026-10-25T12:00:00Z', size: 'quick' })).toBe(true)
  })
  it('does not count rough dates, accepts three fields, and rejects four', () => {
    expect(isBasicTask({ ...basic, due_at: '2026-10-25T12:00:00Z', due_is_approx: true, size: 'quick', label_id: 'label' })).toBe(true)
    expect(isBasicTask({ ...basic, due_at: '2026-10-25T12:00:00Z', size: 'quick', label_id: 'label' })).toBe(true)
    expect(isBasicTask({ ...basic, due_at: '2026-10-25T12:00:00Z', size: 'quick', label_id: 'label', is_important: true })).toBe(false)
  })
  it('counts a specific time as its own field', () => {
    const timed = { ...basic, due_at: '2026-10-25T17:00:00Z', is_all_day: false, size: 'quick' as const }
    expect(isBasicTask(timed)).toBe(true)
    expect(isBasicTask({ ...timed, reminder_offset: '1_hour_before' as const })).toBe(false)
    expect(isBasicTask({ ...timed, is_all_day: true, reminder_offset: '1_hour_before' as const })).toBe(true)
  })
  it('prompts only open, undeleted basic tasks', () => {
    expect(needsDetailsPrompt(basic)).toBe(true)
    expect(needsDetailsPrompt({ ...basic, status: 'completed' })).toBe(false)
    expect(needsDetailsPrompt({ ...basic, deleted_at: '2026-10-22T12:00:00Z' })).toBe(false)
  })
})
