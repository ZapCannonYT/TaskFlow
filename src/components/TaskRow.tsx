import { memo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronUp, Circle, Clock3, Star, Trash2 } from 'lucide-react'
import type { Label, Task } from '../lib/supabase'

export type TaskRowProps = {
  task: Task
  labels: Label[]
  listName: string
  isOnline: boolean
  expanded: boolean
  isNew: boolean
  isCompleting: boolean
  onToggleExpand(id: string): void
  onComplete(task: Task): void
  onUpdate(task: Task, values: Partial<Task>): void
  onRemove(task: Task): void
}
function localDateInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function localTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
function withTime(value: string | null, time: string) {
  const date = value ? new Date(value) : new Date()
  const [hours, minutes] = time.split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}
type RowWindow = Window & { __rowRenders?: number }

export const TaskRow = memo(function TaskRow({ task, labels, listName, isOnline, expanded, isNew, isCompleting, onToggleExpand, onComplete, onUpdate, onRemove }: TaskRowProps) {
  const [editingTitle, setEditingTitle] = useState(task.title)
  if (import.meta.env.DEV) {
    const debugWindow = window as RowWindow
    debugWindow.__rowRenders = (debugWindow.__rowRenders ?? 0) + 1
  }
  const toggleExpanded = () => { if (!expanded) setEditingTitle(task.title); onToggleExpand(task.id) }
  return <article className={`task-card ${task.status === 'completed' ? 'is-complete' : ''} ${isNew ? 'task-entering' : ''} ${isCompleting ? 'task-completing' : ''}`}>
    <div className="task-main"><button className={`complete-button ${task.status === 'completed' || isCompleting ? 'checked' : ''} ${listName === 'Done' && task.status === 'completed' ? 'done-undo-button' : ''}`} aria-label={task.status === 'completed' ? `Undo completion of ${task.title}` : `Complete ${task.title}`} disabled={!isOnline} onClick={() => onComplete(task)}>{task.status === 'completed' || isCompleting ? <>{listName === 'Done' && <span>Undo</span>}<Check size={17}/></> : <Circle size={21}/>}</button>
      <button className="task-title-button" onClick={toggleExpanded} aria-expanded={expanded}><span className="task-title">{task.title}</span><span className="task-meta">{task.due_at && <span className={`row-tag ${task.due_is_approx ? 'rough-tag' : ''}`}><CalendarDays size={12}/>{task.due_is_approx ? 'Around ' : ''}{new Date(task.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}{task.due_at && <span className="row-tag"><Clock3 size={12}/>{localTimeInput(task.due_at)}</span>}{task.size && <span className="row-tag">{task.size === 'quick' ? 'Quick' : task.size === 'hour' ? 'An hour' : 'Big'}</span>}{task.reminder_offset !== 'none' && <span className="row-tag"><Clock3 size={12}/>{task.reminder_offset === 'at_time' ? 'Reminder' : task.reminder_offset === '1_day_before' ? '1 day before' : '2 days before'}</span>}{task.is_important && <span className="important-tag"><Star size={12}/>Important</span>}{task.labels?.name && <span className="label-tag">{task.labels.name}</span>}</span></button>
      <button className="icon-button expand-button" aria-label={expanded ? 'Close task details' : 'Edit task details'} onClick={toggleExpanded}>{expanded ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}</button><button className="icon-button remove-button" aria-label={`Remove ${task.title}`} disabled={!isOnline} onClick={() => onRemove(task)}><Trash2 size={16}/></button>
    </div>
    {expanded && <div className="task-editor"><label className="edit-title-label">Title<input disabled={!isOnline} value={editingTitle} maxLength={500} onChange={event => setEditingTitle(event.target.value)} onBlur={() => { const next = editingTitle.trim(); if (next && next !== task.title) onUpdate(task, { title: next }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setEditingTitle(task.title); onToggleExpand(task.id) } }}/></label><label className="edit-select">When<input disabled={!isOnline} type="date" value={localDateInput(task.due_at)} onChange={event => onUpdate(task, { due_at: event.target.value ? withTime(new Date(`${event.target.value}T12:00:00`).toISOString(), localTimeInput(task.due_at) || '12:00') : null, due_is_approx: false })}/></label><label className="edit-select">Due time<input disabled={!isOnline || !task.due_at} type="time" value={localTimeInput(task.due_at)} onChange={event => event.target.value && onUpdate(task, { due_at: withTime(task.due_at, event.target.value), due_is_approx: false })}/></label><label className="edit-select">Size<select disabled={!isOnline} value={task.size ?? ''} onChange={event => onUpdate(task, { size: (event.target.value || null) as Task['size'] })}><option value="">Not set</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label><label className="edit-select">Label<select disabled={!isOnline} value={task.label_id ?? ''} onChange={event => onUpdate(task, { label_id: event.target.value || null })}><option value="">No label</option>{labels.map(label => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label><label className="edit-select">Remind me<select disabled={!isOnline || !task.due_at || task.due_is_approx} value={task.reminder_offset} onChange={event => onUpdate(task, { reminder_offset: event.target.value as Task['reminder_offset'] })}><option value="none">No reminder</option><option value="at_time">At my reminder time</option><option value="1_day_before">A day before</option><option value="2_days_before">Two days before</option></select></label><button disabled={!isOnline} className={`choice-chip icon-chip ${task.is_important ? 'starred' : ''}`} aria-pressed={task.is_important} onClick={() => onUpdate(task, { is_important: !task.is_important })}><Star size={15}/>Important</button></div>}
  </article>
})
