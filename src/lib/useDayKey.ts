import { useEffect, useState } from 'react'
import { localDayKey } from './dates'

/** Today's local `YYYY-MM-DD`, updated when the day rolls over or the app comes back into view. */
export function useDayKey() {
  const [dayKey, setDayKey] = useState(() => localDayKey(new Date()))
  useEffect(() => {
    const refresh = () => setDayKey(localDayKey(new Date()))
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return dayKey
}
