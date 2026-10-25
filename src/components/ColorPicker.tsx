import { useState, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { colorVar, TASK_COLORS, type TaskColor } from '../lib/colors'

type ColorPickerProps = {
  value: TaskColor | null | undefined
  disabled?: boolean
  /** `chip` folds the swatches behind a chip in the composer; `field` shows them inline in the editor. */
  variant?: 'chip' | 'field'
  onChange(color: TaskColor | null): void
}

export function ColorPicker({ value, disabled, variant = 'chip', onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const choose = (color: TaskColor | null) => { onChange(color); setOpen(false) }
  const swatches = <span className="color-swatches" role="radiogroup" aria-label="Colour" onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
    <button type="button" role="radio" aria-checked={!value} aria-label="No colour" className="color-swatch none" disabled={disabled} onClick={() => choose(null)}>{!value && <Check size={12}/>}</button>
    {TASK_COLORS.map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={value === key} aria-label={label} title={label}
      className="color-swatch" style={{ '--swatch': colorVar(key) } as CSSProperties} disabled={disabled} onClick={() => choose(key)}>{value === key && <Check size={12}/>}</button>)}
  </span>

  if (variant === 'field') return <div className="edit-select color-field"><span>Colour</span>{swatches}</div>
  return <span className="color-picker">
    <button type="button" className={`select-chip color-chip ${value ? 'active' : ''}`} aria-expanded={open} disabled={disabled} onClick={() => setOpen(current => !current)}>
      <span className="color-dot" style={{ '--swatch': colorVar(value) ?? 'transparent' } as CSSProperties} aria-hidden="true"/>Colour
    </button>
    {open && swatches}
  </span>
}
