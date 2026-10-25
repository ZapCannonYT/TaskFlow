import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function DayTaskSheet({ onClose, children }: { onClose(): void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [onClose])
  return <>
    <button type="button" className="sheet-scrim" aria-label="Close task details" onClick={onClose} tabIndex={-1}/>
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Task details" tabIndex={-1} ref={panelRef}>
      <div className="sheet-head"><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17}/></button></div>
      {children}
    </div>
  </>
}
