import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, usePopover } from './Popover'

export type MenuOption<T extends string> = {
  value: T
  label: string
  /** A short second line, such as the date "Tomorrow" stands for. */
  hint?: string
  /** Shown above this option, separating it from the ones before. */
  divider?: boolean
}

type SelectMenuProps<T extends string> = {
  /** What the menu sets, for screen readers and the empty state ("Size", "Repeat"). */
  label: string
  value: T
  options: ReadonlyArray<MenuOption<T>>
  onChange(value: T): void
  icon?: ReactNode
  /** Text on the button; defaults to the chosen option's label. */
  display?: string
  /** Highlights the button when something other than the default is chosen. */
  active?: boolean
  disabled?: boolean
  /** `chip` sits in a chip row; `field` is a full-width box in the task editor. */
  variant?: 'chip' | 'field'
  className?: string
}

const OPTION_PX = 40

/**
 * A styled replacement for a native select: a chip that opens a popover list with a check on the chosen option,
 * optional hints, and keyboard control (arrows, Home, End, Enter, Escape, or a letter to jump).
 */
export function SelectMenu<T extends string>({ label, value, options, onChange, icon, display, active, disabled, variant = 'chip', className = '' }: SelectMenuProps<T>) {
  const { open, toggle, close, anchorRef } = usePopover()
  const listRef = useRef<HTMLDivElement>(null)
  const chosen = options.find(option => option.value === value)
  const text = display ?? chosen?.label ?? label

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const items = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
      const index = Math.max(0, options.findIndex(option => option.value === value))
      items?.[index]?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, options, value])

  const choose = (next: T) => { close(); anchorRef.current?.focus(); if (next !== value) onChange(next) }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Tab') { close(); return }
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase()
      next = items.findIndex((item, i) => i > index && item.dataset.label?.startsWith(letter))
      if (next < 0) next = items.findIndex(item => item.dataset.label?.startsWith(letter))
    }
    if (next < 0) return
    event.preventDefault()
    items[next]?.focus()
  }

  return <span className={`select-menu ${variant === 'field' ? 'select-menu-field' : ''} ${className}`}>
    <button ref={anchorRef} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
      aria-label={chosen && (display || chosen.label) !== label ? `${label}, ${text}` : label}
      className={variant === 'field' ? `menu-field ${open ? 'open' : ''}` : `select-chip menu-chip ${active ? 'active' : ''} ${open ? 'open' : ''}`}
      onClick={toggle}>
      {icon}<span className="menu-chip-text">{text}</span><ChevronDown className="menu-caret" size={13} aria-hidden="true"/>
    </button>
    {open && <Popover anchorRef={anchorRef} width={variant === 'field' ? 240 : 220} height={options.length * OPTION_PX + 12} className="menu-popover" label={label} onClose={close}>
      <div ref={listRef} role="listbox" aria-label={label} className="menu-list" onKeyDown={onKeyDown}>
        {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} data-label={option.label.toLowerCase()}
          className={`menu-option ${option.divider ? 'has-divider' : ''}`} onClick={() => choose(option.value)}>
          <span className="menu-option-text"><span>{option.label}</span>{option.hint && <span className="menu-option-hint">{option.hint}</span>}</span>
          {option.value === value && <Check size={15} aria-hidden="true"/>}
        </button>)}
      </div>
    </Popover>}
  </span>
}
