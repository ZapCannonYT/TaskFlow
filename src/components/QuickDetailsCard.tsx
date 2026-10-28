import { useState } from 'react'
import { CalendarDays, Repeat, Star } from 'lucide-react'
import type { Label, Task } from '../lib/supabase'
import { addLocalDays, dateForChoice, localDateInput, localTimeInput, middayOf, startOfLocalDay, startOfLocalWeek, withLocalTime } from '../lib/dates'
import { REPEAT_MENU, SIZE_MENU } from '../lib/taskOptions'
import { SelectMenu } from './SelectMenu'
import { TimePicker } from './TimePicker'
import { ReminderPicker } from './ReminderPicker'

type QuickDetailsCardProps = {
  task: Task
  labels: Label[]
  isOnline: boolean
  onUpdate(task: Task, values: Partial<Task>): void
  onFinish(skip: boolean): void
}

/** Rendered with `key={task.id}`, so the description draft starts fresh for each task. */
export function QuickDetailsCard({ task, labels, isOnline, onUpdate, onFinish }: QuickDetailsCardProps) {
  const [description, setDescription] = useState(task.description ?? '')
  const setRepeat = (value: string) => {
    const recurrence_rule = (value || null) as Task['recurrence_rule']
    onUpdate(task, {
      recurrence_rule,
      ...(recurrence_rule ? { due_is_approx: false, ...(!task.due_at ? { due_at: withLocalTime(dateForChoice('today').due_at, '12:00') } : {}) } : {}),
    })
  }
  return <section className="quick-details-card" aria-label="Quick details"><p className="eyebrow">Edit Inbox task</p><h2>{task.title}</h2><label className="description-field">Description<textarea aria-label="Description" maxLength={5000} disabled={!isOnline} value={description} placeholder="Add helpful context…" onChange={e => setDescription(e.target.value)} onBlur={() => { const next = description.trim(); if (next !== (task.description ?? '')) onUpdate(task, { description: next }) }}/></label>{task.due_at && task.due_is_approx && <div className="chip-row"><span className="chip-group-label">Choose a day</span>{Array.from({ length: 7 }, (_, index) => addLocalDays(startOfLocalWeek(new Date(task.due_at!)), index)).filter(day => day >= startOfLocalDay(new Date())).map(day => <button key={day.toISOString()} className="choice-chip" onClick={() => onUpdate(task, { due_at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString(), due_is_approx: false })}>{day.toLocaleDateString(undefined, { weekday: 'short' })} {day.getDate()}</button>)}</div>}
    <div className="chip-row"><label className="choice-chip date-chip"><CalendarDays size={14}/><span>When</span><input aria-label="When" type="date" value={localDateInput(task.due_at)} onChange={e => onUpdate(task, { due_at: e.target.value ? middayOf(e.target.value) : null, due_is_approx: false, recurrence_rule: e.target.value ? task.recurrence_rule : null })}/></label><TimePicker label="Due time" value={task.is_all_day ? '' : localTimeInput(task.due_at)} onChange={time => onUpdate(task, { ...(time ? { due_at: withLocalTime(task.due_at, time) } : {}), due_is_approx: false, is_all_day: !time })}/><SelectMenu label="Repeat" value={task.recurrence_rule ?? ''} options={REPEAT_MENU} active={Boolean(task.recurrence_rule)} icon={<Repeat size={13} aria-hidden="true"/>} display={task.recurrence_rule ? undefined : 'Repeat'} onChange={setRepeat}/><ReminderPicker offset={task.reminder_offset} minutes={task.reminder_minutes} disabled={!isOnline || !task.due_at || task.due_is_approx} onChange={values => onUpdate(task, values)}/><SelectMenu label="Size" value={task.size ?? ''} options={SIZE_MENU} active={Boolean(task.size)} display={task.size ? undefined : 'Size'} onChange={value => onUpdate(task, { size: (value || null) as Task['size'] })}/><button className={`choice-chip ${task.is_important ? 'starred' : ''}`} aria-pressed={task.is_important} onClick={() => onUpdate(task, { is_important: !task.is_important })}><Star size={15}/>Important</button><SelectMenu label="Label" value={task.label_id ?? ''} options={[{ value: '', label: 'No label' }, ...labels.map(label => ({ value: label.id, label: label.name }))]} active={Boolean(task.label_id)} display={task.label_id ? undefined : 'Label'} onChange={value => onUpdate(task, { label_id: value || null })}/></div><div className="quick-details-actions"><button className="text-button" onClick={() => onFinish(true)}>Skip</button><button className="primary-button" onClick={() => onFinish(false)}>Done</button></div></section>
}
