import { describe, expect, it } from 'vitest'
import type { Task } from '../../lib/supabase'
import { GAP_PX, HOUR_PX, layoutBlocks, layoutDay, shortTitle, splitDayTasks, titleLines, visibleRange, isTimed } from './dayLayout'

const localTime = (hour: number, minute = 0) => {
  const date = new Date(2026, 9, 25, hour, minute)
  return date.toISOString()
}
function task(id: string, time: string | null, options: Partial<Task> = {}): Task {
  return {
    id, user_id: 'u', title: id, status: 'open', due_at: time, due_is_approx: false, is_all_day: false,
    timezone: 'UTC', size: null, is_important: false, label_id: null, reminder_offset: 'none',
    created_at: '', updated_at: '', completed_at: null, deleted_at: null, ...options,
  }
}

describe('day layout', () => {
  it('identifies timed tasks and partitions without changing order', () => {
    const timed = task('timed', localTime(9))
    const anytime = task('all-day', localTime(10), { is_all_day: true })
    const rough = task('rough', localTime(11), { due_is_approx: true })
    const none = task('none', null)
    expect(isTimed(timed)).toBe(true)
    expect([anytime, rough, none].map(isTimed)).toEqual([false, false, false])
    expect(splitDayTasks([anytime, timed, rough, none])).toEqual({ timed: [timed], anytime: [anytime, rough, none] })
  })

  it('calculates default and sized durations', () => {
    const blocks = layoutBlocks([task('big', localTime(9), { size: 'big' }), task('default', localTime(13)), task('quick', localTime(17), { size: 'quick' })])
    expect(blocks[0]).toMatchObject({ col: 0, cols: 1, endMin: 720 })
    expect(blocks[1].endMin - blocks[1].startMin).toBe(45)
    expect(blocks[2].endMin - blocks[2].startMin).toBe(15)
  })

  it('keeps back-to-back short tasks in one column', () => {
    const blocks = layoutBlocks([task('a', localTime(9), { size: 'quick' }), task('b', localTime(9, 15), { size: 'quick' })])
    expect(blocks.map(block => [block.col, block.cols])).toEqual([[0, 1], [0, 1]])
  })

  it('places overlapping tasks in columns, including a chained overlap', () => {
    const overlap = layoutBlocks([task('a', localTime(9), { size: 'hour' }), task('b', localTime(9, 30), { size: 'hour' })])
    expect(overlap.map(block => [block.col, block.cols])).toEqual([[0, 2], [1, 2]])
    const chain = layoutBlocks([task('a', localTime(9), { size: 'hour' }), task('b', localTime(9, 30), { size: 'hour' }), task('c', localTime(10), { size: 'hour' })])
    expect(chain.map(block => [block.col, block.cols])).toEqual([[0, 2], [1, 2], [0, 2]])
  })

  it('resets columns for separate clusters', () => {
    expect(layoutBlocks([task('a', localTime(9)), task('b', localTime(14))]).map(block => block.cols)).toEqual([1, 1])
  })

  it('pads and bounds the visible range and includes now', () => {
    const blocks = layoutBlocks([task('early', localTime(9), { size: 'quick' }), task('late', localTime(14))])
    expect(visibleRange(blocks, null)).toEqual({ startHour: 8, endHour: 16 })
    expect(visibleRange(layoutBlocks([task('short', localTime(9), { size: 'quick' })]), null)).toEqual({ startHour: 8, endHour: 12 })
    expect(visibleRange([], 12 * 60)).toEqual({ startHour: 11, endHour: 15 })
    expect(visibleRange([], null)).toBeNull()
    for (const range of [visibleRange(blocks, null), visibleRange([], 0), visibleRange([], 24 * 60)]) {
      if (range) { expect(range.startHour).toBeGreaterThanOrEqual(0); expect(range.endHour).toBeLessThanOrEqual(25) }
    }
  })

  it('shortens titles to a few words', () => {
    expect(shortTitle('Call the bank about the card')).toBe('Call the bank…')
    expect(shortTitle('Gym')).toBe('Gym')
  })

  it('estimates more title lines for long titles in narrow columns', () => {
    expect(titleLines('Gym', 300)).toBe(1)
    expect(titleLines('Prepare the quarterly report draft and send it to the team for review', 160)).toBe(3)
  })

  it('stretches the axis so a short task fits its text and nothing overlaps', () => {
    const long = 'Prepare the quarterly report draft and send it to the team for review'
    const layout = layoutDay([task('a', localTime(9), { size: 'quick', title: long }), task('b', localTime(9, 15), { size: 'quick', title: long })], null, 400)!
    const [a, b] = layout.blocks
    expect(a.mode).toBe('full')
    expect(a.height).toBeGreaterThanOrEqual(a.need)
    expect(a.top + a.height).toBeLessThanOrEqual(b.top)
    expect(layout.height).toBeGreaterThan((layout.endHour - layout.startHour) * HOUR_PX)
    const ys = layout.hours.map(hour => hour.y)
    expect([...ys].sort((x, y) => x - y)).toEqual(ys)
  })

  it('leaves an uncrowded axis at the base scale', () => {
    const layout = layoutDay([task('a', localTime(9), { size: 'hour' })], null, 600)!
    expect(layout.height).toBe((layout.endHour - layout.startHour) * HOUR_PX)
    expect(layout.blocks[0].height).toBe(HOUR_PX - GAP_PX)
  })

  it('caps columns and compacts crowded clusters into a stacked last column', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e'].map(id => task(id, localTime(10), { size: 'hour', title: `${id} task with a fairly long title` }))
    const layout = layoutDay(tasks, null, 360)!
    expect(new Set(layout.blocks.map(block => block.cols))).toEqual(new Set([2]))
    const stacked = layout.blocks.filter(block => block.overflow)
    expect(stacked.length).toBe(4)
    expect(stacked.every(block => block.mode === 'compact' && block.col === 1)).toBe(true)
    for (let index = 1; index < stacked.length; index++) expect(stacked[index].top).toBeGreaterThanOrEqual(stacked[index - 1].top + stacked[index - 1].height)
    const desktop = layoutDay(tasks, null, 700)!
    expect(desktop.blocks.every(block => block.cols === 3 && block.mode === 'compact')).toBe(true)
  })
})
