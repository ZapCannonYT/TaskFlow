import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, Circle } from 'lucide-react'
import type { Task } from '../lib/supabase'
import { layoutDay, shortTitle } from '../features/today/dayLayout'
import { colorVar } from '../lib/colors'

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
const LABEL_GUTTER_PX = 52

export const DayGrid = memo(function DayGrid({ timed, now, nextTaskId, completingIds, settleIndexById, isOnline, onComplete, onOpen }: DayGridProps) {
  const gridRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = () => setWidth(Math.max(0, grid.getBoundingClientRect().width - LABEL_GUTTER_PX))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : null
  const layout = useMemo(() => layoutDay(timed, nowMin, width), [timed, nowMin, width])

  return <section className="day-grid" aria-label="Schedule" ref={gridRef}>
    {layout && <div className="day-grid-body" style={{ height: layout.height }}>
      {layout.hours.map(({ hour, y }) => <div key={hour}>
        <div className="hour-line" style={{ top: y }}/>
        <span className="hour-label" style={{ top: y }} aria-hidden="true">{hourFmt.format(new Date(2000, 0, 1, hour % 24))}</span>
      </div>)}
      <div className="day-blocks">
        {layout.blocks.map(block => {
          const task = block.task
          const completing = completingIds.has(task.id)
          const settle = settleIndexById.get(task.id)
          const compact = block.mode === 'compact'
          const style = {
            top: block.top, height: block.height,
            left: `calc(${(block.col / block.cols) * 100}% + 2px)`,
            width: `calc(${100 / block.cols}% - 4px)`,
            '--settle-i': settle ?? 0,
            ...(task.color ? { '--task-color': colorVar(task.color) } : {}),
          } as CSSProperties
          const time = timeFmt.format(new Date(task.due_at!))
          return <div key={task.id} style={style} title={compact ? `${task.title} · ${time}` : undefined}
            className={`day-block ${task.color ? 'has-color' : ''} ${compact ? 'compact' : ''} ${task.is_important ? 'is-important' : ''} ${task.id === nextTaskId ? 'is-next' : ''} ${completing ? 'task-completing' : ''} ${settle !== undefined ? 'task-settling' : ''}`}>
            <button type="button" className="complete-button block-check" disabled={!isOnline}
              aria-label={completing ? `Undo completion of ${task.title}` : `Complete ${task.title}`} onClick={() => onComplete(task)}>
              {completing ? <Check size={compact ? 14 : 16}/> : <Circle size={compact ? 16 : 19}/>}
            </button>
            <button type="button" className="day-block-body" onClick={() => onOpen(task)} aria-label={`Open ${task.title}, ${time}`}>
              <span className="task-title"><span className="task-title-text">{compact ? shortTitle(task.title) : task.title}</span></span>
              {!compact && <span className="day-block-time">{time}</span>}
            </button>
          </div>
        })}
        {nowMin !== null && nowMin >= layout.startHour * 60 && nowMin <= layout.endHour * 60 &&
          <div className="now-line" style={{ top: layout.yAt(nowMin) }} aria-hidden="true"/>}
      </div>
    </div>}
  </section>
})
