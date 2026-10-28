import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Label, supabase, Task } from '../../lib/supabase'
import { mergeFetched } from '../../lib/taskRules'

/** A completion saved to the server but not yet shown as done, so a reload must keep the local copy. */
export type PendingCompletion = { completedAt: string; nextTask: Task | null; saved: boolean }

type Options = {
  signedIn: boolean
  userId: string | null
  pendingRef: MutableRefObject<Map<string, PendingCompletion>>
  setError(message: string): void
  setErrorRetryable(retryable: boolean): void
}

const snapshotKey = (userId: string) => `taskflow:snapshot:v1:${userId}`

/** Tasks and labels from Supabase, kept current by realtime changes, focus and reconnects. */
export function useTaskSync({ signedIn, userId, pendingRef, setError, setErrorRetryable }: Options) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [syncStatus, setSyncStatus] = useState(navigator.onLine ? 'Connecting' : 'Offline')
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    if (!supabase || !navigator.onLine) return
    const seq = ++loadSeqRef.current
    const [taskResult, labelResult] = await Promise.all([
      supabase.from('tasks').select('*, labels(name)').order('created_at', { ascending: false }),
      supabase.from('labels').select('*').order('name'),
    ])
    if (seq !== loadSeqRef.current) return
    let loadError = ''
    let resolvedLabels = (labelResult.data ?? []) as Label[]
    if (taskResult.error) loadError = taskResult.error.message
    else {
      const fetched = (taskResult.data ?? []) as Task[]
      setTasks(current => mergeFetched(fetched, current, pendingRef.current))
    }
    if (labelResult.error) loadError ||= labelResult.error.message
    else {
      setLabels(current => sameRows(current, resolvedLabels) ? current : resolvedLabels)
      if (!resolvedLabels.length) {
        const { data: userData } = await supabase.auth.getUser()
        if (userData.user) {
          const inserted = await supabase.from('labels').insert(['Study', 'Work', 'Personal'].map(name => ({ user_id: userData.user!.id, name }))).select('*')
          if (!inserted.error) { resolvedLabels = inserted.data as Label[]; setLabels(resolvedLabels) }
        }
      }
    }
    setError(loadError); setErrorRetryable(Boolean(loadError))
    setTasksLoaded(true)
    if (!loadError && userId) {
      try {
        const snapshot = JSON.stringify({ tasks: taskResult.data ?? [], labels: resolvedLabels, savedAt: Date.now() })
        if (snapshot.length < 1_000_000) localStorage.setItem(snapshotKey(userId), snapshot)
      } catch { /* local snapshots are optional */ }
    }
  }, [userId, pendingRef, setError, setErrorRetryable])

  useEffect(() => {
    if (!signedIn || !supabase) return
    const client = supabase
    if (userId) {
      try {
        const saved = localStorage.getItem(snapshotKey(userId))
        if (saved) {
          const snapshot = JSON.parse(saved) as { tasks?: Task[]; labels?: Label[]; savedAt?: number }
          if (Date.now() - (snapshot.savedAt ?? 0) < 60_000 && Array.isArray(snapshot.tasks) && Array.isArray(snapshot.labels)) {
            setTasks(snapshot.tasks); setLabels(snapshot.labels); setTasksLoaded(true)
          }
        }
      } catch { /* ignore invalid or inaccessible local storage */ }
    }
    void load()
    let reloadTimer = 0
    const scheduleLoad = () => { window.clearTimeout(reloadTimer); reloadTimer = window.setTimeout(() => void load(), 250) }
    const channel = client.channel('phase1-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'labels' }, scheduleLoad)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setSyncStatus(navigator.onLine ? 'Synced' : 'Offline')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setSyncStatus('Sync unavailable')
      })
    const onFocus = () => { if (navigator.onLine) void load() }
    const onOffline = () => setSyncStatus('Offline')
    const onOnline = () => { setSyncStatus('Connecting'); void load() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => { window.clearTimeout(reloadTimer); window.removeEventListener('focus', onFocus); window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); void client.removeChannel(channel) }
  }, [signedIn, userId, load])

  return { tasks, setTasks, labels, setLabels, tasksLoaded, syncStatus, load }
}

function sameRows<T>(current: T[], next: T[]) {
  return current.length === next.length && JSON.stringify(current) === JSON.stringify(next)
}
