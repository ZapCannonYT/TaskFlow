import type { Task } from '../../lib/supabase'

export const HOUR_PX = 56
export const MIN_BLOCK_PX = 40
export const MIN_VISUAL_MIN = Math.ceil((MIN_BLOCK_PX / HOUR_PX) * 60)
export const DURATION_MIN = { quick: 15, hour: 60, big: 180 } as const
export const DEFAULT_DURATION_MIN = 45
export const RANGE_PAD_HOURS = 1
export const MIN_SPAN_HOURS = 4

export type DayBlock = { task: Task; startMin: number; endMin: number; visualEndMin: number; col: number; cols: number }

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

/** Tasks that overlap in time share the available columns. */
export function layoutBlocks(timed: Task[]): DayBlock[] {
  const items: DayBlock[] = timed.map(task => {
    const startMin = minutesIntoDay(task.due_at!)
    const duration = task.size ? DURATION_MIN[task.size] : DEFAULT_DURATION_MIN
    const endMin = Math.min(startMin + duration, 24 * 60)
    const visualEndMin = Math.max(endMin, startMin + MIN_VISUAL_MIN)
    return { task, startMin, endMin, visualEndMin, col: 0, cols: 1 }
  }).sort((a, b) => a.startMin - b.startMin || b.visualEndMin - a.visualEndMin || a.task.id.localeCompare(b.task.id))

  let cluster: DayBlock[] = []
  let clusterEnd = -1
  let colEnds: number[] = []
  const closeCluster = () => { for (const block of cluster) block.cols = colEnds.length; cluster = []; colEnds = []; clusterEnd = -1 }

  for (const block of items) {
    if (cluster.length && block.startMin >= clusterEnd) closeCluster()
    let col = colEnds.findIndex(end => end <= block.startMin)
    if (col === -1) { col = colEnds.length; colEnds.push(block.visualEndMin) } else colEnds[col] = block.visualEndMin
    block.col = col
    cluster.push(block)
    clusterEnd = Math.max(clusterEnd, block.visualEndMin)
  }
  closeCluster()
  return items
}

/** Draw only the task span, padded, instead of a full 24-hour grid. */
export function visibleRange(blocks: DayBlock[], nowMin: number | null): { startHour: number; endHour: number } | null {
  const points = blocks.flatMap(block => [block.startMin, block.visualEndMin])
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
