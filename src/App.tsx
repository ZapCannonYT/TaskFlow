import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, CalendarDays, CalendarRange, Check, CircleCheck, Clock, Download, Inbox, RotateCcw, Star, Sun, X } from 'lucide-react'
import { isSupabaseConfigured, Label, PushSubscriptionRow, supabase, Task, UserPreferences } from './lib/supabase'
import { addLocalDays, classifyView, dateForChoice, getSevenDays, isDueOnDay, isMissed, isSameLocalDay, rankOneThing, startOfLocalDay, startOfLocalWeek } from './lib/dates'
import { isBasicTask, needsDetailsPrompt } from './lib/quickDetails'
import { nextOccurrence } from './lib/recurrence'
import { Composer, type ComposerHandle, type DraftDetails } from './components/Composer'
import { TaskRow } from './components/TaskRow'
import { DayGrid } from './components/DayGrid'
import { DayTaskSheet } from './components/DayTaskSheet'
import { useVisualViewport } from './lib/useVisualViewport'
import { useNow } from './lib/useNow'
import { splitDayTasks } from './features/today/dayLayout'

type View = 'Today' | 'Inbox' | 'Later' | 'This week' | 'Done'
const tabs: View[] = ['Today', 'Inbox', 'Later', 'This week', 'Done']

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }

const SETTLE_START_MS = 420
const SETTLE_OUT_MS = 220
const SETTLE_STEP_MS = 0
const SETTLE_STAGGER_CAP = 0
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const buzz = () => { if (!prefersReducedMotion()) navigator.vibrate?.(10) }
type PendingCompletion = { completedAt: string; nextTask: Task | null; saved: boolean }

function vapidBytes(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

function localDateInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function withLocalTime(value: string | null, time: string) {
  const date = value ? new Date(value) : new Date(dateForChoice('today').due_at!)
  const [hours, minutes] = time.split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true); setNotice('')
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)
    if (result.error) setNotice(result.error.message)
    else if (mode === 'sign-up' && !result.data.session) setNotice('Check your email to finish creating your account.')
    else onSignedIn()
  }
  return <main className="auth-wrap"><section className="auth-card">
    <div className="brand-mark" aria-hidden="true"><Check size={18} /></div>
    <p className="eyebrow">A quiet place for your tasks</p><h1>Taskflow</h1>
    <p className="auth-copy">Sign in to keep your tasks in sync across devices.</p>
    <form onSubmit={submit} className="auth-form">
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {notice && <p className="notice" role="status">{notice}</p>}
      <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
    </form>
    <button className="text-button switch-auth" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setNotice('') }}>
      {mode === 'sign-in' ? 'Create an account' : 'Already have an account? Sign in'}
    </button>
  </section></main>
}

