import type { Task } from '../../lib/supabase'

export const HOUR_PX = 56
export const DURATION_MIN = { quick: 15, hour: 60, big: 180 } as const
export const DEFAULT_DURATION_MIN = 45
export const RANGE_PAD_HOURS = 1
export const MIN_SPAN_HOURS = 4
export const GAP_PX = 2
export const MAX_TITLE_LINES = 3
export const COMPACT_MIN_COL_PX = 140
const LINE_PX = 18
const TIME_PX = 16
const PAD_PX = 16
const CHECK_PX = 40
const COMPACT_PX = 30
const CHAR_PX = 7.2
// Border, check button and padding inside a block, so only the rest holds title text.
const BLOCK_CHROME_PX = 51

export type DayBlock = { task: Task; startMin: number; endMin: number; col: number; cols: number; cluster: number }
export type BlockMode = 'full' | 'compact'
export type PlacedBlock = DayBlock & { mode: BlockMode; overflow: boolean; need: number; top: number; height: number }
export type DayLayout = { blocks: PlacedBlock[]; hours: { hour: number; y: number }[]; height: number; startHour: number; endHour: number; yAt(min: number): number }

export const isTimed = (task: Task) => Boolean(task.due_at) && !task.is_all_day && !task.due_is_approx

export function minutesIntoDay(iso: string): number {
  const date = new Date(iso)
  return date.getHours() * 60 + date.getMinutes()
}

export function splitDayTasks(tasks: Task[]): { timed: Task[]; anytime: Task[] } {
  const timed: Task[] = []
  const anytime: Task[] = []
  for (const task of tasks) (isTimed(task) ? timed : anytime).push(task)
  return { timed, anytime }
}

/** First few words of a title, for blocks too crowded to show it in full. */
export function shortTitle(title: string, words = 3): string {
  const parts = title.trim().split(/\s+/)
  const short = parts.slice(0, words).join(' ')
  return parts.length > words ? `${short}…` : short
}

/** Tasks that overlap in time share the available columns. */
export function layoutBlocks(timed: Task[]): DayBlock[] {
  const items: DayBlock[] = timed.map(task => {
    const startMin = minutesIntoDay(task.due_at!)
    const duration = task.size ? DURATION_MIN[task.size] : DEFAULT_DURATION_MIN
    const endMin = Math.min(startMin + duration, 24 * 60)
    return { task, startMin, endMin, col: 0, cols: 1, cluster: 0 }
  }).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.task.id.localeCompare(b.task.id))

  let cluster: DayBlock[] = []
  let clusterIndex = 0
  let clusterEnd = -1
  let colEnds: number[] = []
  const closeCluster = () => { for (const block of cluster) block.cols = colEnds.length; cluster = []; colEnds = []; clusterEnd = -1; clusterIndex++ }

  for (const block of items) {
    if (cluster.length && block.startMin >= clusterEnd) closeCluster()
    let col = colEnds.findIndex(end => end <= block.startMin)
    if (col === -1) { col = colEnds.length; colEnds.push(block.endMin) } else colEnds[col] = block.endMin
    block.col = col
    block.cluster = clusterIndex
    cluster.push(block)
    clusterEnd = Math.max(clusterEnd, block.endMin)
  }
  if (cluster.length) closeCluster()
  return items
}

/** Draw only the task span, padded, instead of a full 24-hour grid. */
export function visibleRange(blocks: DayBlock[], nowMin: number | null): { startHour: number; endHour: number } | null {
  const points = blocks.flatMap(block => [block.startMin, block.endMin])
  if (nowMin !== null) points.push(nowMin)
  if (!points.length) return null
  let startHour = Math.max(0, Math.floor(Math.min(...points) / 60) - RANGE_PAD_HOURS)
  let endHour = Math.min(25, Math.ceil(Math.max(...points) / 60) + RANGE_PAD_HOURS)
  if (endHour - startHour < MIN_SPAN_HOURS) {
    endHour = Math.min(25, startHour + MIN_SPAN_HOURS)
    startHour = Math.max(0, endHour - MIN_SPAN_HOURS)
  }
  return { startHour, endHour }
}

export const maxColumns = (width: number) => width < 480 ? 2 : 3

export function titleLines(title: string, colWidth: number): number {
  // Word wrapping leaves ragged line ends, so count on ~85% of the line being used.
  const perLine = Math.max(6, Math.floor(((colWidth - BLOCK_CHROME_PX) / CHAR_PX) * 0.85))
  return Math.min(MAX_TITLE_LINES, Math.max(1, Math.ceil(title.length / perLine)))
}

