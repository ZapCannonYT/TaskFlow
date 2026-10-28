import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { colorVar, TASK_COLORS, type TaskColor } from '../lib/colors'
import { Popover, usePopover } from './Popover'

type ColorPickerProps = {
  value: TaskColor | null | undefined
  disabled?: boolean
  /** `chip` folds the swatches into a popover in the composer; `field` shows them inline in the editor. */
  variant?: 'chip' | 'field'
  onChange(color: TaskColor | null): void
}

const SWATCHES_WIDTH = 9 * 32 + 8 * 6 + 18

export function ColorPicker({ value, disabled, variant = 'chip', onChange }: ColorPickerProps) {
  const { open, toggle, close, anchorRef } = usePopover()
  const choose = (color: TaskColor | null) => { onChange(color); close() }
  const swatches = <span className="color-swatches" role="radiogroup" aria-label="Colour">
    <button type="button" role="radio" aria-checked={!value} aria-label="No colour" className="color-swatch none" disabled={disabled} onClick={() => choose(null)}>{!value && <Check size={12}/>}</button>
    {TASK_COLORS.map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={value === key} aria-label={label} title={label}
      className="color-swatch" style={{ '--swatch': colorVar(key) } as CSSProperties} disabled={disabled} onClick={() => choose(key)}>{value === key && <Check size={12}/>}</button>)}
  </span>

  if (variant === 'field') return <div className="edit-select color-field"><span>Colour</span>{swatches}</div>
  return <span className="color-picker">
    <button ref={anchorRef} type="button" className={`select-chip color-chip ${value ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={toggle}>
      <span className="color-dot" style={{ '--swatch': colorVar(value) ?? 'transparent' } as CSSProperties} aria-hidden="true"/>Colour
    </button>
    {open && <Popover anchorRef={anchorRef} width={SWATCHES_WIDTH} height={56} className="color-popover" label="Choose a colour" onClose={close}>{swatches}</Popover>}
  </span>
}
