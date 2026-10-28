import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import type { Task } from '../lib/supabase'
import { REMINDER_MENU } from '../lib/taskOptions'
import { SelectMenu } from './SelectMenu'
import { MAX_REMINDER_MINUTES, reminderChange, splitMinutes, toMinutes, UNIT_MINUTES, type ReminderOffset, type ReminderUnit } from '../lib/reminders'

type ReminderPickerProps = {
  offset: ReminderOffset
  minutes?: number | null
  disabled?: boolean
  /** `chip` for the composer and quick-details rows, `field` for the labelled task editor. */
  variant?: 'chip' | 'field'
  onChange(values: Pick<Task, 'reminder_offset' | 'reminder_minutes'>): void
}

export function ReminderPicker({ offset, minutes, disabled, variant = 'chip', onChange }: ReminderPickerProps) {
  const stored = splitMinutes(minutes ?? 30)
  const [amount, setAmount] = useState(String(stored.amount))
  const [unit, setUnit] = useState<ReminderUnit>(stored.unit)
  useEffect(() => { const next = splitMinutes(minutes ?? 30); setAmount(String(next.amount)); setUnit(next.unit) }, [minutes])

  const commit = (nextAmount: string, nextUnit: ReminderUnit) => {
    const value = Number(nextAmount)
    if (!Number.isFinite(value) || value <= 0) return
    const next = toMinutes(value, nextUnit)
    if (next !== minutes) onChange({ reminder_offset: 'custom', reminder_minutes: next })
  }
  const select = <SelectMenu label="Reminder" variant={variant} value={offset} options={REMINDER_MENU} disabled={disabled} active={offset !== 'none'}
    icon={variant === 'chip' ? <Bell size={13} aria-hidden="true"/> : undefined} display={offset === 'custom' ? 'Custom' : undefined}
    onChange={next => onChange(reminderChange(next, minutes))}/>
  const custom = offset === 'custom' && <span className="reminder-custom">
    <input aria-label="Reminder amount" type="number" inputMode="numeric" min={1} max={Math.floor(MAX_REMINDER_MINUTES / UNIT_MINUTES[unit])} step={1} disabled={disabled}
      value={amount} onChange={event => setAmount(event.target.value)} onBlur={() => commit(amount, unit)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}/>
    <select aria-label="Reminder unit" value={unit} disabled={disabled} onChange={event => { const next = event.target.value as ReminderUnit; setUnit(next); commit(amount, next) }}>
      <option value="minutes">min</option><option value="hours">hours</option><option value="days">days</option>
    </select>
    <span className="reminder-custom-suffix">before</span>
  </span>

  if (variant === 'field') return <div className="edit-select reminder-field"><span>Remind me</span><span className="reminder-field-controls">{select}{custom}</span></div>
  return <span className="reminder-chip-group">{select}{custom}</span>
}