function App() {
  useVisualViewport()
  const [sessionReady, setSessionReady] = useState(!isSupabaseConfigured)
  const [signedIn, setSignedIn] = useState(false)
  const [view, setViewState] = useState<View>('Today')
  const [selectedDay, setSelectedDay] = useState(() => startOfLocalDay(new Date()))
  const [tasks, setTasks] = useState<Task[]>([])
  const [tasksLoaded, setTasksLoaded] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [labels, setLabels] = useState<Label[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void>; action?: { label: string; run: () => void } } | null>(null)
  const [toastClosing, setToastClosing] = useState(false)
  const [newTaskId, setNewTaskId] = useState<string | null>(null)
  const [completingIds, setCompletingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [settlingIds, setSettlingIds] = useState<readonly string[]>([])
  const [completedThisSession, setCompletedThisSession] = useState(0)
  const [sheetTaskId, setSheetTaskId] = useState<string | null>(null)
  const [clearDeletedBusy, setClearDeletedBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncStatus, setSyncStatus] = useState(navigator.onLine ? 'Connecting' : 'Offline')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRow[]>([])
  const [currentPushEndpoint, setCurrentPushEndpoint] = useState<string | null>(null)
  const [devicePushStateChecked, setDevicePushStateChecked] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState({ daily_nudge_time: '18:30', quiet_hours_start: '22:30', quiet_hours_end: '08:00', weekly_summary_enabled: true })
  const [pushBusy, setPushBusy] = useState(false)
  const [quickDetailsTaskId, setQuickDetailsTaskId] = useState<string | null>(null)
  const [quickDescription, setQuickDescription] = useState('')
  const composerRef = useRef<ComposerHandle>(null)
  const pendingRef = useRef(new Map<string, PendingCompletion>())
  const settleTimerRef = useRef<number | undefined>(undefined)
  const commitTimerRef = useRef<number | undefined>(undefined)
  const settleIndexById = useMemo(() => new Map(settlingIds.map((id, index) => [id, Math.min(index, SETTLE_STAGGER_CAP)] as const)), [settlingIds])
  const setCompleting = (id: string, on: boolean) => setCompletingIds(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next })
  const [notificationMessage, setNotificationMessage] = useState('')
  const [retryPushSetup, setRetryPushSetup] = useState<boolean | null>(null)

  useLayoutEffect(() => {
    const root = document.documentElement
    const composer = document.querySelector<HTMLElement>('.composer')
    const tabs = document.querySelector<HTMLElement>('.mobile-tabs')
    const observeHeight = (element: HTMLElement | null, property: '--composer-h' | '--tabs-h') => {
      if (!element) { root.style.setProperty(property, '0px'); return null }
      const observer = new ResizeObserver(entries => {
        const height = entries[0]?.contentRect.height ?? 0
        root.style.setProperty(property, `${height}px`)
      })
      observer.observe(element)
      return observer
    }
    const composerObserver = observeHeight(composer, '--composer-h')
    const tabsObserver = observeHeight(tabs, '--tabs-h')
    return () => { composerObserver?.disconnect(); tabsObserver?.disconnect() }
  }, [signedIn, view])

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    const onInstallPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent) }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('beforeinstallprompt', onInstallPrompt)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('beforeinstallprompt', onInstallPrompt)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSignedIn(Boolean(data.session)); setUserId(data.session?.user.id ?? null); setSessionReady(true) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session)); setUserId(session?.user.id ?? null)
      if (!session) {
        try { Object.keys(localStorage).filter(key => key.startsWith('taskflow:snapshot:')).forEach(key => localStorage.removeItem(key)) }
        catch { /* local snapshots are optional */ }
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const load = useCallback(async () => {
    if (!supabase || !navigator.onLine) return
    const [taskResult, labelResult] = await Promise.all([
      supabase.from('tasks').select('*, labels(name)').order('created_at', { ascending: false }),
      supabase.from('labels').select('*').order('name'),
    ])
    let loadError = ''
    let resolvedLabels = (labelResult.data ?? []) as Label[]
    if (taskResult.error) loadError = taskResult.error.message
    else {
      const remoteTasks = (taskResult.data ?? []) as Task[]
      setTasks(current => {
        const pendingIds = new Set(pendingRef.current.keys())
        if (!pendingIds.size) return remoteTasks
        const pendingNextIds = new Set([...pendingRef.current.values()].flatMap(entry => entry.nextTask ? [entry.nextTask.id] : []))
        const currentById = new Map(current.map(task => [task.id, task]))
        const remoteIds = new Set(remoteTasks.map(task => task.id))
        return [
          ...remoteTasks.filter(task => !pendingNextIds.has(task.id)).map(task => pendingIds.has(task.id) ? currentById.get(task.id) ?? task : task),
          ...[...pendingIds].flatMap(id => !remoteIds.has(id) && currentById.has(id) ? [currentById.get(id)!] : []),
        ]
      })
    }
    if (labelResult.error) loadError ||= labelResult.error.message
    else {
      const loaded = resolvedLabels
      setLabels(loaded)
      if (!loaded.length) {
        const { data: userData } = await supabase.auth.getUser()
        if (userData.user) {
          const inserted = await supabase.from('labels').insert(['Study', 'Work', 'Personal'].map(name => ({ user_id: userData.user!.id, name }))).select('*')
          if (!inserted.error) { resolvedLabels = inserted.data as Label[]; setLabels(resolvedLabels) }
        }
      }
    }
    setError(loadError)
    setTasksLoaded(true)
    if (!loadError && userId) {
      try {
        const tasksSnapshot = taskResult.data ?? []
        const labelsSnapshot = resolvedLabels
        const snapshot = JSON.stringify({ tasks: tasksSnapshot, labels: labelsSnapshot, savedAt: Date.now() })
        if (snapshot.length < 1_000_000) localStorage.setItem(`taskflow:snapshot:v1:${userId}`, snapshot)
      } catch { /* local snapshots are optional */ }
    }
  }, [userId])

  useEffect(() => {
    if (!signedIn || !supabase) return
    const client = supabase
    if (userId) {
      try {
        const saved = localStorage.getItem(`taskflow:snapshot:v1:${userId}`)
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

  const loadNotificationSettings = useCallback(async () => {
    if (!supabase) return
    const [{ data: pref, error: prefError }, { data: devices }] = await Promise.all([
      supabase.from('user_preferences').select('*').maybeSingle(),
      supabase.from('push_subscriptions').select('id,endpoint,disabled_at,created_at').is('disabled_at', null).order('created_at', { ascending: false }),
    ])
    if (prefError) { setError(`Settings could not load · ${prefError.message}`); return }
    if (pref) {
      const row = pref as UserPreferences
      setPreferences(row)
      setSettingsDraft({ daily_nudge_time: row.daily_nudge_time, quiet_hours_start: row.quiet_hours_start, quiet_hours_end: row.quiet_hours_end, weekly_summary_enabled: row.weekly_summary_enabled })
    }
    setPushSubscriptions((devices ?? []) as PushSubscriptionRow[])
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        setCurrentPushEndpoint(subscription?.endpoint ?? null)
      } catch {
        setCurrentPushEndpoint(null)
      }
    } else setCurrentPushEndpoint(null)
    setDevicePushStateChecked(true)
  }, [])

  useEffect(() => { if (signedIn) void loadNotificationSettings() }, [signedIn, loadNotificationSettings])

  useEffect(() => {
    if (!toast) return
    setToastClosing(false)
    const closeTimeout = window.setTimeout(() => setToastClosing(true), 4850)
    const removeTimeout = window.setTimeout(() => setToast(null), 5000)
    return () => { window.clearTimeout(closeTimeout); window.clearTimeout(removeTimeout) }
  }, [toast])

  useEffect(() => {
    if (quickDetailsTaskId && tasks.length > 0 && !tasks.some(task => task.id === quickDetailsTaskId && needsDetailsPrompt(task))) {
      setQuickDetailsTaskId(tasks.find(needsDetailsPrompt)?.id ?? null)
    }
  }, [quickDetailsTaskId, tasks])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(null); return }
      if (!(event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'c') || event.ctrlKey || event.metaKey || event.altKey) return
      const active = document.activeElement
      if (active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return
      event.preventDefault(); composerRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visibleTasks = useMemo(() => {
    const active = tasks.filter(task => !task.deleted_at)
    if (view === 'Done') return active.filter(task => task.status === 'completed')
    if (view === 'Today') return active.filter(task => task.status === 'open' && !task.is_inbox && isDueOnDay(task, selectedDay))
    if (view === 'Inbox' || view === 'Later') return active.filter(task => task.status === 'open' && classifyView(task) === view)
    const weekStart = startOfLocalWeek(new Date())
    const weekEnd = addLocalDays(weekStart, 7)
    return active.filter(task => task.status === 'open' && !task.is_inbox && task.due_at && new Date(task.due_at) >= weekStart && new Date(task.due_at) < weekEnd)
  }, [tasks, view, selectedDay])
  const deletedTasks = useMemo(() => tasks.filter(task => task.deleted_at), [tasks])
  const todayDays = useMemo(() => getSevenDays(), [])
  const weekStart = useMemo(() => startOfLocalWeek(new Date()), [])
  const weekEnd = useMemo(() => addLocalDays(weekStart, 7), [weekStart])
  const weekTasks = useMemo(() => tasks.filter(task => !task.deleted_at && task.status === 'open' && !task.is_inbox && task.due_at && new Date(task.due_at) >= weekStart && new Date(task.due_at) < weekEnd), [tasks, weekStart, weekEnd])
  const selectedDayTasks = view === 'Today' ? visibleTasks : []
  const oneThing = view === 'Today' ? rankOneThing(selectedDayTasks)[0] : undefined
  const { timed: allTimed, anytime: allAnytime } = useMemo(() => splitDayTasks(selectedDayTasks), [selectedDayTasks])
  const missedTasks = useMemo(() => view === 'Today' && isSameLocalDay(selectedDay, new Date())
    ? tasks.filter(task => !task.deleted_at && task.status === 'open' && !task.is_inbox && isMissed(task))
    : [], [tasks, view, selectedDay])
  const missedIds = useMemo(() => new Set(missedTasks.map(task => task.id)), [missedTasks])
  const timedTodayTasks = useMemo(() => allTimed.filter(task => !missedIds.has(task.id)), [allTimed, missedIds])
  const anytimeTasks = useMemo(() => allAnytime.filter(task => task.id !== oneThing?.id && !missedIds.has(task.id)), [allAnytime, oneThing?.id, missedIds])
  const viewingToday = isSameLocalDay(selectedDay, new Date())
  const now = useNow(view === 'Today' && viewingToday)
  const closeSheet = useCallback(() => setSheetTaskId(null), [])
  const openDaySheet = useCallback((task: Task) => setSheetTaskId(task.id), [])
  const sheetTask = sheetTaskId ? tasks.find(task => task.id === sheetTaskId && !task.deleted_at && task.status === 'open') : undefined
  const allClear = view === 'Today' && viewingToday && timedTodayTasks.length === 0 && anytimeTasks.length === 0 && !oneThing && missedTasks.length === 0 && completedThisSession > 0
  const basicTasks = useMemo(() => tasks.filter(task => classifyView(task) === 'Inbox' && needsDetailsPrompt(task)), [tasks])
  const selectedQuickTask = quickDetailsTaskId ? tasks.find(task => task.id === quickDetailsTaskId && needsDetailsPrompt(task)) : undefined
  useEffect(() => { setQuickDescription(selectedQuickTask?.description ?? '') }, [selectedQuickTask?.id])

  function chooseView(nextView: View) {
    commitCompletions()
    if (nextView === 'Today') setSelectedDay(startOfLocalDay(new Date()))
    setViewState(nextView)
    setError('')
  }

  const selectDay = (day: Date) => { commitCompletions(); setSelectedDay(day) }

  useEffect(() => {
    const flush = () => { if (document.hidden) commitCompletions() }
    document.addEventListener('visibilitychange', flush)
    return () => { document.removeEventListener('visibilitychange', flush); window.clearTimeout(settleTimerRef.current); window.clearTimeout(commitTimerRef.current) }
  }, [])

  function openTaskDetailsInInbox(taskId: string) {
    setQuickDetailsTaskId(null)
    setExpanded(taskId)
    setViewState('Inbox')
    setError('')
  }

  async function addTask(cleanTitle: string, draft: DraftDetails): Promise<boolean> {
    if (!supabase || !cleanTitle || busy || !isOnline) return false
    const client = supabase
    setBusy(true); setError('')
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setBusy(false); setError('Sign in again to save this task.'); return false }
    const result = await client.from('tasks').insert({ user_id: auth.user.id, title: cleanTitle, ...draft, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' }).select('*, labels(name)').single()
    setBusy(false)
    if (result.error) { setError(`Not saved · ${result.error.message}`); return false }
    setTasks(current => [result.data as Task, ...current]); setError('')
    setNewTaskId(result.data.id)
    window.setTimeout(() => setNewTaskId(current => current === result.data.id ? null : current), 720)
    const addedTask = result.data as Task
    const addDetails = needsDetailsPrompt(addedTask) && classifyView(addedTask) === 'Inbox'
    setToast({
      text: addDetails ? 'Task added to Inbox' : 'Task added',
      ...(addDetails ? { action: { label: 'Add details', run: () => openTaskDetailsInInbox(addedTask.id) } } : {}),
      undo: async () => { const undone = await client.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', result.data.id); if (!undone.error) setTasks(current => current.filter(t => t.id !== result.data.id)); else setError(`Not saved · ${undone.error.message}`) },
    })
    return true
  }

  async function savePreferences(values: Partial<UserPreferences>) {
    if (!supabase || !isOnline) return false
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) { setError('Settings not saved · Sign in again to update your notification settings.'); return false }
    const { data, error: saveError } = await supabase.from('user_preferences')
      .update(values)
      .eq('user_id', auth.user.id)
      .select('*')
      .single()
    if (saveError) { setError(`Settings not saved · ${saveError.message}`); return false }
    setPreferences(data as UserPreferences)
    return true
  }

  async function exportBackup() {
    if (!supabase || !isOnline) { setError('Reconnect to export your latest data.'); return }
    const [{ data: userData }, taskResult, labelResult, prefResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('tasks').select('*').order('created_at'),
      supabase.from('labels').select('*').order('name'),
      supabase.from('user_preferences').select('*').maybeSingle(),
    ])
    const failure = taskResult.error || labelResult.error || prefResult.error
    if (failure || !userData.user) { setError(`Export could not be prepared · ${failure?.message ?? 'Sign in again.'}`); return }
    const backup = { format: 'taski-backup', version: 1, exported_at: new Date().toISOString(), user_id: userData.user.id, tasks: taskResult.data ?? [], labels: labelResult.data ?? [], preferences: prefResult.data ?? null }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `taski-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url)
    setError('')
  }

  async function restoreBackup(file?: File) {
    if (!file || !supabase || !isOnline) return
    try {
      const backup = JSON.parse(await file.text()) as { format?: string; version?: number; tasks?: Task[]; labels?: Label[]; preferences?: UserPreferences | null }
      if (backup.format !== 'taski-backup' || backup.version !== 1 || !Array.isArray(backup.tasks) || !Array.isArray(backup.labels)) throw new Error('Choose a Taski JSON backup file.')
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error('Sign in again to restore your data.')
      const labelsToRestore = backup.labels.map(({ id, name }) => ({ id, name, user_id: userData.user!.id }))
      const tasksToRestore = backup.tasks.map(task => {
        const { labels: _joined, ...row } = task
        return { ...row, user_id: userData.user!.id }
      })
      if (labelsToRestore.length) { const result = await supabase.from('labels').upsert(labelsToRestore, { onConflict: 'id' }); if (result.error) throw result.error }
      if (tasksToRestore.length) { const result = await supabase.from('tasks').upsert(tasksToRestore, { onConflict: 'id' }); if (result.error) throw result.error }
      if (backup.preferences) { const { user_id: _userId, ...values } = backup.preferences; const result = await supabase.from('user_preferences').update(values).eq('user_id', userData.user.id); if (result.error) throw result.error }
      await load(); setError('Backup restored.')
    } catch (cause) { setError(`Backup not restored · ${cause instanceof Error ? cause.message : 'Check the file and try again.'}`) }
  }

  async function finishQuickDetails(skip: boolean) {
    if (!selectedQuickTask) { setQuickDetailsTaskId(null); return }
    const task = selectedQuickTask
    const result = await supabase?.from('tasks').update({ details_prompted_at: new Date().toISOString(), is_inbox: false, updated_at: new Date().toISOString() }).eq('id', task.id).select('*, labels(name)').single()
    if (result?.error) { setError(`Not saved · ${result.error.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? result!.data as Task : item))
    setQuickDetailsTaskId(basicTasks.find(item => item.id !== task.id)?.id ?? null)
    if (skip) setError('')
  }

  async function setupPush(enableDailyNudge: boolean) {
    if (!supabase || !isOnline || pushBusy) return
    setRetryPushSetup(null)
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!vapidPublicKey || !('Notification' in window) || !('PushManager' in window)) {
      setError('Notifications are not supported or configured in this browser.')
      return
    }
    setPushBusy(true); setError('')
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') { setError('Notifications were not enabled. You can change this in browser settings.'); return }
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidPublicKey) })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('This browser did not return a complete push subscription.')
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error('Sign in again to enable notifications.')
      const { data: existing } = await supabase.from('push_subscriptions').select('id').eq('endpoint', json.endpoint).maybeSingle()
      const saved = existing
        ? await supabase.from('push_subscriptions').update({ p256dh: json.keys.p256dh, auth: json.keys.auth, disabled_at: null, last_seen_at: new Date().toISOString() }).eq('id', existing.id)
        : await supabase.from('push_subscriptions').insert({ user_id: userData.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
      if (saved.error) throw saved.error
      if (enableDailyNudge) {
        const enabled = await savePreferences({ daily_nudge_enabled: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' })
        if (!enabled) return
      }
      await loadNotificationSettings()
      setError('')
      setRetryPushSetup(null)
      if (!enableDailyNudge) setNotificationMessage('This device is set up for task reminders.')
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Try again.'
      setRetryPushSetup(enableDailyNudge)
      setError(detail.includes('Registration failed - push service error')
        ? 'Chrome’s push service could not register this device. Retry in a moment. If it keeps happening, check your connection and Chrome’s notification permission for this site.'
        : `Notifications could not be enabled · ${detail}`)
    } finally { setPushBusy(false) }
  }

  async function enableNotifications() { await setupPush(true) }

  async function deferNotificationPrompt() {
    if (!preferences) return
    const dismissals = Math.min(2, preferences.prompt_dismissals + 1)
    await savePreferences({ prompt_dismissals: dismissals, prompt_reoffer_at: dismissals < 2 ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() : null })
  }

  async function testNotification() {
    if (!supabase || !isOnline) return
    setPushBusy(true)
    const { error: testError } = await supabase.functions.invoke('test-push', { body: {} })
    setPushBusy(false)
    if (testError) { setError(`Test notification failed · ${testError.message}`); return }
    setError('')
    setNotificationMessage('Test notification sent to your active devices.')
  }

  async function saveNotificationTimes() {
    if (!settingsDraft.daily_nudge_time || !settingsDraft.quiet_hours_start || !settingsDraft.quiet_hours_end || settingsDraft.quiet_hours_start === settingsDraft.quiet_hours_end) {
      setError('Choose a nudge time and quiet hours with different start and end times.')
      return
    }
    await savePreferences({
      daily_nudge_time: settingsDraft.daily_nudge_time,
      quiet_hours_start: settingsDraft.quiet_hours_start,
      quiet_hours_end: settingsDraft.quiet_hours_end,
      weekly_summary_enabled: settingsDraft.weekly_summary_enabled,
    })
  }

  async function removeSubscription(device: PushSubscriptionRow) {
    if (!supabase || !isOnline) return
    const registration = await navigator.serviceWorker.ready
    const current = await registration.pushManager.getSubscription()
    if (current?.endpoint === device.endpoint) await current.unsubscribe()
    const { error: removeError } = await supabase.from('push_subscriptions').delete().eq('id', device.id)
    if (removeError) { setError(`Device could not be removed · ${removeError.message}`); return }
    await loadNotificationSettings()
  }

  const handledNotificationAction = useRef(false)
  useEffect(() => {
    if (!signedIn || !supabase || handledNotificationAction.current) return
    const params = new URLSearchParams(window.location.search)
    const action = params.get('task_action')
    const taskId = params.get('task_id')
    const reminderId = params.get('reminder_id')
    if (!action || !reminderId || !['open', 'done', 'hour', 'later', 'skip'].includes(action)) return
    handledNotificationAction.current = true
    void (async () => {
      if (action === 'done' && taskId) {
        const result = await supabase!.from('tasks').select('*, labels(name)').eq('id', taskId).maybeSingle()
        if (result.error || !result.data) setError(`Task could not be completed · ${result.error?.message ?? 'Task not found.'}`)
        else await completeTask(result.data as Task)
      } else if ((action === 'hour' || action === 'later') && taskId) {
        const due = action === 'hour'
          ? { due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), due_is_approx: false, is_all_day: false }
          : { ...dateForChoice('tomorrow'), is_all_day: true }
        const result = await supabase!.from('tasks').update({ ...due, is_inbox: false, updated_at: new Date().toISOString() }).eq('id', taskId).eq('status', 'open')
        if (result.error) setError(`Task could not be moved · ${result.error.message}`)
        else {
          setTasks(current => current.map(task => task.id === taskId ? { ...task, ...due, is_inbox: false } : task))
          setToast({ text: action === 'hour' ? 'Snoozed for 1 hour' : 'Moved to tomorrow' })
        }
      } else if (action === 'skip') {
        const skipped = localDateInput(new Date().toISOString())
        await savePreferences({ skipped_until: skipped })
      }
      await supabase!.from('task_reminders').update({ action_at: new Date().toISOString(), action }).eq('id', reminderId)
      params.delete('task_action'); params.delete('task_id'); params.delete('reminder_id')
      window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
    })()
  }, [signedIn])

  useEffect(() => {
    if (!signedIn) return
    const params = new URLSearchParams(window.location.search)
    if (params.has('share')) {
      const title = params.get('title')?.trim() ?? ''
      const text = params.get('text')?.trim() ?? ''
      const url = params.get('url')?.trim() ?? ''
      const shared = [...new Set([title, text, url].filter(Boolean))].join(' ')
      if (shared) { composerRef.current?.setTitle(shared); composerRef.current?.focus() }
      params.delete('share'); params.delete('title'); params.delete('text'); params.delete('url')
      window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
    }
    const quickDetailsId = params.get('quick_details')
    if (quickDetailsId) { openTaskDetailsInInbox(quickDetailsId); params.delete('quick_details'); window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`) }
    if (params.get('capture') === 'voice') { params.delete('capture'); window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`); window.setTimeout(() => composerRef.current?.startVoice(), 300) }
  }, [signedIn])

  async function updateTask(task: Task, values: Partial<Task>) {
    if (!supabase || !isOnline) return
    const updatedAt = new Date().toISOString()
    const nextValues = { ...values }
    if (!isBasicTask({ ...task, ...values })) nextValues.is_inbox = false
    const { data, error: updateError } = await supabase.from('tasks').update({ ...nextValues, updated_at: updatedAt }).eq('id', task.id).select('*, labels(name)').single()
    if (updateError) { setError(`Not saved · ${updateError.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? data as Task : item))
    if (values.reminder_offset && values.reminder_offset !== 'none' && !currentPushEndpoint) void setupPush(false)
  }

  function setQuickTaskRepeat(value: string) {
    if (!selectedQuickTask) return
    const recurrence_rule = (value || null) as Task['recurrence_rule']
    void updateTask(selectedQuickTask, {
      recurrence_rule,
      ...(recurrence_rule ? {
        due_is_approx: false,
        ...(!selectedQuickTask.due_at ? { due_at: withLocalTime(dateForChoice('today').due_at, '12:00') } : {}),
      } : {}),
    })
  }

  async function reopenTask(task: Task, knownNext?: Task | null) {
    if (!supabase || !isOnline) return
    pendingRef.current.delete(task.id)
    setCompleting(task.id, false)
    setSettlingIds(current => current.filter(id => id !== task.id))
    const client = supabase
    const nextTask = knownNext ?? tasks.find(item => item.recurrence_parent_id === task.id && item.status === 'open' && !item.deleted_at) ?? null
    const restoredAt = new Date().toISOString()
    if (nextTask) {
      const removed = await client.from('tasks').update({ deleted_at: restoredAt, updated_at: restoredAt }).eq('id', nextTask.id).eq('status', 'open').is('deleted_at', null)
      if (removed.error) { setError(`Could not undo the next occurrence · ${removed.error.message}`); return }
    }
    const undone = await client.from('tasks').update({ status: 'open', completed_at: null, updated_at: restoredAt }).eq('id', task.id).eq('status', 'completed').is('deleted_at', null)
    if (undone.error) {
      if (nextTask) await client.from('tasks').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', nextTask.id)
      setError(`Not saved · ${undone.error.message}`); return
    }
    setTasks(current => current.filter(item => item.id !== nextTask?.id).map(item => item.id === task.id ? { ...item, status: 'open', completed_at: null } : item))
    setNewTaskId(task.id)
    window.setTimeout(() => setNewTaskId(current => current === task.id ? null : current), 720)
  }

  async function completeTask(task: Task) {
    if (!supabase || !isOnline || pendingRef.current.has(task.id)) return
    const client = supabase
    const completedAt = new Date().toISOString()
    pendingRef.current.set(task.id, { completedAt, nextTask: null, saved: false })
    setCompleting(task.id, true)
    buzz()
    const abort = () => { pendingRef.current.delete(task.id); setCompleting(task.id, false) }
    const { data: completedRow, error: updateError } = await client.from('tasks').update({ status: 'completed', completed_at: completedAt, updated_at: completedAt }).eq('id', task.id).eq('status', 'open').is('deleted_at', null).select('id').maybeSingle()
    if (updateError || !completedRow) { abort(); setNewTaskId(task.id); window.setTimeout(() => setNewTaskId(current => current === task.id ? null : current), 720); setError(updateError ? `Not saved · ${updateError.message}` : 'This task was already changed on another device. Refresh and try again.'); return }
    let nextTask: Task | null = null
    if (task.recurrence_rule && task.due_at) {
      const next = await client.from('tasks').insert({
        user_id: task.user_id, title: task.title, status: 'open', due_at: nextOccurrence(task.recurrence_rule, task.due_at, task.recurrence_day ?? new Date(task.due_at).getDate(), new Date(completedAt)),
        due_is_approx: false, is_all_day: task.is_all_day, timezone: task.timezone, size: task.size,
        is_important: task.is_important, label_id: task.label_id, reminder_offset: task.reminder_offset,
        recurrence_rule: task.recurrence_rule, recurrence_parent_id: task.id, recurrence_day: task.recurrence_day ?? new Date(task.due_at).getDate(),
        description: task.description ?? '', is_inbox: true, details_prompted_at: null,
      }).select('*, labels(name)').single()
      if (next.error) {
        await client.from('tasks').update({ status: 'open', completed_at: null, updated_at: new Date().toISOString() }).eq('id', task.id)
        abort(); setError(`Repeat could not be scheduled · ${next.error.message}`); return
      }
      nextTask = next.data as Task
    }
    pendingRef.current.set(task.id, { completedAt, nextTask, saved: true })
    setToast({ text: `Done “${task.title}”`, undo: async () => { await reopenTask(task, nextTask) } })
    scheduleSettle()
  }

  function scheduleSettle() {
    window.clearTimeout(settleTimerRef.current)
    window.clearTimeout(commitTimerRef.current)
    if (prefersReducedMotion()) { commitCompletions(); return }
    startSettle()
  }

  function startSettle() {
    const ids = [...pendingRef.current].filter(([, entry]) => entry.saved).map(([id]) => id)
    if (!ids.length) return
    setSettlingIds(ids)
    const collapse = SETTLE_START_MS + SETTLE_OUT_MS + SETTLE_STEP_MS * Math.min(ids.length - 1, SETTLE_STAGGER_CAP)
    commitTimerRef.current = window.setTimeout(commitCompletions, collapse)
  }

  function commitCompletions() {
    window.clearTimeout(settleTimerRef.current)
    window.clearTimeout(commitTimerRef.current)
    const saved = [...pendingRef.current].filter(([, entry]) => entry.saved)
    if (!saved.length) { setSettlingIds([]); return }
    const done = new Map(saved)
    for (const [id] of saved) pendingRef.current.delete(id)
    setTasks(current => [
      ...saved.flatMap(([, entry]) => entry.nextTask ? [entry.nextTask] : []),
      ...current.map(item => { const hit = done.get(item.id); return hit ? { ...item, status: 'completed' as const, completed_at: hit.completedAt } : item }),
    ])
    setCompletingIds(current => { const next = new Set(current); for (const [id] of saved) next.delete(id); return next })
    setSettlingIds([])
    setCompletedThisSession(count => count + saved.length)
  }

  async function removeTask(task: Task) {
    if (!supabase || !isOnline) return
    const client = supabase
    const deletedAt = new Date().toISOString()
    const { error: updateError } = await supabase.from('tasks').update({ deleted_at: deletedAt, updated_at: deletedAt }).eq('id', task.id)
    if (updateError) { setError(`Not saved · ${updateError.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? { ...item, deleted_at: deletedAt } : item))
    setToast({ text: 'Task removed', undo: async () => { const undone = await client.from('tasks').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', task.id); if (!undone.error) setTasks(current => current.map(item => item.id === task.id ? { ...item, deleted_at: null } : item)); else setError(`Not saved · ${undone.error.message}`) } })
  }

  async function restoreTask(task: Task) {
    if (!supabase || !isOnline) return
    const { error: updateError } = await supabase.from('tasks').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', task.id)
    if (updateError) { setError(`Not saved · ${updateError.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? { ...item, deleted_at: null } : item))
  }

  async function clearDeletedTasks() {
    if (!supabase || !isOnline || !deletedTasks.length || clearDeletedBusy) return
    if (!window.confirm(`Permanently delete all ${deletedTasks.length} recently deleted ${deletedTasks.length === 1 ? 'task' : 'tasks'}? This cannot be undone.`)) return
    setClearDeletedBusy(true)
    const ids = deletedTasks.map(task => task.id)
    const { error: deleteError } = await supabase.from('tasks').delete().in('id', ids)
    setClearDeletedBusy(false)
    if (deleteError) { setError(`Could not clear recently deleted tasks · ${deleteError.message}`); return }
    setTasks(current => current.filter(task => !ids.includes(task.id)))
    setToast({ text: 'Recently deleted tasks cleared' })
  }

  async function createLabel(name: string) {
    const cleanName = name.trim()
    if (!supabase || !cleanName || !isOnline) return
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return
    const { data, error: labelError } = await supabase.from('labels').insert({ user_id: userData.user.id, name: cleanName }).select('*').single()
    if (labelError) setError(labelError.message)
    else setLabels(current => [...current, data as Label])
  }

  async function renameLabel(label: Label, name: string) {
    const cleanName = name.trim()
    if (!supabase || !cleanName || cleanName === label.name || !isOnline) return
    const { data, error: labelError } = await supabase.from('labels').update({ name: cleanName }).eq('id', label.id).select('*').single()
    if (labelError) setError(labelError.message)
    else setLabels(current => current.map(item => item.id === label.id ? data as Label : item))
  }

  async function deleteLabel(label: Label) {
    if (!supabase || !isOnline) return
    const { error: labelError } = await supabase.from('labels').delete().eq('id', label.id)
    if (labelError) setError(labelError.message)
    else {
      setLabels(current => current.filter(item => item.id !== label.id))
      setTasks(current => current.map(task => task.label_id === label.id ? { ...task, label_id: null, labels: null } : task))
    }
  }

  const rowActionsRef = useRef({ updateTask, completeTask, reopenTask, removeTask })
  rowActionsRef.current = { updateTask, completeTask, reopenTask, removeTask }
  const onToggleTaskExpand = useCallback((id: string) => setExpanded(current => current === id ? null : id), [])
  const onRowUpdate = useCallback((task: Task, values: Partial<Task>) => { void rowActionsRef.current.updateTask(task, values) }, [])
  const onRowComplete = useCallback((task: Task) => {
    const entry = pendingRef.current.get(task.id)
    if (entry) { if (entry.saved) void rowActionsRef.current.reopenTask(task); return }
    if (task.status === 'open') void rowActionsRef.current.completeTask(task)
    else void rowActionsRef.current.reopenTask(task)
  }, [])
  const onRowRemove = useCallback((task: Task) => { void rowActionsRef.current.removeTask(task) }, [])

  function renderTaskRows(items: Task[], listName: string, emptyMessage = "Nothing here yet.") {
    return <section className="task-list" aria-label={listName + " tasks"}>
      {!items.length && (tasksLoaded ? <p className="empty-state">{emptyMessage}</p> : <><span className="sr-only" role="status">Loading tasks</span><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/></>)}
      {items.map(task => <TaskRow key={task.id} task={task} labels={labels} listName={listName} isOnline={isOnline} expanded={expanded === task.id} isNew={newTaskId === task.id} isCompleting={completingIds.has(task.id)} isSettling={settleIndexById.has(task.id)} settleIndex={settleIndexById.get(task.id) ?? 0} onToggleExpand={onToggleTaskExpand} onComplete={onRowComplete} onUpdate={onRowUpdate} onRemove={onRowRemove}/>)}
    </section>
  }

  function renderWeekAgenda(source: Task[], omitThrough?: Date) {
    const days = Array.from({ length: 7 }, (_, index) => addLocalDays(weekStart, index))
    const exactGroups = days.map(day => ({
      day,
      tasks: source.filter(task => task.due_at && !task.due_is_approx && isSameLocalDay(new Date(task.due_at), day)),
    })).filter(group => (!omitThrough || group.day > omitThrough) && group.tasks.length > 0)
    const roughTasks = source.filter(task => task.due_at && task.due_is_approx && (!omitThrough || new Date(task.due_at) > omitThrough))
    if (!exactGroups.length && !roughTasks.length) return tasksLoaded ? <p className="empty-state">No more tasks this week.</p> : <div className="week-agenda"><span className="sr-only" role="status">Loading tasks</span><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/></div>
    return <div className="week-agenda">
      {exactGroups.map(group => <section className="week-day-group" key={group.day.toISOString()}><h3>{isSameLocalDay(group.day, new Date()) ? 'Today' : group.day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>{renderTaskRows(group.tasks, group.day.toLocaleDateString(undefined, { weekday: 'long' }))}</section>)}
      {roughTasks.length > 0 && <section className="week-day-group"><h3>Sometime this week</h3>{renderTaskRows(roughTasks, 'Sometime this week')}</section>}
    </div>
  }

  const taskCounts = useMemo(() => {
    const counts: Record<View, number> = { Today: 0, Inbox: 0, Later: 0, 'This week': 0, Done: 0 }
    const perDay = new Map<string, number>()
    const today = startOfLocalDay(new Date())
    for (const task of tasks) {
      if (task.deleted_at) continue
      if (task.status === 'completed') { counts.Done++; continue }
      if (task.is_inbox || !task.due_at) { counts.Inbox++; continue }
      if (task.due_at) {
        const due = new Date(task.due_at)
        const key = localDayKey(due)
        perDay.set(key, (perDay.get(key) ?? 0) + 1)
        if (due >= weekStart && due < weekEnd) counts['This week']++
        if (isSameLocalDay(due, today) || isMissed(task)) counts.Today++
        else if (classifyView(task) === 'Later') counts.Later++
      }
    }
    return { counts, perDay }
  }, [tasks, weekStart, weekEnd])
  const viewCount = (tab: View) => taskCounts.counts[tab]

  const todayLabel = selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const pushConfigured = Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY)
  const showNotificationPrompt = Boolean(preferences && tasks.some(task => !task.deleted_at)
    && !preferences.daily_nudge_enabled && preferences.prompt_dismissals < 2
    && pushConfigured
    && (!preferences.prompt_reoffer_at || new Date(preferences.prompt_reoffer_at) <= new Date())
    && 'PushManager' in window
    && (!('Notification' in window) || Notification.permission !== 'denied'))
  const laterThisWeekTasks = weekTasks.filter(task => task.due_at && (task.due_is_approx ? new Date(task.due_at) > selectedDay : new Date(task.due_at) >= addLocalDays(selectedDay, 1)))
  async function moveOneThingToTomorrow(task: Task) {
    const due = dateForChoice('tomorrow')
    await updateTask(task, due)
  }
  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  if (!isSupabaseConfigured) return <main className="setup-wrap"><section className="setup-card"><div className="brand-mark"><Check size={18} /></div><p className="eyebrow">A quiet place for your tasks</p><h1>Taskflow</h1><p>Add your Supabase project URL and public anon key to <code>.env</code>, run the migration, then restart the app.</p><p className="setup-hint">See <code>.env.example</code> and <code>supabase/migrations</code>.</p></section></main>
  if (!sessionReady) return <main className="setup-wrap"><p>Loading…</p></main>
  if (!signedIn) return <AuthScreen onSignedIn={() => setSignedIn(true)} />

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#" aria-label="Taskflow home"><span className="brand-mark"><Check size={16} /></span><span>Taskflow</span></a><div className="topbar-right">{installPrompt && <button className="text-button install-button" onClick={() => void installApp()}><Download size={15}/>Install app</button>}<span className="sync-state">{isOnline && syncStatus === 'Synced' && <span className="online-dot" />}{isOnline ? syncStatus : 'Offline'}</span><button className="text-button" aria-expanded={settingsOpen} onClick={() => { setSettingsOpen(open => !open); if (!settingsOpen) void loadNotificationSettings() }}>Settings</button><button className="text-button signout" onClick={() => supabase?.auth.signOut()}>Sign out</button></div></header>
    {!isOnline && <div className="offline-banner" role="status">Offline · showing your last saved tasks. Reconnect to make changes.</div>}
    <div className="workspace">
      <aside className="sidebar"><p className="nav-label">Your lists</p><nav aria-label="Task views">{tabs.map(tab => <button key={tab} className={`nav-item ${view === tab ? 'selected' : ''}`} aria-current={view === tab ? 'page' : undefined} onClick={() => chooseView(tab)}>{tab === 'Today' ? <Sun size={16}/> : tab === 'Inbox' ? <Inbox size={16}/> : tab === 'Later' ? <Clock size={16}/> : tab === 'This week' ? <CalendarRange size={16}/> : <CircleCheck size={16}/>} {tab}<span className="nav-count">{viewCount(tab)}</span></button>)}</nav></aside>
      <main className="main-content">
        <div className={`content-inner ${view === 'Today' ? 'today-content' : ''}`}>
          {settingsOpen && <section className="settings-panel" aria-label="Notification settings"><div className="settings-heading"><div><p className="eyebrow">A quieter way to stay on top</p><h2>Notifications</h2></div><button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={17}/></button></div>
            <p className="settings-copy">Taskflow only sends the daily nudge you choose and reminders you set on a task.</p>
            {!pushConfigured && <p className="settings-copy" role="status">Notifications need the public push key configured before this app can enable them.</p>}
            <div className="settings-grid"><label>Daily nudge time<input type="time" value={settingsDraft.daily_nudge_time.slice(0, 5)} onChange={e => setSettingsDraft(d => ({ ...d, daily_nudge_time: e.target.value }))}/></label><label>Quiet hours start<input type="time" value={settingsDraft.quiet_hours_start.slice(0, 5)} onChange={e => setSettingsDraft(d => ({ ...d, quiet_hours_start: e.target.value }))}/></label><label>Quiet hours end<input type="time" value={settingsDraft.quiet_hours_end.slice(0, 5)} onChange={e => setSettingsDraft(d => ({ ...d, quiet_hours_end: e.target.value }))}/></label></div>
            <label className="settings-check"><input type="checkbox" checked={settingsDraft.weekly_summary_enabled} onChange={e => setSettingsDraft(d => ({ ...d, weekly_summary_enabled: e.target.checked }))}/>Send a short summary on Sunday</label>
            <div className="settings-actions"><button className="secondary-button" disabled={!isOnline || !preferences} onClick={() => void saveNotificationTimes()}>Save times</button><button className="secondary-button" disabled={!isOnline} onClick={() => void exportBackup()}>Export data</button><label className="secondary-button backup-import">Restore backup<input type="file" accept="application/json,.json" disabled={!isOnline} onChange={e => { void restoreBackup(e.target.files?.[0]); e.currentTarget.value = '' }}/></label>{preferences?.daily_nudge_enabled && devicePushStateChecked && !currentPushEndpoint && <button className="primary-button" disabled={!isOnline || !pushConfigured || pushBusy} onClick={() => void enableNotifications()}>{pushBusy ? 'Setting up…' : 'Set up this device'}</button>}{preferences?.daily_nudge_enabled ? <button className="secondary-button" disabled={!isOnline} onClick={() => void savePreferences({ daily_nudge_enabled: false, prompt_dismissals: 2 })}>Turn off daily nudge</button> : <button className="primary-button" disabled={!isOnline || !pushConfigured || pushBusy} onClick={() => void enableNotifications()}>{pushBusy ? 'Setting up…' : 'Turn on daily nudge'}</button>}{preferences?.daily_nudge_enabled && <button className="secondary-button" disabled={!isOnline || !pushConfigured || pushBusy} onClick={() => void testNotification()}>{pushBusy ? 'Sending…' : 'Send test notification'}</button>}</div>
            <div className="settings-devices"><strong>Devices receiving notifications</strong>{pushSubscriptions.length ? pushSubscriptions.map((device, index) => <div className="settings-device-row" key={device.id}><span>{currentPushEndpoint === device.endpoint ? 'This device' : `Other device ${index + 1}`}</span><button className="text-button" disabled={!isOnline} onClick={() => void removeSubscription(device)}>Remove</button></div>) : <p className="settings-copy">No devices are set up yet.</p>}</div>
            {notificationMessage && <p className="settings-copy" role="status">{notificationMessage}</p>}
          </section>}
          {showNotificationPrompt && <aside className="nudge-offer" aria-label="Daily nudge setup"><span>Want a daily nudge so nothing slips?</span><div><button className="primary-button" disabled={!isOnline || pushBusy} onClick={() => void enableNotifications()}>{pushBusy ? 'Setting up…' : 'Yes'}</button><button className="text-button" disabled={!isOnline} onClick={() => void deferNotificationPrompt()}>Not now</button></div></aside>}
          <div className="page-heading"><h1>{view}</h1>{view === 'Today' && <p className="list-caption">{todayLabel}</p>}</div>
          <Composer ref={composerRef} labels={labels} isOnline={isOnline} busy={busy} onSubmit={addTask} onCreateLabel={createLabel} onRenameLabel={renameLabel} onDeleteLabel={deleteLabel}/>
          {error && <div className="error-banner" role="alert">{error}<button className="text-button" disabled={!isOnline || pushBusy} onClick={() => retryPushSetup === null ? void load() : void setupPush(retryPushSetup)}>Retry</button></div>}
          <div key={view} className="view-enter">
          {view === 'Today' && <section className="day-strip" aria-label="Choose a day">{todayDays.map(day => {
            const count = taskCounts.perDay.get(localDayKey(day)) ?? 0
            return <button type="button" key={day.toISOString()} className={`day-strip-item ${isSameLocalDay(day, selectedDay) ? 'selected' : ''}`} aria-pressed={isSameLocalDay(day, selectedDay)} onClick={() => selectDay(day)}><span>{isSameLocalDay(day, new Date()) ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{day.getDate()}</strong><span className="day-strip-count">{count || ' '}</span></button>
          })}</section>}
          {view === 'Today' && <div className="today-split">
            {basicTasks.length > 0 && <aside className="quick-details-prompt"><span>{basicTasks.length} {basicTasks.length === 1 ? 'Inbox task could' : 'Inbox tasks could'} use more details.</span><button className="secondary-button" onClick={() => openTaskDetailsInInbox(basicTasks[0].id)}>Open Inbox</button></aside>}
            {selectedQuickTask && <section className="quick-details-card" aria-label="Quick details"><p className="eyebrow">Quick details · {basicTasks.findIndex(task => task.id === selectedQuickTask.id) + 1} of {basicTasks.length}</p><h2>{selectedQuickTask.title}</h2><label className="description-field">Description<textarea aria-label="Description" maxLength={5000} disabled={!isOnline} value={quickDescription} placeholder="Add helpful context…" onChange={e => setQuickDescription(e.target.value)} onBlur={() => { const description = quickDescription.trim(); if (description !== (selectedQuickTask.description ?? "")) void updateTask(selectedQuickTask, { description }) }}/></label>{selectedQuickTask.due_at && selectedQuickTask.due_is_approx && <div className="chip-row"><span className="chip-group-label">Choose a day</span>{Array.from({ length: 7 }, (_, index) => addLocalDays(startOfLocalWeek(new Date(selectedQuickTask.due_at!)), index)).filter(day => day >= startOfLocalDay(new Date())).map(day => <button key={day.toISOString()} className="choice-chip" onClick={() => void updateTask(selectedQuickTask, { due_at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString(), due_is_approx: false })}>{day.toLocaleDateString(undefined, { weekday: 'short' })} {day.getDate()}</button>)}</div>}
              <div className="chip-row"><label className="choice-chip date-chip"><CalendarDays size={14}/><span>When</span><input aria-label="When" type="date" value={localDateInput(selectedQuickTask.due_at)} onChange={e => void updateTask(selectedQuickTask, { due_at: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null, due_is_approx: false, recurrence_rule: e.target.value ? selectedQuickTask.recurrence_rule : null })}/></label><label className="select-chip"><span>Due time</span><input aria-label="Due time" type="time" value={selectedQuickTask.is_all_day ? "" : localTimeInput(selectedQuickTask.due_at)} onChange={e => void updateTask(selectedQuickTask, { ...(e.target.value ? { due_at: withLocalTime(selectedQuickTask.due_at, e.target.value) } : {}), due_is_approx: false, is_all_day: !e.target.value })}/></label><label className="select-chip"><span>Repeat</span><select aria-label="Repeat" value={selectedQuickTask.recurrence_rule ?? ""} onChange={e => setQuickTaskRepeat(e.target.value)}><option value="">Never</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="select-chip"><span>Reminder</span><select aria-label="Reminder" disabled={!isOnline || !selectedQuickTask.due_at || selectedQuickTask.due_is_approx} value={selectedQuickTask.reminder_offset} onChange={e => void updateTask(selectedQuickTask, { reminder_offset: e.target.value as Task["reminder_offset"] })}><option value="none">None</option><option value="at_time">At due time</option><option value="1_day_before">1 day before</option><option value="2_days_before">2 days before</option></select></label><label className="select-chip"><span>Size</span><select aria-label="Size" value={selectedQuickTask.size ?? ''} onChange={e => void updateTask(selectedQuickTask, { size: (e.target.value || null) as Task['size'] })}><option value="">Not set</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label><button className={`choice-chip ${selectedQuickTask.is_important ? 'starred' : ''}`} aria-pressed={selectedQuickTask.is_important} onClick={() => void updateTask(selectedQuickTask, { is_important: !selectedQuickTask.is_important })}><Star size={15}/>Important</button><label className="select-chip"><span>Label</span><select aria-label="Label" value={selectedQuickTask.label_id ?? ''} onChange={e => void updateTask(selectedQuickTask, { label_id: e.target.value || null })}><option value="">None</option>{labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label></div><div className="quick-details-actions"><button className="text-button" onClick={() => void finishQuickDetails(true)}>Skip</button><button className="primary-button" onClick={() => void finishQuickDetails(false)}>Done</button></div></section>}
            <section className="day-pane"><div className="pane-heading"><div><p className="eyebrow">Selected day</p><h2>{isSameLocalDay(selectedDay, new Date()) ? 'Today' : todayLabel}</h2></div></div>
              {oneThing && <article key={oneThing.id} className={`one-thing-card ${completingIds.has(oneThing.id) ? 'task-completing' : ''} ${settleIndexById.has(oneThing.id) ? 'task-settling' : ''}`}><p className="eyebrow">One thing to start with</p><h3><span className="task-title-text">{oneThing.title}</span></h3><p className="one-thing-reason">{oneThing.is_important ? 'Important' : oneThing.size ? (oneThing.size === 'quick' ? 'Quick task' : oneThing.size === 'hour' ? 'About an hour' : 'A bigger task') : `Due ${isSameLocalDay(selectedDay, new Date()) ? 'today' : selectedDay.toLocaleDateString(undefined, { weekday: 'long' })}`}</p><div className="one-thing-actions"><button className="secondary-button accent-outline-button" disabled={!isOnline || completingIds.has(oneThing.id)} onClick={() => void completeTask(oneThing)}>Done</button><button className="secondary-button" disabled={!isOnline} onClick={() => void moveOneThingToTomorrow(oneThing)}>Tomorrow</button></div></article>}
              {timedTodayTasks.length > 0 && <section className="schedule">
                <h3 className="lane-heading">Schedule</h3>
                <DayGrid timed={timedTodayTasks} now={viewingToday ? now : null} nextTaskId={oneThing?.id}
                  completingIds={completingIds} settleIndexById={settleIndexById} isOnline={isOnline}
                  onComplete={onRowComplete} onOpen={openDaySheet}/>
              </section>}
              {(anytimeTasks.length > 0 || timedTodayTasks.length === 0) && <section className="anytime">
                {timedTodayTasks.length > 0 && <h3 className="lane-heading">Anytime</h3>}
                {allClear ? <div className="all-clear" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M20 6 9 17l-5-5" transform="translate(-4 .5) scale(.85)"/></svg><p>All clear for today.</p></div>
                  : renderTaskRows(anytimeTasks, `Anytime on ${todayLabel}`, oneThing || timedTodayTasks.length ? 'No other tasks for this day.' : 'Nothing is planned for this day.')}
              </section>}
              {missedTasks.length > 0 && <section className="missed-list"><h3>Missed</h3>{renderTaskRows(missedTasks, 'Missed tasks')}</section>}
            </section>
            <aside className="week-pane"><div className="pane-heading"><div><p className="eyebrow">Coming up</p><h2>This week</h2></div><button className="text-button pane-link" onClick={() => chooseView('This week')}>Open week</button></div>{renderWeekAgenda(laterThisWeekTasks, selectedDay)}</aside>
          </div>}
          {view === 'This week' && <section className="week-view"><div className="pane-heading"><div><p className="eyebrow">Monday–Sunday</p><h2>This week</h2></div></div>{renderWeekAgenda(visibleTasks)}</section>}
          {view === 'Inbox' && basicTasks.length > 0 && <aside className="quick-details-prompt details-inbox-prompt"><span>{basicTasks.length} {basicTasks.length === 1 ? 'task could' : 'tasks could'} use more details.</span><button className="secondary-button" onClick={() => openTaskDetailsInInbox(basicTasks[0].id)}>Add details</button></aside>}
          {(view === 'Inbox' || view === 'Later' || view === 'Done') && renderTaskRows(visibleTasks, view)}
          {view === 'Done' && <section className="removed-section"><div className="removed-heading"><h2><ArchiveRestore size={17}/>Recently removed</h2>{deletedTasks.length > 0 && <button className="secondary-button" disabled={!isOnline || clearDeletedBusy} onClick={() => void clearDeletedTasks()}>{clearDeletedBusy ? 'Clearing…' : 'Clear all'}</button>}</div>{deletedTasks.length ? deletedTasks.map(task => <div className="removed-row" key={task.id}><span>{task.title}</span><button className="secondary-button" disabled={!isOnline} onClick={() => void restoreTask(task)}><RotateCcw size={14}/>Restore</button></div>) : tasksLoaded ? <p className="removed-empty">Removed tasks can be restored here.</p> : <><span className="sr-only" role="status">Loading tasks</span><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/></>}</section>}
          </div>
        </div>
      </main>
    </div>
    {toast && <div className={`toast ${toastClosing ? 'toast-closing' : ''}`} role="status"><span>{toast.text}</span>{toast.action && <button onClick={() => { toast.action?.run(); setToast(null) }}>{toast.action.label}</button>}{toast.undo && <button disabled={!isOnline} onClick={() => { void toast.undo?.(); setToast(null) }}>Undo</button>}</div>}
    {sheetTask && <DayTaskSheet onClose={closeSheet}>
      <TaskRow task={sheetTask} labels={labels} listName="Today" isOnline={isOnline} expanded isNew={false}
        isCompleting={false} isSettling={false} settleIndex={0}
        onToggleExpand={() => closeSheet()}
        onComplete={task => { closeSheet(); onRowComplete(task) }}
        onUpdate={onRowUpdate} onRemove={task => { closeSheet(); onRowRemove(task) }}/>
    </DayTaskSheet>}
    <nav className="mobile-tabs" aria-label="Task views">{tabs.map(tab => <button key={tab} className={view === tab ? 'active' : ''} aria-current={view === tab ? 'page' : undefined} onClick={() => chooseView(tab)}>{tab === 'Today' ? <Sun size={16}/> : tab === 'Inbox' ? <Inbox size={16}/> : tab === 'Later' ? <Clock size={16}/> : tab === 'This week' ? <CalendarRange size={16}/> : <CircleCheck size={16}/>} {tab}</button>)}</nav>
  </div>
}

export default App
