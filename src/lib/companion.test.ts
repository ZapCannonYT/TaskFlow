import { describe, expect, it } from 'vitest'
import { rankCompanionTasks, CompanionTask } from './companion'

const now = new Date('2026-10-22T12:00:00.000Z')
function task(overrides: Partial<CompanionTask> = {}): CompanionTask {
  return {
    id: 'task', title: 'Do a thing', due_at: null, due_is_approx: false, size: null,
    is_important: false, status: 'open', created_at: '2026-10-22T10:00:00.000Z', ...overrides,
  }
}
const due = (offset: number) => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000).toISOString()

describe('companion task ranking', () => {
  it.each([
    [-3, 103], [-1, 101], [0, 95], [1, 65], [2, 30], [3, 30], [4, 15], [7, 15], [8, 0],
  ])('scores day offset %i by %i points for a default hour-sized task', (offset, expected) => {
    const [ranked] = rankCompanionTasks([task({ due_at: due(offset) })], now)
    expect(ranked.score).toBe(expected)
  })

  it('adds importance and big-task lead time, then uses oldest task as tie-breaker', () => {
    const important = task({ id: 'important', due_at: due(1), is_important: true, created_at: due(-5) })
    const big = task({ id: 'big', due_at: due(1), size: 'big' })
    const [first] = rankCompanionTasks([big, important], now)
    expect(first.task.id).toBe('important')
    expect(rankCompanionTasks([task({ id: 'new', created_at: due(-1) }), task({ id: 'old', created_at: due(-5) })], now)[0].task.id).toBe('old')
  })

  it('only considers undated tasks when there are no dated open tasks', () => {
    const [winner] = rankCompanionTasks([task({ id: 'inbox', is_important: true }), task({ id: 'future', due_at: due(12) })], now)
    expect(winner.task.id).toBe('future')
  })

  it('ignores completed and removed tasks and uses the requested timezone calendar day', () => {
    const list = [
      task({ id: 'done', status: 'completed', due_at: due(-1) }),
      task({ id: 'removed', deleted_at: now.toISOString(), due_at: due(-1) }),
      task({ id: 'today-local', due_at: '2026-10-22T23:00:00.000Z' }),
    ]
    const [winner] = rankCompanionTasks(list, now, 'America/Los_Angeles')
    expect(winner.task.id).toBe('today-local')
    expect(winner.score).toBe(95)
  })
})
