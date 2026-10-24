import { describe, expect, it } from 'vitest'
import { isSameLocalDay } from '../lib/dates'
import { buildSeedTasks } from './seed'

describe('buildSeedTasks', () => {
  const now = new Date(2026, 9, 24, 9)
  const tasks = buildSeedTasks(now)

  it('builds the requested sample-task mix', () => {
    expect(tasks).toHaveLength(14)
    expect(tasks.filter(task => (task.status ?? 'open') === 'completed')).toHaveLength(2)
    expect(tasks.filter(task => task.due_is_approx)).toHaveLength(2)
    expect(tasks.filter(task => !task.due_at && !task.status && Object.keys(task).length === 1)).toHaveLength(3)
    expect(tasks.filter(task => task.due_at && new Date(task.due_at) < new Date(now.getFullYear(), now.getMonth(), now.getDate()))).toHaveLength(2)
    expect(tasks.filter(task => task.due_at && isSameLocalDay(new Date(task.due_at), now))).toHaveLength(3)
  })

  it('prefixes every task so the panel can remove only its own sample data', () => {
    expect(tasks.every(task => task.title.startsWith('[seed] '))).toBe(true)
  })

  it('marks the weekend and next-week buckets as approximate', () => {
    const approximate = tasks.filter(task => task.due_is_approx)
    expect(approximate).toHaveLength(2)
    expect(approximate.every(task => task.due_is_approx === true)).toBe(true)
  })
})
