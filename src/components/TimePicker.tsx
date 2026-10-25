import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Clock3 } from 'lucide-react'
import { formatTime12 } from '../lib/dates'

type TimePickerProps = {
  /** 24-hour `HH:MM`, or '' for no time. */
  value: string
  disabled?: boolean
  className?: string
  label?: string
  onChange(value: string): void
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
const PRESETS = ['09:00', '12:00', '17:00', '20:00']
const POPOVER_WIDTH = 272

const pad = (n: number) => String(n).padStart(2, '0')
const toValue = (hour12: number, minute: number, pm: boolean) => `${pad((hour12 % 12) + (pm ? 12 : 0))}:${pad(minute)}`

/** A time chip that always reads in 12-hour AM/PM, whatever the browser locale, with a tap-friendly popover. */
export function TimePicker({ value, disabled, className = '', label = 'Time', onChange }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [h, m] = value ? value.split(':').map(Number) : [NaN, NaN]
  const hasValue = Number.isFinite(h)
  const pm = hasValue ? h >= 12 : false
  const hour12 = hasValue ? (h % 12 || 12) : null
  // A minute off the 5-minute grid (typed by voice, say) still shows as selected on its nearest button.
  const minute = hasValue ? m : null

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8))
    const below = window.innerHeight - rect.bottom
    setPos(below < 300 && rect.top > below ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!popRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); buttonRef.current?.focus() } }
    const onScroll = (event: Event) => { if (!popRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  // Picking an hour first guesses the half of the day people usually mean: 8–11 morning, 12–7 afternoon or evening.
  const pickHour = (hour: number) => onChange(toValue(hour, minute ?? 0, hasValue ? pm : !(hour >= 8 && hour <= 11)))
  const pickMinute = (next: number) => onChange(toValue(hour12 ?? 12, next, hasValue ? pm : true))
  const pickHalf = (nextPm: boolean) => onChange(toValue(hour12 ?? (nextPm ? 5 : 9), minute ?? 0, nextPm))

  return <span className={`time-picker ${className}`}>
    <button ref={buttonRef} type="button" className={`select-chip time-chip ${hasValue ? 'active' : ''}`} aria-label={hasValue ? `${label}, ${formatTime12(value)}` : label}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(current => !current)}>
      <Clock3 size={13} aria-hidden="true"/>{hasValue ? formatTime12(value) : label}
    </button>
    {open && <div ref={popRef} className="time-popover" role="dialog" aria-label={`Choose ${label.toLowerCase()}`} style={pos}>
      <div className="time-popover-head">
        <strong className="time-readout">{hasValue ? formatTime12(value) : '--:--'}</strong>
        <div className="time-half" role="radiogroup" aria-label="AM or PM">
          <button type="button" role="radio" aria-checked={hasValue && !pm} onClick={() => pickHalf(false)}>AM</button>
          <button type="button" role="radio" aria-checked={hasValue && pm} onClick={() => pickHalf(true)}>PM</button>
        </div>
      </div>
      <span className="time-section-label">Hour</span>
      <div className="time-grid" role="radiogroup" aria-label="Hour">
        {HOURS.map(hour => <button key={hour} type="button" role="radio" aria-checked={hour12 === hour} onClick={() => pickHour(hour)}>{hour}</button>)}
      </div>
      <span className="time-section-label">Minute</span>
      <div className="time-grid" role="radiogroup" aria-label="Minute">
        {MINUTES.map(next => <button key={next} type="button" role="radio" aria-checked={minute !== null && Math.round(minute / 5) * 5 % 60 === next} onClick={() => pickMinute(next)}>:{pad(next)}</button>)}
      </div>
      <div className="time-presets">
        {PRESETS.map(preset => <button key={preset} type="button" className="choice-chip" onClick={() => { onChange(preset); setOpen(false) }}>{formatTime12(preset)}</button>)}
      </div>
      <div className="time-popover-foot">
        <button type="button" className="text-button" disabled={!hasValue} onClick={() => { onChange(''); setOpen(false) }}>Clear</button>
        <button type="button" className="primary-button" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>}
  </span>
}
