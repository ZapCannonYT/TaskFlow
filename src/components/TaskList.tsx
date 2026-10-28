import { useEffect, type ReactNode } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { moveOnly } from '../lib/listMotion'

type TaskListProps = {
  label: string
  /** Off while a completed row collapses: that collapse animates itself, and moving the rows too would jitter. */
  animate: boolean
  children: ReactNode
}

/** A list of task rows whose rows glide, rather than jump, when their order changes. */
export function TaskList({ label, animate, children }: TaskListProps) {
  const [ref, setEnabled] = useAutoAnimate<HTMLElement>(moveOnly)
  useEffect(() => setEnabled(animate), [animate, setEnabled])
  return <section ref={ref} className="task-list" aria-label={label}>{children}</section>
}
