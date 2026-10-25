import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { CalendarDays, Clock3, Mic, MicOff, Plus, Repeat, Star, Trash2, X } from 'lucide-react'
import type { Label, Task } from '../lib/supabase'
import { dateForChoice, type WhenChoice } from '../lib/dates'
import { parseNaturalTask } from '../lib/naturalTime'
import { isBasicTask } from '../lib/quickDetails'
import { useVoiceCapture } from '../features/voice/useVoiceCapture'
import { VoiceMeter } from '../features/voice/VoiceMeter'
import { ReminderPicker } from './ReminderPicker'

export type DraftDetails = { due_at: string | null; due_is_approx: boolean; is_all_day: boolean; size: Task['size']; is_important: boolean; label_id: string | null; recurrence_rule: Task['recurrence_rule']; description: string; reminder_offset: Task['reminder_offset']; reminder_minutes: number | null; is_inbox: boolean }
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
const blankDetails = (): DraftDetails => ({ due_at: null, due_is_approx: false, is_all_day: true, size: null, is_important: false, label_id: null, recurrence_rule: null, description: '', reminder_offset: '1_hour_before', reminder_minutes: null, is_inbox: true })
const WHEN_CHOICES: ReadonlyArray<readonly [WhenChoice, string]> = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['next-week', 'Next week']]
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
/** Which preset (if any) the draft's date matches, so the When select can show it. */
function whenValue(draft: DraftDetails): string {
  if (!draft.due_at) return ''
  const preset = WHEN_CHOICES.find(([key]) => {
    const choice = dateForChoice(key)
    return Boolean(choice.due_is_approx) === draft.due_is_approx && dateInput(choice.due_at) === dateInput(draft.due_at)
  })
  return preset ? preset[0] : 'date'
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ labels, isOnline, busy, onSubmit, onCreateLabel, onRenameLabel, onDeleteLabel }, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState<DraftDetails>(blankDetails)
  const [labelEditor, setLabelEditor] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [hideTranscriptNotice, setHideTranscriptNotice] = useState(false)
  const onVoiceText = (text: string) => setTitle(text.slice(0, 500))
  const voice = useVoiceCapture({ isOnline, onText: onVoiceText })
  useEffect(() => {
    if (voice.state !== 'ready' || !voice.hasTranscript || !voice.message.startsWith('Transcript ready')) { setHideTranscriptNotice(false); return }
    setHideTranscriptNotice(false)
    const timer = window.setTimeout(() => setHideTranscriptNotice(true), 4500)
    return () => window.clearTimeout(timer)
  }, [voice.state, voice.hasTranscript, voice.message])
  const voiceMessage = hideTranscriptNotice ? '' : voice.message
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), startVoice: () => { void voice.start(title) }, setTitle: value => setTitle(value) }), [title, voice.start])

  const when = whenValue(draft)
  const hasTime = Boolean(draft.due_at && !draft.is_all_day)
  const showSecondRow = Boolean(draft.due_at || draft.size || hasTime)

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
    if (saved) { setTitle(''); setDraft(blankDetails()); setLabelEditor(false); setNoteOpen(false); voice.reset() }
  }
  function setWhen(value: string) {
    if (value === 'date') {
      const picker = dateRef.current
      if (picker) { try { picker.showPicker() } catch { picker.click() } }
      return
    }
    if (!value) { setDraft(current => ({ ...current, due_at: null, due_is_approx: false, is_all_day: true, recurrence_rule: null })); return }
    const choice = dateForChoice(value as WhenChoice)
    // Keep a chosen time when moving the task to another day.
    setDraft(current => ({ ...current, ...choice, due_at: hasTime && !choice.due_is_approx ? withTime(choice.due_at, timeInput(current.due_at)) : choice.due_at, is_all_day: choice.due_is_approx ? true : current.is_all_day }))
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
    <div className="composer-field"><Plus className="composer-plus" size={19} aria-hidden="true"/><input ref={inputRef} aria-label="Add a task" aria-readonly={voice.state === 'listening'} readOnly={voice.state === 'listening'} placeholder="Add a task…" value={title} maxLength={500} enterKeyHint="done" autoComplete="off" autoCapitalize="sentences" onFocus={event => {
      if (window.innerWidth >= 640) return
      const input = event.currentTarget
      window.setTimeout(() => input.scrollIntoView({ block: 'nearest', behavior: 'auto' }), 100)
      window.setTimeout(() => input.scrollIntoView({ block: 'nearest', behavior: 'auto' }), 300)
    }} onChange={event => setTitle(event.target.value)} disabled={!isOnline}/><button type="button" className={`icon-button voice-button ${voice.state === 'listening' ? 'listening' : ''}`} aria-label={voice.state === 'listening' ? 'Stop listening' : 'Add by voice'} disabled={!isOnline || voice.processing && voice.state !== 'listening'} onClick={() => voice.state === 'listening' ? voice.stop() : void voice.start(title)}>{voice.state === 'listening' ? <MicOff size={18}/> : <Mic size={18}/>}</button><button className="primary-button add-button" type="submit" disabled={!title.trim() || busy || !isOnline || voice.state === 'listening' || voice.state === 'transcribing' || voice.processing}>{!isOnline ? 'Offline' : busy ? 'Saving…' : voice.state === 'ready' && voice.hasTranscript ? 'Add task' : 'Add'}</button></div>
    {(voice.state === 'listening' || voice.state === 'transcribing' || voice.processing || voiceMessage || voice.modelStatus.state === 'downloading' || voice.modelStatus.state === 'error') && <div className="voice-panel"><div className="voice-status-row">{voice.state === 'listening' && <VoiceMeter meterRef={voice.meterRef}/>}<p className="voice-status" role="status">{voiceMessage || (voice.modelStatus.state === 'downloading' ? 'Downloading voice model… this may take a moment.' : voice.modelStatus.state === 'error' && voice.state === 'idle' ? 'Voice could not load. Tap the mic to retry, or type instead.' : '')}</p>{voice.processing && <button type="button" className="text-button" onClick={voice.cancelTranscription}>Stop transcription</button>}</div></div>}
    {title.trim().length > 0 && <div className="composer-options">
      <div className="chip-row" role="group" aria-label="When, size and time">
        <label className={`select-chip when-chip ${draft.due_at ? 'active' : ''}`}><CalendarDays size={13} aria-hidden="true"/>
          <select aria-label="When" value={when} disabled={!isOnline} onChange={event => setWhen(event.target.value)}>
            <option value="">When</option>
            {WHEN_CHOICES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            <option value="date">{when === 'date' && draft.due_at ? new Date(draft.due_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Pick a date…'}</option>
          </select>
          <input ref={dateRef} className="when-date-input" aria-label="Pick a date" tabIndex={-1} type="date" disabled={!isOnline} value={dateInput(draft.due_at)} onChange={event => setDraft(current => ({ ...current, due_at: event.target.value ? withTime(new Date(`${event.target.value}T12:00:00`).toISOString(), timeInput(current.due_at) || '12:00') : null, due_is_approx: false, recurrence_rule: event.target.value ? current.recurrence_rule : null }))}/>
        </label>
        <label className={`select-chip ${draft.size ? 'active' : ''}`}><span className="sr-only">Size</span><select aria-label="Size" value={draft.size ?? ''} disabled={!isOnline} onChange={event => setDraft(current => ({ ...current, size: (event.target.value || null) as Task['size'] }))}><option value="">Size</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label>
        <label className={`select-chip due-time-chip ${hasTime ? 'active' : ''}`}><Clock3 size={13} aria-hidden="true"/><span className="sr-only">Time</span><input aria-label="Due time" type="time" disabled={!isOnline} value={hasTime ? timeInput(draft.due_at) : ''} onChange={event => setDraft(current => ({ ...current, due_at: event.target.value ? withTime(current.due_at, event.target.value) : current.due_at, due_is_approx: event.target.value ? false : current.due_is_approx, is_all_day: !event.target.value }))}/></label>
      </div>
      {showSecondRow && <div className="chip-row detail-row composer-row-two">
        <ReminderPicker offset={draft.reminder_offset} minutes={draft.reminder_minutes} disabled={!isOnline || !draft.due_at || draft.due_is_approx} onChange={values => setDraft(current => ({ ...current, reminder_offset: values.reminder_offset, reminder_minutes: values.reminder_minutes ?? null }))}/>
        <label className={`select-chip label-select ${draft.label_id ? 'active' : ''}`}><span className="sr-only">Label</span><select aria-label="Label" value={draft.label_id ?? ''} disabled={!isOnline} onChange={event => { if (event.target.value === '__edit') { setLabelEditor(true); return } setDraft(current => ({ ...current, label_id: event.target.value || null })) }}><option value="">Label</option>{labels.map(label => <option value={label.id} key={label.id}>{label.name}</option>)}<option value="__edit">Edit labels…</option></select></label>
        <label className={`select-chip ${draft.recurrence_rule ? 'active' : ''}`} title="Never means this task will not repeat."><Repeat size={13} aria-hidden="true"/><span className="sr-only">Repeat</span><select aria-label="Repeat" value={draft.recurrence_rule ?? ''} disabled={!isOnline} onChange={event => setRecurrence((event.target.value || null) as Task['recurrence_rule'])}><option value="">Never</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <button type="button" disabled={!isOnline} className={`choice-chip icon-chip ${draft.is_important ? 'starred' : ''}`} aria-label={draft.is_important ? 'Remove Important' : 'Mark Important'} aria-pressed={draft.is_important} onClick={() => setDraft(current => ({ ...current, is_important: !current.is_important }))}><Star size={15}/>Important</button>
        {!noteOpen && <button type="button" className="text-button add-note" disabled={!isOnline} onClick={() => setNoteOpen(true)}>Add note</button>}
      </div>}
      {showSecondRow && noteOpen && <label className="description-field">Note<textarea aria-label="Description" maxLength={5000} disabled={!isOnline} value={draft.description} placeholder="Add a description or helpful context…" autoFocus onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}/></label>}
      {labelEditor && <div className="label-manager"><div className="label-form"><label htmlFor="new-label">New label</label><input id="new-label" disabled={!isOnline} value={newLabel} maxLength={32} onChange={event => setNewLabel(event.target.value)} placeholder="Label name"/><button type="button" disabled={!isOnline} className="secondary-button" onClick={() => { const name = newLabel.trim(); if (name) void onCreateLabel(name).then(() => setNewLabel('')) }}>Add label</button><button type="button" className="icon-button" aria-label="Close label editor" onClick={() => setLabelEditor(false)}><X size={16}/></button></div><div className="label-list">{labels.map(label => <div className="label-admin-row" key={label.id}><span className="label-tag">{label.name}</span><input aria-label={`Rename ${label.name}`} disabled={!isOnline} defaultValue={label.name} maxLength={32} onBlur={event => void onRenameLabel(label, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/><button type="button" disabled={!isOnline} className="icon-button" aria-label={`Remove label ${label.name}`} onClick={() => void onDeleteLabel(label)}><Trash2 size={15}/></button></div>)}</div></div>}
    </div>}
  </form>
})
