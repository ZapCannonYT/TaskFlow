import { memo, useMemo, type CSSProperties } from 'react'
import { Check, Circle } from 'lucide-react'
import type { Task } from '../lib/supabase'
import { HOUR_PX, layoutBlocks, visibleRange } from '../features/today/dayLayout'

type DayGridProps = {
  timed: Task[]
  now: Date | null
  nextTaskId?: string
  completingIds: ReadonlySet<string>
  settleIndexById: ReadonlyMap<string, number>
  isOnline: boolean
  onComplete(task: Task): void
  onOpen(task: Task): void
}
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })

export const DayGrid = memo(function DayGrid({ timed, now, nextTaskId, completingIds, settleIndexById, isOnline, onComplete, onOpen }: DayGridProps) {
  const blocks = useMemo(() => layoutBlocks(timed), [timed])
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : null
  const range = visibleRange(blocks, nowMin)
  if (!range) return null
  const { startHour, endHour } = range
  const height = (endHour - startHour) * HOUR_PX
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index)

  return <section className="day-grid" aria-label="Schedule">
    <div className="day-grid-body" style={{ height }}>
      {hours.map(hour => <div key={hour}>
        <div className="hour-line" style={{ top: (hour - startHour) * HOUR_PX }}/>
        <span className="hour-label" style={{ top: (hour - startHour) * HOUR_PX }} aria-hidden="true">{hourFmt.format(new Date(2000, 0, 1, hour % 24))}</span>
      </div>)}
      <div className="day-blocks">
        {blocks.map(block => {
          const task = block.task
          const completing = completingIds.has(task.id)
          const settle = settleIndexById.get(task.id)
          const top = ((block.startMin - startHour * 60) / 60) * HOUR_PX
          const blockHeight = ((block.visualEndMin - block.startMin) / 60) * HOUR_PX
          const style = {
            top, height: blockHeight - 2,
            left: `calc(${(block.col / block.cols) * 100}% + 2px)`,
            width: `calc(${100 / block.cols}% - 4px)`,
            '--settle-i': settle ?? 0,
          } as CSSProperties
          return <div key={task.id} style={style}
            className={`day-block ${task.is_important ? 'is-important' : ''} ${task.id === nextTaskId ? 'is-next' : ''} ${completing ? 'task-completing' : ''} ${settle !== undefined ? 'task-settling' : ''}`}>
            <button type="button" className="complete-button block-check" disabled={!isOnline}
              aria-label={completing ? `Undo completion of ${task.title}` : `Complete ${task.title}`} onClick={() => onComplete(task)}>
              {completing ? <Check size={16}/> : <Circle size={19}/>}
            </button>
            <button type="button" className="day-block-body" onClick={() => onOpen(task)} aria-label={`Open ${task.title}`}>
              <span className="task-title"><span className="task-title-text">{task.title}</span></span>
              <span className="day-block-time">{timeFmt.format(new Date(task.due_at!))}</span>
            </button>
          </div>
        })}
        {nowMin !== null && nowMin >= startHour * 60 && nowMin <= endHour * 60 &&
          <div className="now-line" style={{ top: ((nowMin - startHour * 60) / 60) * HOUR_PX }} aria-hidden="true"/>}
      </div>
    </div>
  </section>
})
