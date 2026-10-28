import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Clock3 } from 'lucide-react'
import { formatTime12 } from '../lib/dates'
import { Popover, usePopover } from './Popover'

type TimePickerProps = {
  /** 24-hour `HH:MM`, or '' for no time. */
  value: string
  disabled?: boolean
  className?: string
  label?: string
  /** `chip` sits in a chip row; `field` is a bare input in the task editor (phones only; laptops always show the chip). */
  variant?: 'chip' | 'field'
  onChange(value: string): void
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const HALVES = ['AM', 'PM']
const ITEM_PX = 36
const POPOVER_WIDTH = 240

const pad = (n: number) => String(n).padStart(2, '0')
const toValue = (hour12: number, minute: number, pm: boolean) => `${pad((hour12 % 12) + (pm ? 12 : 0))}:${pad(minute)}`
const isTouch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

/**
 * Phones get the browser's own time box, whose wheel already reads well there.
 * Laptops get a chip in 12-hour AM/PM that opens hour, minute and AM/PM scroll wheels.
 */
export function TimePicker(props: TimePickerProps) {
  const [touch] = useState(isTouch)
  return touch ? <NativeTime {...props}/> : <WheelTime {...props}/>
}

function NativeTime({ value, disabled, className = '', label = 'Time', variant = 'chip', onChange }: TimePickerProps) {
  const input = <input aria-label={label} type="time" disabled={disabled} value={value} onChange={event => onChange(event.target.value)}/>
  if (variant === 'field') return input
  return <label className={`select-chip ${className} ${value ? 'active' : ''}`}><span className="sr-only">{label}</span>{input}</label>
}

function WheelTime({ value, disabled, className = '', label = 'Time', onChange }: TimePickerProps) {
  const { open, toggle, close, anchorRef } = usePopover()
  const hasValue = /^\d{1,2}:\d{2}$/.test(value)
  // With no time set, the wheels start on the next whole hour, like a phone alarm.
  const [h, m] = hasValue ? value.split(':').map(Number) : [(new Date().getHours() + 1) % 24, 0]
  const hour12 = h % 12 || 12
  const pm = h >= 12

  return <span className={`time-picker ${className}`}>
    <button ref={anchorRef} type="button" className={`select-chip time-chip ${hasValue ? 'active' : ''}`} aria-label={hasValue ? `${label}, ${formatTime12(value)}` : label}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={toggle}>
      <Clock3 size={13} aria-hidden="true"/>{hasValue ? formatTime12(value) : label}
    </button>
    {open && <Popover anchorRef={anchorRef} width={POPOVER_WIDTH} height={268} className="time-popover" label={`Choose ${label.toLowerCase()}`} onClose={close}>
      <div className="time-wheels">
        <Wheel label="Hour" items={HOURS} index={hour12 - 1} onSelect={i => onChange(toValue(i + 1, m, pm))}/>
        <Wheel label="Minute" items={MINUTES} index={m} onSelect={i => onChange(toValue(hour12, i, pm))}/>
        <Wheel label="AM or PM" items={HALVES} index={pm ? 1 : 0} onSelect={i => onChange(toValue(hour12, m, i === 1))}/>
      </div>
      <div className="time-popover-foot">
        <button type="button" className="text-button" disabled={!hasValue} onClick={() => { onChange(''); close() }}>Clear</button>
        <button type="button" className="primary-button" onClick={() => { if (!hasValue) onChange(toValue(hour12, m, pm)); close() }}>Done</button>
      </div>
    </Popover>}
  </span>
}

type WheelProps = { label: string; items: string[]; index: number; onSelect(index: number): void }

/** One snapping scroll column; the centred row is the selection. Wheel, drag, click and arrow keys all move it. */
function Wheel({ label, items, index, onSelect }: WheelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const settleRef = useRef<number | undefined>(undefined)
  const mountedRef = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || Math.round(el.scrollTop / ITEM_PX) === index) { mountedRef.current = true; return }
    const top = index * ITEM_PX
    if (mountedRef.current && typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'smooth' })
    else el.scrollTop = top
    mountedRef.current = true
  }, [index])
  useEffect(() => () => window.clearTimeout(settleRef.current), [])

  const onScroll = () => {
    window.clearTimeout(settleRef.current)
    settleRef.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const next = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_PX)))
      if (next !== index) onSelect(next)
    }, 100)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    onSelect(Math.max(0, Math.min(items.length - 1, index + step)))
  }

  return <div ref={ref} className="wheel" role="listbox" aria-label={label} tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown}>
    <div className="wheel-pad" aria-hidden="true"/>
    {items.map((item, i) => <div key={item} role="option" aria-selected={i === index} className="wheel-item" onClick={() => onSelect(i)}>{item}</div>)}
    <div className="wheel-pad" aria-hidden="true"/>
  </div>
}
