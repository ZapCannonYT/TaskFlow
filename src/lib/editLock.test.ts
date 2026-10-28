import { describe, expect, it } from 'vitest'
import type { Task } from './supabase'
import { lockTask, placeTasks } from './editLock'

const task = (id: string, values: Partial<Task> = {}): Task => ({
  id, user_id: 'u', title: id, status: 'open', due_at: '2026-10-28T09:00:00.000Z', due_is_approx: false, is_all_day: false, timezone: 'UTC',
  size: null, is_important: false, label_id: null, reminder_offset: 'none', is_inbox: false,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', completed_at: null, deleted_at: null, ...values,
})

describe('placeTasks', () => {
  it('returns the same array when nothing is locked or the locked task has not moved', () => {
    const tasks = [task('a'), task('b')]
    expect(placeTasks(tasks, null)).toBe(tasks)
    expect(placeTasks(tasks, lockTask(tasks[0]))).toBe(tasks)
  })

  it('keeps the edited task at its original date, time and list while the editor is open', () => {
    const original = task('a', { is_inbox: true })
    const lock = lockTask(original)
    const edited = { ...original, title: 'renamed', due_at: '2026-10-30T15:00:00.000Z', is_inbox: false }
    const [placed] = placeTasks([edited], lock)
    expect(placed.due_at).toBe(original.due_at)
    expect(placed.is_inbox).toBe(true)
    expect(placed.title).toBe('renamed')
  })

  it('lets completion and deletion through, since those are not placement', () => {
    const original = task('a')
    const lock = lockTask(original)
    const [placed] = placeTasks([{ ...original, due_at: '2026-10-30T15:00:00.000Z', status: 'completed', deleted_at: '2026-10-28T10:00:00.000Z' }], lock)
    expect(placed.status).toBe('completed')
    expect(placed.deleted_at).not.toBeNull()
  })

  it('leaves other tasks free to move', () => {
    const lock = lockTask(task('a'))
    const other = task('b', { due_at: '2026-11-02T09:00:00.000Z' })
    expect(placeTasks([task('a'), other], lock)[1]).toBe(other)
  })
})
