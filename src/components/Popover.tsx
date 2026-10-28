import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/** Only one popover is open at a time: opening one closes whichever was open before. */
let closeOpenPopover: (() => void) | null = null

export function usePopover() {
  const [open, setOpenState] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpenState(false), [])
  const setOpen = useCallback((next: boolean) => {
    if (next && closeOpenPopover !== close) closeOpenPopover?.()
    closeOpenPopover = next ? close : closeOpenPopover === close ? null : closeOpenPopover
    setOpenState(next)
  }, [close])
  useEffect(() => () => { if (closeOpenPopover === close) closeOpenPopover = null }, [close])
  const dismiss = useCallback(() => setOpen(false), [setOpen])
  return { open, setOpen, toggle: () => setOpen(!open), close: dismiss, anchorRef }
}

type PopoverProps = {
  anchorRef: RefObject<HTMLElement | null>
  width: number
  /** Height to expect when choosing whether there is room below the anchor. */
  height: number
  className: string
  label: string
  onClose(): void
  children: ReactNode
}

/**
 * Rendered into <body> with fixed positioning, so no scrolling row, clipped card or animated ancestor can cut it
 * off or trap it under other content. It opens below its anchor, or above when there is more room there, and stays
 * on screen horizontally. A press outside or Escape closes it; scrolling or resizing moves it with its anchor.
 */
export function Popover({ anchorRef, width, height, className, label, onClose, children }: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' })

  const place = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const viewWidth = document.documentElement.clientWidth
    const fitWidth = Math.min(width, viewWidth - 16)
    const left = Math.max(8, Math.min(rect.left, viewWidth - fitWidth - 8))
    const below = window.innerHeight - rect.bottom
    setPos(below < height + 12 && rect.top > below
      ? { left, width: fitWidth, bottom: window.innerHeight - rect.top + 6 }
      : { left, width: fitWidth, top: rect.bottom + 6 })
  }, [anchorRef, width, height])
  useLayoutEffect(place, [place])

  useEffect(() => {
    const outside = (target: EventTarget | null) => !popRef.current?.contains(target as Node) && !anchorRef.current?.contains(target as Node)
    const onPointer = (event: PointerEvent) => { if (outside(event.target)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); anchorRef.current?.focus() } }
    // Follow the anchor rather than closing: on phones the page resizes as the keyboard hides, right as a chip is tapped.
    const onMove = (event: Event) => { if (outside(event.target)) place() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRef, onClose, place])

  return createPortal(<div ref={popRef} className={`popover ${className}`} role="dialog" aria-label={label} style={pos}>{children}</div>, document.body)
}
