import { describe, expect, it } from 'vitest'
import type { Task } from './supabase'
import { isRecentDuplicate, mergeFetched, preferNewer } from './taskRules'

const NOW = Date.parse('2026-10-25T12:00:00.000Z')
const DUE = '2026-10-26T09:00:00.000Z'
const secondsBefore = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()

function task(id: string, options: Partial<Task> = {}): Task {
  return {
    id, user_id: 'u', title: id, status: 'open', due_at: null, due_is_approx: false, is_all_day: false,
    timezone: 'UTC', size: null, is_important: false, label_id: null, reminder_offset: 'none',
    created_at: '', updated_at: '', completed_at: null, deleted_at: null, ...options,
  }
}

describe('isRecentDuplicate', () => {
  const existing = (options: Partial<Task> = {}) => task('a', { title: 'Buy Milk', due_at: DUE, created_at: secondsBefore(5), ...options })

  it('is true for an open task with the same title (case-insensitive) and due date created 5s ago', () => {
    expect(isRecentDuplicate([existing()], 'buy milk', DUE, NOW)).toBe(true)
  })

  it('is false when the match was created 20s ago', () => {
    expect(isRecentDuplicate([existing({ created_at: secondsBefore(20) })], 'buy milk', DUE, NOW)).toBe(false)
  })

  it('is false when the matching task is deleted', () => {
    expect(isRecentDuplicate([existing({ deleted_at: secondsBefore(1) })], 'buy milk', DUE, NOW)).toBe(false)
  })

  it('is false when the matching task is completed', () => {
    expect(isRecentDuplicate([existing({ status: 'completed' })], 'buy milk', DUE, NOW)).toBe(false)
  })

  it('is false when the due date differs, including null versus a date', () => {
    expect(isRecentDuplicate([existing()], 'buy milk', '2026-10-27T09:00:00.000Z', NOW)).toBe(false)
    expect(isRecentDuplicate([existing()], 'buy milk', null, NOW)).toBe(false)
    expect(isRecentDuplicate([existing({ due_at: null })], 'buy milk', DUE, NOW)).toBe(false)
    expect(isRecentDuplicate([existing({ due_at: null })], 'buy milk', null, NOW)).toBe(true)
  })
})

describe('preferNewer', () => {
  const at = (iso: string) => iso

  it('keeps a local row that is newer, so a stale fetch does not resurrect a deleted task', () => {
    const fetched = task('a', { updated_at: at('2026-10-25T10:00:00.000Z') })
    const local = task('a', { updated_at: at('2026-10-25T11:00:00.000Z'), deleted_at: at('2026-10-25T11:00:00.000Z') })
    const result = preferNewer([fetched], new Map([['a', local]]))
    expect(result).toEqual([local])
    expect(result[0].deleted_at).not.toBeNull()
  })

  it('takes the fetched row when it is newer or equal', () => {
    const local = task('a', { title: 'local', updated_at: at('2026-10-25T10:00:00.000Z') })
    const newer = task('a', { title: 'newer', updated_at: at('2026-10-25T11:00:00.000Z') })
    const equal = task('b', { title: 'equal', updated_at: at('2026-10-25T10:00:00.000Z') })
    const localEqual = task('b', { title: 'local-equal', updated_at: at('2026-10-25T10:00:00.000Z') })
    const result = preferNewer([newer, equal], new Map([['a', local], ['b', localEqual]]))
    expect(result).toEqual([newer, equal])
  })

  it('takes the fetched row when there is no local copy', () => {
    const fetched = task('a', { updated_at: at('2026-10-25T10:00:00.000Z') })
    expect(preferNewer([fetched], new Map())).toEqual([fetched])
  })

  it('preserves the fetched order', () => {
    const a = task('a', { updated_at: at('2026-10-25T10:00:00.000Z') })
    const b = task('b', { updated_at: at('2026-10-25T10:00:00.000Z') })
    const c = task('c', { updated_at: at('2026-10-25T10:00:00.000Z') })
    const localB = task('b', { title: 'local-b', updated_at: at('2026-10-25T12:00:00.000Z') })
    const result = preferNewer([c, a, b], new Map([['b', localB]]))
    expect(result.map(row => row.id)).toEqual(['c', 'a', 'b'])
    expect(result[2]).toBe(localB)
  })
})

describe('mergeFetched', () => {
  const stamp = '2026-10-25T10:00:00.000Z'

  it('returns the current array when a fetch changes nothing, so the list does not re-render', () => {
    const current = [task('a', { updated_at: stamp }), task('b', { updated_at: stamp })]
    const fetched = current.map(row => ({ ...row }))
    expect(mergeFetched(fetched, current, new Map())).toBe(current)
  })

  it('keeps unchanged rows as the same objects and replaces changed ones', () => {
    const a = task('a', { updated_at: stamp })
    const b = task('b', { updated_at: stamp })
    const changedB = task('b', { title: 'renamed', updated_at: '2026-10-25T11:00:00.000Z' })
    const result = mergeFetched([{ ...a }, changedB], [a, b], new Map())
    expect(result[0]).toBe(a)
    expect(result[1]).toBe(changedB)
  })

  it('keeps a pending completion local and hides its next occurrence until it settles', () => {
    const done = task('a', { updated_at: stamp })
    const next = task('n', { updated_at: stamp })
    const result = mergeFetched([{ ...done, status: 'completed' }, next], [done], new Map([['a', { nextTask: next }]]))
    expect(result).toEqual([done])
  })
})
