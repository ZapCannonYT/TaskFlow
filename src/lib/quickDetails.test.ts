import { describe, expect, it } from 'vitest'
import { isBasicTask, needsDetailsPrompt } from './quickDetails'

const basic = { due_at: null, due_is_approx: false, size: null, is_important: false, label_id: null, status: 'open' as const, deleted_at: null }

describe('Quick details', () => {
  it('treats zero to two optional fields as basic', () => {
    expect(isBasicTask(basic)).toBe(true)
    expect(isBasicTask({ ...basic, due_at: '2026-10-25T12:00:00Z', size: 'quick' })).toBe(true)
  })
  it('does not count rough dates and considers three fields complete', () => {
    expect(isBasicTask({ ...basic, due_at: '2026-10-25T12:00:00Z', due_is_approx: true, size: 'quick', label_id: 'label' })).toBe(true)
    expect(isBasicTask({ ...basic, due_at: '2026-10-25T12:00:00Z', size: 'quick', label_id: 'label' })).toBe(false)
  })
  it('prompts only open, undeleted basic tasks', () => {
    expect(needsDetailsPrompt(basic)).toBe(true)
    expect(needsDetailsPrompt({ ...basic, status: 'completed' })).toBe(false)
    expect(needsDetailsPrompt({ ...basic, deleted_at: '2026-10-22T12:00:00Z' })).toBe(false)
  })
})
