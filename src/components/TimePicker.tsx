import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Clock3 } from 'lucide-react'
import { formatTime12 } from '../lib/dates'

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
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const hasValue = /^\d{1,2}:\d{2}$/.test(value)
  // With no time set, the wheels start on the next whole hour, like a phone alarm.
  const [h, m] = hasValue ? value.split(':').map(Number) : [(new Date().getHours() + 1) % 24, 0]
  const hour12 = h % 12 || 12
  const pm = h >= 12

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8))
    const below = window.innerHeight - rect.bottom
    setPos(below < 280 && rect.top > below ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!popRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); buttonRef.current?.focus() } }
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

  return <span className={`time-picker ${className}`}>
    <button ref={buttonRef} type="button" className={`select-chip time-chip ${hasValue ? 'active' : ''}`} aria-label={hasValue ? `${label}, ${formatTime12(value)}` : label}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(current => !current)}>
      <Clock3 size={13} aria-hidden="true"/>{hasValue ? formatTime12(value) : label}
    </button>
    {/* Portalled to <body>: an animated ancestor (the task editor keeps a transform) would otherwise capture the fixed popover. */}
    {open && createPortal(<div ref={popRef} className="time-popover" role="dialog" aria-label={`Choose ${label.toLowerCase()}`} style={pos}>
      <div className="time-wheels">
        <Wheel label="Hour" items={HOURS} index={hour12 - 1} onSelect={i => onChange(toValue(i + 1, m, pm))}/>
        <Wheel label="Minute" items={MINUTES} index={m} onSelect={i => onChange(toValue(hour12, i, pm))}/>
        <Wheel label="AM or PM" items={HALVES} index={pm ? 1 : 0} onSelect={i => onChange(toValue(hour12, m, i === 1))}/>
      </div>
      <div className="time-popover-foot">
        <button type="button" className="text-button" disabled={!hasValue} onClick={() => { onChange(''); setOpen(false) }}>Clear</button>
        <button type="button" className="primary-button" onClick={() => { if (!hasValue) onChange(toValue(hour12, m, pm)); setOpen(false) }}>Done</button>
      </div>
    </div>, document.body)}
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
