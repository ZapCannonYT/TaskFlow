import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CalendarCheck, CalendarRange, CalendarX, Check, CircleCheck, Download, Inbox, Plus, Settings as SettingsIcon, Sun, X } from 'lucide-react'
import { isSupabaseConfigured, Label, supabase, Task } from './lib/supabase'
import { localDayKey, addLocalDays, classifyView, dateForChoice, getSevenDays, isDueOnDay, isMissed, isSameLocalDay, movedToToday, localDateInput, rankOneThing, startOfLocalDay } from './lib/dates'
import { isBasicTask, needsDetailsPrompt } from './lib/quickDetails'
import { isRecentDuplicate } from './lib/taskRules'
import { rankCompanionTasks } from './lib/companion'
import { nextOccurrence } from './lib/recurrence'
import { Composer, type ComposerHandle, type DraftDetails } from './components/Composer'
import { TaskRow } from './components/TaskRow'
import { DayGrid } from './components/DayGrid'
import { AuthScreen } from './components/AuthScreen'
import { LoadingRows } from './components/LoadingRows'
import { QuickDetailsCard } from './components/QuickDetailsCard'
import { RemovedSection } from './components/RemovedSection'
import { SettingsPage } from './features/settings/SettingsPage'
import { useNotificationSettings } from './features/settings/useNotificationSettings'
import { useTaskSync, type PendingCompletion } from './features/tasks/useTaskSync'
import { useVisualViewport } from './lib/useVisualViewport'
import { useDayKey } from './lib/useDayKey'
import { dropParams } from './lib/url'
import { exportBackup, restoreBackup } from './lib/backup'
import { useNow } from './lib/useNow'
import { getMotionPref, motionScale, prefersReducedMotion, setMotionPref, type MotionPref } from './lib/motion'
import { splitDayTasks } from './features/today/dayLayout'
import { lockTask, placeTasks, type EditLock } from './lib/editLock'

type View = 'Today' | 'Inbox' | 'This week' | 'Missed' | 'Done'
const NO_TASKS: Task[] = []
const MAX_BACKUP_BYTES = 20 * 1024 * 1024
const MISSED_DISMISSED_KEY = 'taskflow:missed-reminder-dismissed'
const tabs: View[] = ['Today', 'Inbox', 'This week', 'Missed', 'Done']
const TAB_ICONS: Record<View, ReactNode> = { Today: <Sun size={16}/>, Inbox: <Inbox size={16}/>, 'This week': <CalendarRange size={16}/>, Missed: <CalendarX size={16}/>, Done: <CircleCheck size={16}/> }

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }

const SETTLE_START_MS = 420
const SETTLE_OUT_MS = 220
const SETTLE_STEP_MS = 0
const SETTLE_STAGGER_CAP = 0
const buzz = () => { if (!prefersReducedMotion()) navigator.vibrate?.(10) }

