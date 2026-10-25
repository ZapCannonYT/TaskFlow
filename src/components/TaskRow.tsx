import { memo, useState, type CSSProperties } from 'react'
import { Bell, CalendarDays, Check, ChevronDown, ChevronUp, Circle, Clock3, Repeat, Star, Trash2 } from 'lucide-react'
import type { Label, Task } from '../lib/supabase'
import { localDateInput, localTimeInput, withLocalTime } from '../lib/dates'
import { reminderLabel } from '../lib/reminders'
import { ReminderPicker } from './ReminderPicker'

export type TaskRowProps = {
  task: Task
  labels: Label[]
  listName: string
  isOnline: boolean
  expanded: boolean
  isNew: boolean
  isCompleting: boolean
  isSettling: boolean
  settleIndex: number
  onToggleExpand(id: string): void
  onComplete(task: Task): void
  onUpdate(task: Task, values: Partial<Task>): void
  onRemove(task: Task): void
}
type RowWindow = Window & { __rowRenders?: number }
const recurrenceLabel = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' } as const

export const TaskRow = memo(function TaskRow({ task, labels, listName, isOnline, expanded, isNew, isCompleting, isSettling, settleIndex, onToggleExpand, onComplete, onUpdate, onRemove }: TaskRowProps) {
  const [editingTitle, setEditingTitle] = useState(task.title)
  const [editingDescription, setEditingDescription] = useState(task.description ?? '')
  if (import.meta.env.DEV) {
    const debugWindow = window as RowWindow
    debugWindow.__rowRenders = (debugWindow.__rowRenders ?? 0) + 1
  }
  const toggleExpanded = () => { if (!expanded) { setEditingTitle(task.title); setEditingDescription(task.description ?? '') } onToggleExpand(task.id) }
  return <article className={`task-card ${task.status === 'completed' ? 'is-complete' : ''} ${isNew ? 'task-entering' : ''} ${isCompleting ? 'task-completing' : ''} ${isSettling ? 'task-settling' : ''}`} style={isSettling ? ({ '--settle-i': settleIndex } as CSSProperties) : undefined}>
    <div className="task-main"><button className={`complete-button ${task.status === 'completed' || isCompleting ? 'checked' : ''} ${listName === 'Done' && task.status === 'completed' ? 'done-undo-button' : ''}`} aria-label={task.status === 'completed' || isCompleting ? `Undo completion of ${task.title}` : `Complete ${task.title}`} disabled={!isOnline} onClick={() => onComplete(task)}>{task.status === 'completed' || isCompleting ? <>{listName === 'Done' && <span>Undo</span>}<Check size={17}/></> : <Circle size={21}/>}</button>
      <button className="task-title-button" onClick={toggleExpanded} aria-expanded={expanded}><span className="task-title"><span className="task-title-text">{task.title}</span></span><span className="task-meta">{task.due_at && <span className={`row-tag ${task.due_is_approx ? 'rough-tag' : ''}`}><CalendarDays size={12}/>{task.due_is_approx ? 'Around ' : ''}{new Date(task.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}{task.due_at && !task.is_all_day && <span className="row-tag"><Clock3 size={12}/>{localTimeInput(task.due_at)}</span>}{task.recurrence_rule && <span className="row-tag"><Repeat size={12}/>{recurrenceLabel[task.recurrence_rule]}</span>}{task.size && <span className="row-tag">{task.size === 'quick' ? 'Quick' : task.size === 'hour' ? 'An hour' : 'Big'}</span>}{task.reminder_offset !== 'none' && <span className="row-tag"><Bell size={12}/>{reminderLabel(task)}</span>}{task.is_important && <span className="important-tag"><Star size={12}/>Important</span>}{task.labels?.name && <span className="label-tag">{task.labels.name}</span>}</span></button>
      <button className="icon-button expand-button" aria-label={expanded ? 'Close task details' : 'Edit task details'} onClick={toggleExpanded}>{expanded ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}</button><button className="icon-button remove-button" aria-label={`Remove ${task.title}`} disabled={!isOnline} onClick={() => onRemove(task)}><Trash2 size={16}/></button>
    </div>
    {expanded && <div className="task-editor"><label className="edit-title-label">Title<input disabled={!isOnline} value={editingTitle} maxLength={500} onChange={event => setEditingTitle(event.target.value)} onBlur={() => { const next = editingTitle.trim(); if (next && next !== task.title) onUpdate(task, { title: next }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setEditingTitle(task.title); onToggleExpand(task.id) } }}/></label><label className="description-field">Description<textarea disabled={!isOnline} maxLength={5000} value={editingDescription} onChange={event => setEditingDescription(event.target.value)} onBlur={() => { const next = editingDescription.trim(); if (next !== (task.description ?? "")) onUpdate(task, { description: next }) }}/></label><label className="edit-select">When<input disabled={!isOnline} type="date" value={localDateInput(task.due_at)} onChange={event => onUpdate(task, { due_at: event.target.value ? withLocalTime(new Date(`${event.target.value}T12:00:00`).toISOString(), localTimeInput(task.due_at) || '12:00', new Date()) : null, due_is_approx: false, recurrence_rule: event.target.value ? task.recurrence_rule : null })}/></label><label className="edit-select">Due time<input disabled={!isOnline || !task.due_at} type="time" value={localTimeInput(task.due_at)} onChange={event => onUpdate(task, { ...(event.target.value ? { due_at: withLocalTime(task.due_at, event.target.value, new Date()) } : {}), due_is_approx: false, is_all_day: !event.target.value })}/></label><label className="edit-select" title="Never means this task will not repeat.">Repeat<select disabled={!isOnline} value={task.recurrence_rule ?? ''} onChange={event => { const recurrence_rule = (event.target.value || null) as Task['recurrence_rule']; onUpdate(task, { recurrence_rule, ...(recurrence_rule ? { due_is_approx: false, ...(!task.due_at ? { due_at: withLocalTime(new Date().toISOString(), '12:00', new Date()) } : {}) } : {}) }) }}><option value="">Never</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="edit-select">Size<select disabled={!isOnline} value={task.size ?? ''} onChange={event => onUpdate(task, { size: (event.target.value || null) as Task['size'] })}><option value="">Not set</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label><label className="edit-select">Label<select disabled={!isOnline} value={task.label_id ?? ''} onChange={event => onUpdate(task, { label_id: event.target.value || null })}><option value="">No label</option>{labels.map(label => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label><ReminderPicker variant="field" offset={task.reminder_offset} minutes={task.reminder_minutes} disabled={!isOnline || !task.due_at || task.due_is_approx} onChange={values => onUpdate(task, values)}/><button disabled={!isOnline} className={`choice-chip icon-chip ${task.is_important ? 'starred' : ''}`} aria-pressed={task.is_important} onClick={() => onUpdate(task, { is_important: !task.is_important })}><Star size={15}/>Important</button></div>}
  </article>
})
