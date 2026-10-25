import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { CalendarDays, Mic, MicOff, Plus, Star, Trash2, X } from 'lucide-react'
import type { Label, Task } from '../lib/supabase'
import { dateForChoice, type WhenChoice } from '../lib/dates'
import { parseNaturalTask } from '../lib/naturalTime'
import { isBasicTask } from '../lib/quickDetails'
import { useVoiceCapture } from '../features/voice/useVoiceCapture'
import { VoiceMeter } from '../features/voice/VoiceMeter'

export type DraftDetails = { due_at: string | null; due_is_approx: boolean; is_all_day: boolean; size: Task['size']; is_important: boolean; label_id: string | null; recurrence_rule: Task['recurrence_rule']; description: string; reminder_offset: Task['reminder_offset']; is_inbox: boolean }
export type ComposerHandle = { focus(): void; startVoice(): void; setTitle(value: string): void }
export type ComposerProps = {
  labels: Label[]
  isOnline: boolean
  busy: boolean
  onSubmit(title: string, draft: DraftDetails): Promise<boolean>
  onCreateLabel(name: string): Promise<void>
  onRenameLabel(label: Label, name: string): Promise<void>
  onDeleteLabel(label: Label): Promise<void>
}
const blankDetails = (): DraftDetails => ({ due_at: null, due_is_approx: false, is_all_day: true, size: null, is_important: false, label_id: null, recurrence_rule: null, description: '', reminder_offset: 'none', is_inbox: true })
function dateInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function timeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
function withTime(value: string | null, time: string) {
  const date = value ? new Date(value) : new Date(dateForChoice('today').due_at!)
  const [hours, minutes] = time.split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ labels, isOnline, busy, onSubmit, onCreateLabel, onRenameLabel, onDeleteLabel }, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState<DraftDetails>(blankDetails)
  const [labelEditor, setLabelEditor] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const onVoiceText = (text: string) => setTitle(text.slice(0, 500))
  const voice = useVoiceCapture({ isOnline, onText: onVoiceText })
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), startVoice: () => { void voice.start(title) }, setTitle: value => setTitle(value) }), [title, voice.start])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || busy || !isOnline) return
    const parsed = parseNaturalTask(title, draft.due_at)
    if (!parsed.title) return
    const submittedDraft = {
      ...draft,
      description: draft.description.trim(),
      ...(parsed.due_at ? { due_at: parsed.due_at, due_is_approx: false, is_all_day: parsed.has_time ? false : draft.is_all_day } : {}),
    }
    submittedDraft.is_inbox = isBasicTask(submittedDraft)
    const saved = await onSubmit(parsed.title, submittedDraft)
    if (saved) { setTitle(''); setDraft(blankDetails()); setLabelEditor(false); voice.reset() }
  }
  function setWhen(choice: WhenChoice) {
    if (draft.due_at && choice === 'today' && dateInput(draft.due_at) === dateInput(dateForChoice('today').due_at) && !draft.due_is_approx) {
      setDraft(current => ({ ...current, due_at: null, due_is_approx: false })); return
    }
    setDraft(current => ({ ...current, ...dateForChoice(choice) }))
  }
  function setRecurrence(rule: Task['recurrence_rule']) {
    setDraft(current => ({
      ...current,
      recurrence_rule: rule ?? null,
      due_at: rule && !current.due_at ? withTime(dateForChoice('today').due_at, '12:00') : current.due_at,
      due_is_approx: rule ? false : current.due_is_approx,
    }))
  }
  return <form className="composer" onSubmit={submit}>
    <div className="composer-field"><Plus className="composer-plus" size={19} aria-hidden="true"/><input ref={inputRef} aria-label="Add a task" aria-readonly={voice.state === 'listening'} readOnly={voice.state === 'listening'} placeholder="Add a task…" value={title} maxLength={500} onChange={event => setTitle(event.target.value)} disabled={!isOnline}/><button type="button" className={`icon-button voice-button ${voice.state === 'listening' ? 'listening' : ''}`} aria-label={voice.state === 'listening' ? 'Stop listening' : 'Add by voice'} disabled={!isOnline || voice.processing && voice.state !== 'listening'} onClick={() => voice.state === 'listening' ? voice.stop() : void voice.start(title)}>{voice.state === 'listening' ? <MicOff size={18}/> : <Mic size={18}/>}</button><button className="primary-button add-button" type="submit" disabled={!title.trim() || busy || !isOnline || voice.state === 'listening' || voice.state === 'transcribing' || voice.processing}>{!isOnline ? 'Offline' : busy ? 'Saving…' : voice.state === 'ready' && voice.hasTranscript ? 'Add task' : 'Add'}</button></div>
    {(voice.state !== 'idle' || voice.message || voice.modelStatus.state === 'downloading' || voice.modelStatus.state === 'error') && <div className="voice-panel"><div className="voice-status-row">{voice.state === 'listening' && <VoiceMeter meterRef={voice.meterRef}/>}<p className="voice-status" role="status">{voice.message || (voice.modelStatus.state === 'downloading' ? 'Downloading voice model… this may take a moment.' : voice.modelStatus.state === 'error' && voice.state === 'idle' ? 'Voice could not load. Tap the mic to retry, or type instead.' : '')}</p>{voice.processing && <button type="button" className="text-button" onClick={voice.cancelTranscription}>Stop transcription</button>}</div></div>}
    {title.length > 0 && <div className="composer-options">
      <div className="chip-row" aria-label="When"><span className="chip-group-label">When</span>{([['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['next-week', 'Next week']] as const).map(([key, label]) => <button type="button" disabled={!isOnline} key={key} className={`choice-chip ${draft.due_at && ((key === 'today' && !draft.due_is_approx && dateInput(draft.due_at) === dateInput(dateForChoice('today').due_at)) || (key === 'tomorrow' && !draft.due_is_approx && dateInput(draft.due_at) === dateInput(dateForChoice('tomorrow').due_at)) || (key === 'weekend' && draft.due_is_approx && dateInput(draft.due_at) === dateInput(dateForChoice('weekend').due_at)) || (key === 'next-week' && draft.due_is_approx && dateInput(draft.due_at) === dateInput(dateForChoice('next-week').due_at))) ? 'active' : ''}`} onClick={() => setWhen(key)}>{label}</button>)}</div>
      <div className="chip-row detail-row"><label className={`choice-chip date-chip ${draft.due_at && !draft.due_is_approx ? 'active' : ''}`}><CalendarDays size={14}/><span>Pick date</span><input aria-label="Pick date" type="date" disabled={!isOnline} value={dateInput(draft.due_at)} onChange={event => setDraft(current => ({ ...current, due_at: event.target.value ? withTime(new Date(`${event.target.value}T12:00:00`).toISOString(), timeInput(current.due_at) || '12:00') : null, due_is_approx: false, recurrence_rule: event.target.value ? current.recurrence_rule : null }))}/></label><label className="select-chip due-time-chip"><span>Due time</span><input aria-label="Due time" type="time" disabled={!isOnline} value={draft.is_all_day ? "" : timeInput(draft.due_at)} onChange={event => setDraft(current => ({ ...current, due_at: event.target.value ? withTime(current.due_at, event.target.value) : current.due_at, due_is_approx: event.target.value ? false : current.due_is_approx, is_all_day: !event.target.value }))}/></label><label className="select-chip"><span className="sr-only">Size</span><select aria-label="Size" value={draft.size ?? ''} disabled={!isOnline} onChange={event => setDraft(current => ({ ...current, size: (event.target.value || null) as Task['size'] }))}><option value="">Size</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label><label className="select-chip"><span className="sr-only">Repeat</span><select aria-label="Repeat" value={draft.recurrence_rule ?? ''} disabled={!isOnline} onChange={event => setRecurrence((event.target.value || null) as Task['recurrence_rule'])}><option value="">Never</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="select-chip"><span className="sr-only">Reminder</span><select aria-label="Reminder" value={draft.reminder_offset} disabled={!isOnline || !draft.due_at || draft.due_is_approx} onChange={event => setDraft(current => ({ ...current, reminder_offset: event.target.value as Task['reminder_offset'] }))}><option value="none">No reminder</option><option value="at_time">At due time</option><option value="1_day_before">1 day before</option><option value="2_days_before">2 days before</option></select></label><button type="button" disabled={!isOnline} className={`choice-chip icon-chip ${draft.is_important ? 'starred' : ''}`} aria-label={draft.is_important ? 'Remove Important' : 'Mark Important'} aria-pressed={draft.is_important} onClick={() => setDraft(current => ({ ...current, is_important: !current.is_important }))}><Star size={15}/>Important</button><label className="select-chip label-select"><span className="sr-only">Label</span><select aria-label="Label" value={draft.label_id ?? ''} disabled={!isOnline} onChange={event => setDraft(current => ({ ...current, label_id: event.target.value || null }))}><option value="">Label</option>{labels.map(label => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label><button type="button" className="text-button manage-labels" disabled={!isOnline} onClick={() => setLabelEditor(open => !open)}>Edit labels</button></div>
      <label className="description-field">Description<textarea aria-label="Description" maxLength={5000} disabled={!isOnline} value={draft.description} placeholder="Add a description or helpful context…" onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}/></label>
      {labelEditor && <div className="label-manager"><div className="label-form"><label htmlFor="new-label">New label</label><input id="new-label" disabled={!isOnline} value={newLabel} maxLength={32} onChange={event => setNewLabel(event.target.value)} placeholder="Label name"/><button type="button" disabled={!isOnline} className="secondary-button" onClick={() => { const name = newLabel.trim(); if (name) void onCreateLabel(name).then(() => setNewLabel('')) }}>Add label</button><button type="button" className="icon-button" aria-label="Close label editor" onClick={() => setLabelEditor(false)}><X size={16}/></button></div><div className="label-list">{labels.map(label => <div className="label-admin-row" key={label.id}><span className="label-tag">{label.name}</span><input aria-label={`Rename ${label.name}`} disabled={!isOnline} defaultValue={label.name} maxLength={32} onBlur={event => void onRenameLabel(label, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/><button disabled={!isOnline} className="icon-button" aria-label={`Remove label ${label.name}`} onClick={() => void onDeleteLabel(label)}><Trash2 size={15}/></button></div>)}</div></div>}
    </div>}
  </form>
})