export function blockNeed(mode: BlockMode, title: string, colWidth: number): number {
  if (mode === 'compact') return COMPACT_PX
  return Math.max(CHECK_PX, PAD_PX + titleLines(title, colWidth) * LINE_PX + TIME_PX)
}

/**
 * Lay the day out on a time axis that stretches where a block needs more room
 * than its duration gives it, so text is never clipped. Clusters wider than the
 * column cap stack their extra tasks, compacted, in the last column.
 */
export function layoutDay(timed: Task[], nowMin: number | null, width: number): DayLayout | null {
  const base = layoutBlocks(timed)
  const range = visibleRange(base, nowMin)
  if (!range) return null
  const { startHour, endHour } = range
  const cap = maxColumns(width)

  const blocks: PlacedBlock[] = base.map(block => {
    const overflow = block.cols > cap && block.col >= cap - 1
    const cols = Math.min(block.cols, cap)
    const colWidth = width / cols
    const mode: BlockMode = overflow || cols >= 3 || colWidth < COMPACT_MIN_COL_PX ? 'compact' : 'full'
    return { ...block, col: Math.min(block.col, cap - 1), cols, overflow, mode, need: blockNeed(mode, block.task.title, colWidth), top: 0, height: 0 }
  })

  const constraints: { s: number; e: number; need: number }[] = []
  const stacks = new Map<number, PlacedBlock[]>()
  for (const block of blocks) {
    if (!block.overflow) constraints.push({ s: block.startMin, e: block.endMin, need: block.need + GAP_PX })
    else stacks.set(block.cluster, [...stacks.get(block.cluster) ?? [], block])
  }
  for (const [cluster, stack] of stacks) {
    const clusterEnd = Math.max(...blocks.filter(block => block.cluster === cluster).map(block => block.endMin))
    stack.sort((a, b) => a.startMin - b.startMin)
    // Everything stacked from each item onward must fit before the cluster ends.
    for (let index = 0; index < stack.length; index++) {
      const rest = stack.slice(index).reduce((sum, block) => sum + block.need + GAP_PX, 0)
      constraints.push({ s: stack[index].startMin, e: Math.max(clusterEnd, stack[index].startMin + 1), need: rest })
    }
  }

  const lo = startHour * 60
  const hi = endHour * 60
  const clamp = (min: number) => Math.min(hi, Math.max(lo, min))
  const points = [...new Set([
    ...Array.from({ length: endHour - startHour + 1 }, (_, index) => (startHour + index) * 60),
    ...constraints.flatMap(c => [clamp(c.s), clamp(c.e)]),
  ])].sort((a, b) => a - b)
  const seg = points.slice(1).map((point, index) => ((point - points[index]) / 60) * HOUR_PX)
  const baseSeg = [...seg]
  const segRange = (s: number, e: number) => {
    const from = points.indexOf(clamp(s))
    const to = points.indexOf(clamp(e))
    return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index)
  }

  constraints.sort((a, b) => a.e - b.e || a.s - b.s)
  for (const constraint of constraints) {
    const indices = segRange(constraint.s, constraint.e)
    if (!indices.length) continue
    const length = indices.reduce((sum, index) => sum + seg[index], 0)
    if (length >= constraint.need) continue
    const deficit = constraint.need - length
    const baseTotal = indices.reduce((sum, index) => sum + baseSeg[index], 0)
    for (const index of indices) seg[index] += deficit * (baseTotal ? baseSeg[index] / baseTotal : 1 / indices.length)
  }

  const offsets = [0]
  for (const length of seg) offsets.push(offsets[offsets.length - 1] + length)
  const yAt = (min: number) => {
    const value = clamp(min)
    let index = points.findIndex((_, i) => i < points.length - 1 && value <= points[i + 1])
    if (index === -1) index = points.length - 2
    const span = points[index + 1] - points[index]
    return offsets[index] + (span ? ((value - points[index]) / span) * seg[index] : 0)
  }

  for (const block of blocks) {
    if (block.overflow) continue
    block.top = yAt(block.startMin)
    block.height = yAt(block.endMin) - block.top - GAP_PX
  }
  for (const stack of stacks.values()) {
    let cursor = Number.NEGATIVE_INFINITY
    for (const block of stack) {
      block.top = Math.max(yAt(block.startMin), cursor)
      block.height = block.need
      cursor = block.top + block.need + GAP_PX
    }
  }

  return {
    blocks,
    hours: Array.from({ length: endHour - startHour + 1 }, (_, index) => ({ hour: startHour + index, y: yAt((startHour + index) * 60) })),
    height: yAt(hi),
    startHour,
    endHour,
    yAt,
  }
}
