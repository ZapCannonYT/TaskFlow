import { useEffect, useState } from 'react'

export function useNow(active: boolean, intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    const tick = () => { if (!document.hidden) setNow(new Date()) }
    tick()
    const id = window.setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [active, intervalMs])
  return now
}