function App() {
  useVisualViewport()
  const [sessionReady, setSessionReady] = useState(!isSupabaseConfigured)
  const [signedIn, setSignedIn] = useState(false)
  // Following a password reset link signs in with a recovery session; ask for the new password before the app opens.
  const [recovering, setRecovering] = useState(false)
  const [view, setViewState] = useState<View>('Today')
  const [selectedDay, setSelectedDay] = useState(() => startOfLocalDay(new Date()))
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ text: string; compact?: boolean; undo?: () => Promise<void>; action?: { label: string; run: () => void } } | null>(null)
  const [toastClosing, setToastClosing] = useState(false)
  const [newTaskId, setNewTaskId] = useState<string | null>(null)
  const [completingIds, setCompletingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [settlingIds, setSettlingIds] = useState<readonly string[]>([])
  const [completedThisSession, setCompletedThisSession] = useState(0)
  // A task opened from the schedule is shown, expanded, at the top of Inbox.
  const [pinnedEditId, setPinnedEditId] = useState<string | null>(null)
  const [clearDeletedBusy, setClearDeletedBusy] = useState(false)
  const inboxReleaseTimersRef = useRef(new Map<string, number>())
  const [busy, setBusy] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [motionPref, setMotionPrefState] = useState<MotionPref>(getMotionPref)
  const [quickDetailsTaskId, setQuickDetailsTaskId] = useState<string | null>(null)
  const composerRef = useRef<ComposerHandle>(null)
  // Phones show the composer only after the floating Add button is tapped; desktop ignores this.
  const [composerOpen, setComposerOpen] = useState(false)
  const openComposer = useCallback(() => { flushSync(() => setComposerOpen(true)); composerRef.current?.focus() }, [])
  const pendingRef = useRef(new Map<string, PendingCompletion>())
  const addingRef = useRef(false)
  const settleTimerRef = useRef<number | undefined>(undefined)
  const commitTimerRef = useRef<number | undefined>(undefined)
  const settleIndexById = useMemo(() => new Map(settlingIds.map((id, index) => [id, Math.min(index, SETTLE_STAGGER_CAP)] as const)), [settlingIds])
  const setCompleting = (id: string, on: boolean) => setCompletingIds(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next })
  const [errorRetryable, setErrorRetryable] = useState(false)
  const { tasks, setTasks, labels, setLabels, tasksLoaded, syncStatus, load } = useTaskSync({ signedIn, userId, pendingRef, setError, setErrorRetryable })
  const settings = useNotificationSettings({ signedIn, isOnline, setError, setErrorRetryable })
  const dayKey = useDayKey()

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
    supabase.auth.getSession().then(({ data }) => { setSignedIn(Boolean(data.session)); setUserId(data.session?.user.id ?? null); setUserEmail(data.session?.user.email ?? null); setSessionReady(true) })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSignedIn(Boolean(session)); setUserId(session?.user.id ?? null); setUserEmail(session?.user.email ?? null)
      if (!session) setSettingsOpen(false)
      if (!session) {
        try { Object.keys(localStorage).filter(key => key.startsWith('taskflow:snapshot:')).forEach(key => localStorage.removeItem(key)) }
        catch { /* local snapshots are optional */ }
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])


  useEffect(() => {
    if (!toast) return
    setToastClosing(false)
    const closeTimeout = window.setTimeout(() => setToastClosing(true), 4850)
    const removeTimeout = window.setTimeout(() => setToast(null), 5000)
    return () => { window.clearTimeout(closeTimeout); window.clearTimeout(removeTimeout) }
  }, [toast])

  useEffect(() => {
    if (quickDetailsTaskId && tasks.length > 0 && !tasks.some(task => task.id === quickDetailsTaskId && task.status === 'open' && !task.deleted_at && task.is_inbox && !task.details_prompted_at)) {
      setQuickDetailsTaskId(tasks.find(needsDetailsPrompt)?.id ?? null)
    }
  }, [quickDetailsTaskId, tasks])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(null); setComposerOpen(false); setSettingsOpen(false); return }
      if (!(event.key === '/' || event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'c') || event.ctrlKey || event.metaKey || event.altKey) return
      const active = document.activeElement
      if (active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return
      event.preventDefault(); openComposer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openComposer])

  // "This week" is a rolling seven days from today, matching the day strip, so it is never nearly empty on a Sunday.
  const weekStart = useMemo(() => startOfLocalDay(new Date()), [dayKey])
  const weekEnd = useMemo(() => addLocalDays(weekStart, 7), [weekStart])
  // The open task keeps its place in every list until editing ends (Done, Escape, or opening another task).
  const [editLock, setEditLock] = useState<EditLock | null>(null)
  useEffect(() => { setEditLock(current => current?.id === expanded ? current : lockTask(tasks.find(task => task.id === expanded))) }, [expanded])
  const placedTasks = useMemo(() => placeTasks(tasks, editLock), [tasks, editLock])
  const visibleTasks = useMemo(() => {
    const active = placedTasks.filter(task => !task.deleted_at)
    if (view === 'Done') return active.filter(task => task.status === 'completed')
    if (view === 'Today') return active.filter(task => task.status === 'open' && !task.is_inbox && isDueOnDay(task, selectedDay))
    if (view === 'Inbox') return active.filter(task => task.status === 'open' && classifyView(task) === 'Inbox')
    return active.filter(task => task.status === 'open' && !task.is_inbox && task.due_at && new Date(task.due_at) >= weekStart && new Date(task.due_at) < weekEnd)
  }, [placedTasks, view, selectedDay, weekStart, weekEnd])
  const deletedTasks = useMemo(() => tasks.filter(task => task.deleted_at), [tasks])
  const todayDays = useMemo(() => getSevenDays(), [dayKey])
  // Tasks beyond this week used to live in a separate Later tab; they now close out the week view.
  const afterWeekTasks = useMemo(() => placedTasks.filter(task => !task.deleted_at && task.status === 'open' && !task.is_inbox && task.due_at && new Date(task.due_at) >= weekEnd).sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!)), [placedTasks, weekEnd])
  const selectedDayTasks = view === 'Today' ? visibleTasks : NO_TASKS
  // The top-ranked task for the day gets a highlight in the schedule.
  const nextTask = useMemo(() => rankOneThing(selectedDayTasks)[0], [selectedDayTasks])
  const { timed: allTimed, anytime: allAnytime } = useMemo(() => splitDayTasks(selectedDayTasks), [selectedDayTasks])
  // Open dated tasks from before today live in their own Missed tab, oldest first.
  const missedTasks = useMemo(() => placedTasks.filter(task => !task.deleted_at && task.status === 'open' && !task.is_inbox && isMissed(task))
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!)), [placedTasks, dayKey])
  const missedIds = useMemo(() => new Set(missedTasks.map(task => task.id)), [missedTasks])
  // Only today or later can be selected, so nothing here is ever missed.
  const timedTodayTasks = allTimed
  const anytimeTasks = allAnytime
  const [missedDismissedDay, setMissedDismissedDay] = useState(() => { try { return localStorage.getItem(MISSED_DISMISSED_KEY) } catch { return null } })
  const showMissedReminder = missedTasks.length > 0 && missedDismissedDay !== dayKey
  const dismissMissedReminder = () => { setMissedDismissedDay(dayKey); try { localStorage.setItem(MISSED_DISMISSED_KEY, dayKey) } catch { /* the reminder just returns next visit */ } }
  const viewingToday = isSameLocalDay(selectedDay, new Date())
  const now = useNow(view === 'Today' && viewingToday)
  const pinnedTask = pinnedEditId ? tasks.find(task => task.id === pinnedEditId && !task.deleted_at && task.status === 'open') : undefined
  const allClear = view === 'Today' && viewingToday && timedTodayTasks.length === 0 && anytimeTasks.length === 0 && completedThisSession > 0
  const basicTasks = useMemo(() => tasks.filter(task => classifyView(task) === 'Inbox' && needsDetailsPrompt(task)), [tasks])
  const selectedQuickTask = quickDetailsTaskId ? tasks.find(task => task.id === quickDetailsTaskId && task.status === 'open' && !task.deleted_at && task.is_inbox && !task.details_prompted_at) : undefined

  function openSettings() {
    commitCompletions()
    setExpanded(null)
    setComposerOpen(false)
    setSettingsOpen(true)
    void settings.loadNotificationSettings()
    window.scrollTo({ top: 0 })
  }

  function chooseView(nextView: View) {
    setSettingsOpen(false)
    commitCompletions()
    setPinnedEditId(null)
    if (nextView === 'Today') setSelectedDay(startOfLocalDay(new Date()))
    setViewState(nextView)
    setError('')
    setErrorRetryable(false)
  }

  function openFromSchedule(task: Task) {
    commitCompletions()
    setPinnedEditId(task.id)
    setExpanded(task.id)
    setViewState('Inbox')
    setError('')
    window.scrollTo({ top: 0 })
  }

  const selectDay = (day: Date) => { commitCompletions(); setSelectedDay(day) }

  useEffect(() => {
    const flush = () => { if (document.hidden) commitCompletions() }
    document.addEventListener('visibilitychange', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.clearTimeout(settleTimerRef.current); window.clearTimeout(commitTimerRef.current)
      inboxReleaseTimersRef.current.forEach(timer => window.clearTimeout(timer))
    }
  }, [])

  function openTaskDetailsInInbox(taskId: string) {
    setQuickDetailsTaskId(null)
    setExpanded(taskId)
    setViewState('Inbox')
    setError('')
  }

  async function addTask(rawTitle: string, draft: DraftDetails): Promise<boolean> {
    const cleanTitle = rawTitle.replace(/\s+/g, ' ').trim()
    if (!supabase || !cleanTitle || busy || addingRef.current || !isOnline) return false
    if (isRecentDuplicate(tasks, cleanTitle, draft.due_at)) { setToast({ text: 'Already added', compact: true }); return true }
    const client = supabase
    addingRef.current = true
    setBusy(true); setError('')
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { addingRef.current = false; setBusy(false); setError('Sign in again to save this task.'); return false }
    const result = await client.from('tasks').insert({ user_id: auth.user.id, title: cleanTitle, ...draft, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' }).select('*, labels(name)').single()
    addingRef.current = false
    setBusy(false)
    if (result.error) { setError(`Not saved · ${result.error.message}`); return false }
    setTasks(current => current.some(task => task.id === result.data.id) ? current : [result.data as Task, ...current]); setError('')
    setNewTaskId(result.data.id)
    window.setTimeout(() => setNewTaskId(current => current === result.data.id ? null : current), 720 * motionScale())
    const addedTask = result.data as Task
    const addDetails = needsDetailsPrompt(addedTask) && classifyView(addedTask) === 'Inbox'
    setToast({
      text: addDetails ? 'Added to Inbox' : 'Task added',
      compact: true,
      ...(addDetails ? { action: { label: 'Details', run: () => openTaskDetailsInInbox(addedTask.id) } } : {}),
      undo: async () => { const deletedAt = new Date().toISOString(); const undone = await client.from('tasks').update({ deleted_at: deletedAt, updated_at: deletedAt }).eq('id', result.data.id); if (!undone.error) setTasks(current => current.map(t => t.id === result.data.id ? { ...t, deleted_at: deletedAt, updated_at: deletedAt } : t)); else setError(`Not saved · ${undone.error.message}`) },
    })
    return true
  }

  async function exportData() {
    if (!isOnline) { setError('Reconnect to export your latest data.'); return }
    setError(await exportBackup())
  }

  async function restoreData(file?: File) {
    if (!file || !isOnline) return
    if (file.size > MAX_BACKUP_BYTES) { setError('Backup not restored · That file is too large to be a Taski backup.'); return }
    try { await restoreBackup(file); await load(); setError(''); setToast({ text: 'Backup restored' }) }
    catch (cause) { setError(`Backup not restored · ${cause instanceof Error ? cause.message : 'Check the file and try again.'}`) }
  }

  async function finishQuickDetails(skip: boolean) {
    if (!selectedQuickTask) { setQuickDetailsTaskId(null); return }
    const task = selectedQuickTask
    const releaseTimer = inboxReleaseTimersRef.current.get(task.id)
    if (releaseTimer !== undefined) { window.clearTimeout(releaseTimer); inboxReleaseTimersRef.current.delete(task.id) }
    const result = await supabase?.from('tasks').update({ details_prompted_at: new Date().toISOString(), is_inbox: false, updated_at: new Date().toISOString() }).eq('id', task.id).select('*, labels(name)').single()
    if (result?.error) { setError(`Not saved · ${result.error.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? result!.data as Task : item))
    setQuickDetailsTaskId(basicTasks.find(item => item.id !== task.id)?.id ?? null)
    if (skip) setError('')
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
      // A link can be typed by anyone; act only when it matches a real reminder of yours for that same task.
      const reminder = await supabase!.from('task_reminders').select('id, task_id').eq('id', reminderId).maybeSingle()
      if (reminder.error || !reminder.data || (taskId && reminder.data.task_id !== taskId)) {
        dropParams(params, 'task_action', 'task_id', 'reminder_id')
        return
      }
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
        await settings.savePreferences({ skipped_until: skipped })
      }
      await supabase!.from('task_reminders').update({ action_at: new Date().toISOString(), action }).eq('id', reminderId)
      dropParams(params, 'task_action', 'task_id', 'reminder_id')
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
      if (shared) { composerRef.current?.setTitle(shared); openComposer() }
      dropParams(params, 'share', 'title', 'text', 'url')
    }
    if (params.get('open') === 'inbox') { chooseView('Inbox'); dropParams(params, 'open') }
    const quickDetailsId = params.get('quick_details')
    if (quickDetailsId) { openTaskDetailsInInbox(quickDetailsId); dropParams(params, 'quick_details') }
    if (params.get('capture') === 'voice') { dropParams(params, 'capture'); setComposerOpen(true); window.setTimeout(() => composerRef.current?.startVoice(), 300) }
  }, [signedIn])

  async function updateTask(task: Task, values: Partial<Task>) {
    if (!supabase || !isOnline) return
    const existingReleaseTimer = inboxReleaseTimersRef.current.get(task.id)
    if (existingReleaseTimer !== undefined) { window.clearTimeout(existingReleaseTimer); inboxReleaseTimersRef.current.delete(task.id) }
    const updatedAt = new Date().toISOString()
    const nextValues = { ...values }
    const { data, error: updateError } = await supabase.from('tasks').update({ ...nextValues, updated_at: updatedAt }).eq('id', task.id).select('*, labels(name)').single()
    if (updateError) { setError(`Not saved · ${updateError.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? data as Task : item))
    const updatedTask = data as Task
    if (task.is_inbox && updatedTask.due_at && !isBasicTask(updatedTask)) {
      const timer = window.setTimeout(() => {
        inboxReleaseTimersRef.current.delete(task.id)
        void releaseInboxTask(updatedTask)
      }, 1200)
      inboxReleaseTimersRef.current.set(task.id, timer)
    }
    if (values.reminder_offset && values.reminder_offset !== 'none' && !settings.currentPushEndpoint) void settings.setupPush(false)
  }

  async function moveAllToToday(list: Task[]) {
    const before = list.map(task => [task, { due_at: task.due_at, due_is_approx: task.due_is_approx }] as const)
    await Promise.all(list.map(task => updateTask(task, movedToToday(task))))
    setToast({ text: `Moved ${list.length} to today`, undo: async () => { await Promise.all(before.map(([task, values]) => updateTask(task, values))) } })
  }

  async function releaseInboxTask(task: Task) {
    if (!supabase || !isOnline || !task.is_inbox || !task.due_at || isBasicTask(task)) return
    const releasedAt = new Date().toISOString()
    const { data, error: releaseError } = await supabase.from('tasks').update({ is_inbox: false, details_prompted_at: releasedAt, updated_at: releasedAt }).eq('id', task.id).eq('is_inbox', true).select('*, labels(name)').maybeSingle()
    if (releaseError) { setError(`Task could not leave Inbox · ${releaseError.message}`); return }
    if (!data) return
    setTasks(current => current.map(item => item.id === task.id ? data as Task : item))
    setQuickDetailsTaskId(current => current === task.id ? basicTasks.find(item => item.id !== task.id)?.id ?? null : current)
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
    window.setTimeout(() => setNewTaskId(current => current === task.id ? null : current), 720 * motionScale())
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
    if (updateError || !completedRow) { abort(); setNewTaskId(task.id); window.setTimeout(() => setNewTaskId(current => current === task.id ? null : current), 720 * motionScale()); setError(updateError ? `Not saved · ${updateError.message}` : 'This task was already changed on another device. Refresh and try again.'); return }
    let nextTask: Task | null = null
    if (task.recurrence_rule && task.due_at) {
      const next = await client.from('tasks').insert({
        user_id: task.user_id, title: task.title, status: 'open', due_at: nextOccurrence(task.recurrence_rule, task.due_at, task.recurrence_day ?? new Date(task.due_at).getDate(), new Date(completedAt)),
        due_is_approx: false, is_all_day: task.is_all_day, timezone: task.timezone, size: task.size,
        is_important: task.is_important, label_id: task.label_id, color: task.color ?? null, reminder_offset: task.reminder_offset, reminder_minutes: task.reminder_minutes ?? null,
        recurrence_rule: task.recurrence_rule, recurrence_parent_id: task.id, recurrence_day: task.recurrence_day ?? new Date(task.due_at).getDate(),
        description: task.description ?? '', is_inbox: false, details_prompted_at: completedAt,
      }).select('*, labels(name)').single()
      if (next.error?.code === '23505') {
        const existing = await client.from('tasks').select('*, labels(name)').eq('recurrence_parent_id', task.id).eq('status', 'open').is('deleted_at', null).maybeSingle()
        if (existing.data) { next.data = existing.data; next.error = null }
      }
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
    const collapse = (SETTLE_START_MS + SETTLE_OUT_MS) * motionScale() + SETTLE_STEP_MS * Math.min(ids.length - 1, SETTLE_STAGGER_CAP)
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
    setTasks(current => current.map(item => item.id === task.id ? { ...item, deleted_at: deletedAt, updated_at: deletedAt } : item))
    if (expanded === task.id) setExpanded(null)
    setToast({ text: 'Task removed', undo: async () => { const restoredAt = new Date().toISOString(); const undone = await client.from('tasks').update({ deleted_at: null, updated_at: restoredAt }).eq('id', task.id); if (!undone.error) setTasks(current => current.map(item => item.id === task.id ? { ...item, deleted_at: null, updated_at: restoredAt } : item)); else setError(`Not saved · ${undone.error.message}`) } })
  }

  async function restoreTask(task: Task) {
    if (!supabase || !isOnline) return
    const restoredAt = new Date().toISOString()
    const { error: updateError } = await supabase.from('tasks').update({ deleted_at: null, updated_at: restoredAt }).eq('id', task.id)
    if (updateError) { setError(`Not saved · ${updateError.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? { ...item, deleted_at: null, updated_at: restoredAt } : item))
  }

  async function purgeTask(task: Task) {
    if (!supabase || !isOnline) return
    if (!window.confirm(`Permanently delete "${task.title}"? This cannot be undone.`)) return
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id)
    if (deleteError) { setError(`Could not delete task · ${deleteError.message}`); return }
    setTasks(current => current.filter(item => item.id !== task.id))
    setToast({ text: 'Task deleted for good' })
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

  function renderTaskRows(items: Task[], listName: string, emptyMessage = "Nothing here yet.", hideDate = false) {
    return <section className="task-list" aria-label={listName + " tasks"}>
      {!items.length && (tasksLoaded ? <p className="empty-state">{emptyMessage}</p> : <LoadingRows/>)}
      {items.map(task => <TaskRow key={task.id} task={editLock?.id === task.id ? tasks.find(live => live.id === task.id) ?? task : task} labels={labels} listName={listName} hideDate={hideDate} isOnline={isOnline} expanded={expanded === task.id} isNew={newTaskId === task.id} isCompleting={completingIds.has(task.id)} isSettling={settleIndexById.has(task.id)} settleIndex={settleIndexById.get(task.id) ?? 0} onToggleExpand={onToggleTaskExpand} onComplete={onRowComplete} onUpdate={onRowUpdate} onRemove={onRowRemove}/>)}
    </section>
  }

  function renderWeekAgenda(source: Task[], omitThrough?: Date) {
    const days = Array.from({ length: 7 }, (_, index) => addLocalDays(weekStart, index))
    const exactGroups = days.map(day => ({
      day,
      tasks: source.filter(task => task.due_at && !task.due_is_approx && isSameLocalDay(new Date(task.due_at), day)),
    })).filter(group => (!omitThrough || group.day > omitThrough) && group.tasks.length > 0)
    const roughTasks = source.filter(task => task.due_at && task.due_is_approx && (!omitThrough || new Date(task.due_at) > omitThrough))
    if (!exactGroups.length && !roughTasks.length) return tasksLoaded ? <p className="empty-state">No more tasks this week.</p> : <div className="week-agenda"><LoadingRows/></div>
    return <div className="week-agenda">
      {exactGroups.map(group => <section className="week-day-group" key={group.day.toISOString()}><h3>{isSameLocalDay(group.day, new Date()) ? 'Today' : group.day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>{renderTaskRows(group.tasks, group.day.toLocaleDateString(undefined, { weekday: 'long' }), undefined, true)}</section>)}
      {roughTasks.length > 0 && <section className="week-day-group"><h3>Sometime this week</h3>{renderTaskRows(roughTasks, 'Sometime this week')}</section>}
    </div>
  }

  const taskCounts = useMemo(() => {
    const counts: Record<View, number> = { Today: 0, Inbox: 0, 'This week': 0, Missed: 0, Done: 0 }
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
        if (isSameLocalDay(due, today)) counts.Today++
        else if (due < today) counts.Missed++
      }
    }
    return { counts, perDay }
  }, [tasks, weekStart, weekEnd])
  const viewCount = (tab: View) => taskCounts.counts[tab]

  const errorBanner = error && <div className="error-banner" role="alert">{error}{(errorRetryable || settings.retryPushSetup !== null) && <button className="text-button" disabled={!isOnline || settings.pushBusy} onClick={() => settings.retryPushSetup === null ? void load() : void settings.setupPush(settings.retryPushSetup)}>Retry</button>}{!errorRetryable && settings.retryPushSetup === null && <button className="text-button" onClick={() => setError('')}>Dismiss</button>}</div>
  const todayLabel = selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const pushConfigured = Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY)
  const { preferences } = settings
  const showNotificationPrompt = Boolean(preferences && tasks.some(task => !task.deleted_at)
    && !preferences.daily_nudge_enabled && preferences.prompt_dismissals < 2
    && pushConfigured
    && (!preferences.prompt_reoffer_at || new Date(preferences.prompt_reoffer_at) <= new Date())
    && 'PushManager' in window
    && (!('Notification' in window) || Notification.permission !== 'denied'))
  // The side pane ranks what is not already on the Today view: other days, and Inbox when nothing else is dated.
  const topTasks = useMemo(() => rankCompanionTasks(placedTasks.filter(task => !task.deleted_at && task.status === 'open' && !missedIds.has(task.id) && !(task.due_at && !task.is_inbox && isSameLocalDay(new Date(task.due_at), selectedDay))), new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 5).map(entry => entry.task), [placedTasks, missedIds, selectedDay])
  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  if (!isSupabaseConfigured) return <main className="setup-wrap"><section className="setup-card"><div className="brand-mark"><Check size={18} /></div><p className="eyebrow">A quiet place for your tasks</p><h1>Taskflow</h1><p>Add your Supabase project URL and public anon key to <code>.env</code>, run the migration, then restart the app.</p><p className="setup-hint">See <code>.env.example</code> and <code>supabase/migrations</code>.</p></section></main>
  if (!sessionReady) return <main className="setup-wrap"><p>Loading…</p></main>
  if (!signedIn || recovering) return <AuthScreen recovering={recovering} onSignedIn={() => { setRecovering(false); setSignedIn(true) }} />

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#" aria-label="Taskflow home"><span className="brand-mark"><Check size={16} /></span><span>Taskflow</span></a><div className="topbar-right">{installPrompt && <button className="text-button install-button" onClick={() => void installApp()}><Download size={15}/>Install app</button>}<span className="sync-state">{isOnline && syncStatus === 'Synced' && <span className="online-dot" />}{isOnline ? syncStatus : 'Offline'}</span><button className={`icon-button settings-button ${settingsOpen ? 'active' : ''}`} aria-label="Settings" aria-pressed={settingsOpen} title="Settings" onClick={() => settingsOpen ? setSettingsOpen(false) : openSettings()}><SettingsIcon size={19}/></button></div></header>
    {!isOnline && <div className="offline-banner" role="status">Offline · showing your last saved tasks. Reconnect to make changes.</div>}
    <div className="workspace">
      <aside className="sidebar"><p className="nav-label">Your lists</p><nav aria-label="Task views">{tabs.map(tab => <button key={tab} className={`nav-item ${view === tab ? 'selected' : ''}`} aria-current={view === tab ? 'page' : undefined} onClick={() => chooseView(tab)}>{TAB_ICONS[tab]} {tab}<span className="nav-count">{viewCount(tab)}</span></button>)}</nav></aside>
      <main className="main-content">
        <div className={`content-inner ${view === 'Today' ? 'today-content' : ''}`}>
          {settingsOpen ? <>{errorBanner}<SettingsPage settings={settings} isOnline={isOnline} pushConfigured={pushConfigured} email={userEmail} motionPref={motionPref} onMotionPref={pref => { setMotionPref(pref); setMotionPrefState(pref) }} onExport={() => void exportData()} onRestore={file => void restoreData(file)} onSignOut={everywhere => void supabase?.auth.signOut({ scope: everywhere ? 'global' : 'local' })} onClose={() => setSettingsOpen(false)}/></> : <>
          {showNotificationPrompt && <aside className="nudge-offer" aria-label="Daily nudge setup"><span>Want a daily nudge so nothing slips?</span><div><button className="primary-button" disabled={!isOnline || settings.pushBusy} onClick={() => void settings.enableNotifications()}>{settings.pushBusy ? 'Setting up…' : 'Yes'}</button><button className="text-button" disabled={!isOnline} onClick={() => void settings.deferNotificationPrompt()}>Not now</button></div></aside>}
          {view === 'Today' ? <h1 className="sr-only">{todayLabel}</h1> : <div className="page-heading"><h1>{view}</h1>{view === 'This week' && <span className="list-caption">{weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {addLocalDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}</div>}
          <button type="button" className="add-fab" aria-label="Add a task" onClick={openComposer}><Plus size={18}/>Add task</button>
          {composerOpen && <button type="button" className="composer-scrim" aria-label="Close add task" tabIndex={-1} onClick={() => setComposerOpen(false)}/>}
          <Composer ref={composerRef} open={composerOpen} labels={labels} isOnline={isOnline} busy={busy} onSubmit={async (title, draft) => { const saved = await addTask(title, draft); if (saved) setComposerOpen(false); return saved }} onCreateLabel={createLabel} onRenameLabel={renameLabel} onDeleteLabel={deleteLabel}/>
          {errorBanner}
          <div key={view} className="view-enter">
          {view === 'Today' && <section className="day-strip" aria-label="Choose a day">{todayDays.map(day => {
            const count = taskCounts.perDay.get(localDayKey(day)) ?? 0
            return <button type="button" key={day.toISOString()} className={`day-strip-item ${isSameLocalDay(day, selectedDay) ? 'selected' : ''}`} aria-pressed={isSameLocalDay(day, selectedDay)} onClick={() => selectDay(day)}><span>{isSameLocalDay(day, new Date()) ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{day.getDate()}</strong><span className="day-strip-count">{count || ' '}</span></button>
          })}</section>}
          {view === 'Today' && showMissedReminder && <aside className="missed-reminder" aria-label="Missed tasks"><CalendarX size={15} aria-hidden="true"/><span>{missedTasks.length} missed {missedTasks.length === 1 ? 'task' : 'tasks'}</span><button className="text-button" onClick={() => chooseView('Missed')}>Review</button><button className="icon-button" aria-label="Dismiss for today" onClick={dismissMissedReminder}><X size={15}/></button></aside>}
          {view === 'Today' && <div className="today-split">
            {basicTasks.length > 0 && <aside className="quick-details-prompt"><span>{basicTasks.length} {basicTasks.length === 1 ? 'Inbox task could' : 'Inbox tasks could'} use more details.</span><button className="secondary-button" onClick={() => openTaskDetailsInInbox(basicTasks[0].id)}>Open Inbox</button></aside>}
            {selectedQuickTask && <QuickDetailsCard key={selectedQuickTask.id} task={selectedQuickTask} labels={labels} isOnline={isOnline} onUpdate={onRowUpdate} onFinish={skip => void finishQuickDetails(skip)}/>}
            <section className="day-pane">
              {timedTodayTasks.length > 0 && <section className="schedule">
                <h3 className="lane-heading">Schedule</h3>
                <DayGrid timed={timedTodayTasks} now={viewingToday ? now : null} nextTaskId={nextTask?.id}
                  completingIds={completingIds} settleIndexById={settleIndexById} isOnline={isOnline}
                  onComplete={onRowComplete} onOpen={openFromSchedule}/>
              </section>}
              {(anytimeTasks.length > 0 || timedTodayTasks.length === 0) && <section className="anytime">
                {timedTodayTasks.length > 0 && <h3 className="lane-heading">Anytime</h3>}
                {allClear ? <div className="all-clear" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M20 6 9 17l-5-5"/></svg><p>All clear for today.</p></div>
                  : renderTaskRows(anytimeTasks, `Anytime on ${todayLabel}`, timedTodayTasks.length ? 'No other tasks for this day.' : 'Nothing is planned for this day.', true)}
              </section>}
            </section>
            <aside className="week-pane"><div className="pane-heading"><div><p className="eyebrow">Up next</p><h2>Top 5</h2></div><button className="text-button pane-link" onClick={() => chooseView('This week')}>Open week</button></div>{renderTaskRows(topTasks, 'Top 5', 'Nothing else coming up.')}</aside>
          </div>}
          {view === 'Missed' && <section className="missed-view">{missedTasks.length > 1 && <div className="missed-actions"><span>Oldest first</span><button className="secondary-button" disabled={!isOnline} onClick={() => void moveAllToToday(missedTasks)}><CalendarCheck size={15}/>Move all to today</button></div>}{renderTaskRows(missedTasks, 'Missed', 'Nothing missed. You are all caught up.')}</section>}
          {view === 'This week' && <section className="week-view">{renderWeekAgenda(visibleTasks)}{afterWeekTasks.length > 0 && <section className="week-day-group after-week"><h3>Later</h3>{renderTaskRows(afterWeekTasks, 'Later')}</section>}</section>}
          {view === 'Inbox' && basicTasks.length > 0 && <aside className="quick-details-prompt details-inbox-prompt"><span>{basicTasks.length} {basicTasks.length === 1 ? 'task could' : 'tasks could'} use more details.</span><button className="secondary-button" onClick={() => openTaskDetailsInInbox(basicTasks[0].id)}>Add details</button></aside>}
          {view === 'Inbox' && pinnedTask && !visibleTasks.some(task => task.id === pinnedTask.id) && <section className="pinned-edit" aria-label="Task from your schedule"><div className="pinned-edit-head"><h3>From your schedule</h3><button className="text-button" onClick={() => chooseView('Today')}>Back to Today</button></div>{renderTaskRows([pinnedTask], 'From your schedule')}</section>}
          {(view === 'Inbox' || view === 'Done') && renderTaskRows(visibleTasks, view)}
          {view === 'Done' && <RemovedSection tasks={deletedTasks} loaded={tasksLoaded} isOnline={isOnline} clearing={clearDeletedBusy} onRestore={task => void restoreTask(task)} onPurge={task => void purgeTask(task)} onClearAll={() => void clearDeletedTasks()}/>}
          </div>
          </>}
        </div>
      </main>
    </div>
    {toast && <div className={`toast ${toast.compact ? 'toast-compact' : ''} ${toastClosing ? 'toast-closing' : ''}`} role="status"><span>{toast.text}</span>{toast.action && <button onClick={() => { toast.action?.run(); setToast(null) }}>{toast.action.label}</button>}{toast.undo && <button disabled={!isOnline} onClick={() => { void toast.undo?.(); setToast(null) }}>Undo</button>}</div>}
    <nav className="mobile-tabs" aria-label="Task views">{tabs.map(tab => <button key={tab} className={view === tab ? 'active' : ''} aria-current={view === tab ? 'page' : undefined} onClick={() => chooseView(tab)}>{TAB_ICONS[tab]} {tab}</button>)}</nav>
  </div>
}

export default App
