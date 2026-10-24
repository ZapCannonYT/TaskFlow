import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, CalendarDays, Check, ChevronDown, ChevronUp, Circle, Clock3, Download, Plus, RotateCcw, Star, Trash2, X, Mic, MicOff } from 'lucide-react'
import { isSupabaseConfigured, Label, PushSubscriptionRow, supabase, Task, UserPreferences } from './lib/supabase'
import { addLocalDays, classifyView, dateForChoice, getSevenDays, isDueOnDay, isMissed, isSameLocalDay, rankOneThing, startOfLocalDay, startOfLocalWeek, WhenChoice } from './lib/dates'
import { needsDetailsPrompt } from './lib/quickDetails'
import { VOICE_SEGMENT_SECONDS } from './features/voice/audio'

type View = 'Today' | 'Inbox' | 'Later' | 'This week' | 'Done'
type DraftDetails = { due_at: string | null; due_is_approx: boolean; size: Task['size']; is_important: boolean; label_id: string | null }
const blankDetails = (): DraftDetails => ({ due_at: null, due_is_approx: false, size: null, is_important: false, label_id: null })
const tabs: View[] = ['Today', 'Inbox', 'Later', 'This week', 'Done']

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }

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
  const [sessionReady, setSessionReady] = useState(!isSupabaseConfigured)
  const [signedIn, setSignedIn] = useState(false)
  const [view, setViewState] = useState<View>('Today')
  const [selectedDay, setSelectedDay] = useState(() => startOfLocalDay(new Date()))
  const [tasks, setTasks] = useState<Task[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState<DraftDetails>(blankDetails)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void>; edit?: () => void } | null>(null)
  const [toastClosing, setToastClosing] = useState(false)
  const [newTaskId, setNewTaskId] = useState<string | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncStatus, setSyncStatus] = useState(navigator.onLine ? 'Connecting' : 'Offline')
  const [labelEditor, setLabelEditor] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRow[]>([])
  const [currentPushEndpoint, setCurrentPushEndpoint] = useState<string | null>(null)
  const [devicePushStateChecked, setDevicePushStateChecked] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState({ daily_nudge_time: '18:30', quiet_hours_start: '22:30', quiet_hours_end: '08:00', weekly_summary_enabled: true })
  const [pushBusy, setPushBusy] = useState(false)
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'transcribing' | 'ready'>('idle')
  const [voiceModelState, setVoiceModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [voiceMessage, setVoiceMessage] = useState('')
  const [voiceLevel, setVoiceLevel] = useState(0)
  const voiceHasTranscriptRef = useRef(false)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const [quickDetailsTaskId, setQuickDetailsTaskId] = useState<string | null>(null)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [retryPushSetup, setRetryPushSetup] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const voiceSegmentSamplesRef = useRef<Float32Array[]>([])
  const voiceSegmentLengthRef = useRef(0)
  const voiceSegmentHasSpeechRef = useRef(false)
  const pendingVoiceSegmentsRef = useRef<Float32Array[]>([])
  const voiceWorkerBusyRef = useRef(false)
  const voiceCaptureEndedRef = useRef(false)
  const voiceStartedRef = useRef(0)
  const lastVoiceRef = useRef(0)
  const voiceSampleRateRef = useRef(16000)
  const audioFrameRef = useRef<number | null>(null)

  const preloadVoiceWorker = useCallback(() => {
    try {
      const worker = new Worker(new URL('./features/voice/whisper.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      setVoiceModelState('loading')
      worker.onmessage = event => {
        if (event.data.state === 'preloaded') { setVoiceModelState('ready'); return }
        if (event.data.state === 'preload-error') { setVoiceModelState('error'); return }
      }
      worker.onerror = () => setVoiceModelState('error')
      worker.postMessage({ type: 'preload' })
    } catch {
      setVoiceModelState('error')
    }
  }, [])

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
    supabase.auth.getSession().then(({ data }) => { setSignedIn(Boolean(data.session)); setSessionReady(true) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)))
    return () => listener.subscription.unsubscribe()
  }, [])

  const load = useCallback(async () => {
    if (!supabase || !navigator.onLine) return
    const [taskResult, labelResult] = await Promise.all([
      supabase.from('tasks').select('*, labels(name)').order('created_at', { ascending: false }),
      supabase.from('labels').select('*').order('name'),
    ])
    let loadError = ''
    if (taskResult.error) loadError = taskResult.error.message
    else setTasks((taskResult.data ?? []) as Task[])
    if (labelResult.error) loadError ||= labelResult.error.message
    else {
      const loaded = (labelResult.data ?? []) as Label[]
      setLabels(loaded)
      if (!loaded.length) {
        const { data: userData } = await supabase.auth.getUser()
        if (userData.user) {
          const inserted = await supabase.from('labels').insert(['Study', 'Work', 'Personal'].map(name => ({ user_id: userData.user!.id, name }))).select('*')
          if (!inserted.error) setLabels(inserted.data as Label[])
        }
      }
    }
    setError(loadError)
  }, [])

  useEffect(() => {
    if (!signedIn || !supabase) return
    const client = supabase
    void load()
    const channel = client.channel('phase1-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'labels' }, () => { void load() })
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
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); void client.removeChannel(channel) }
  }, [signedIn, load])

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

  useEffect(() => () => {
    workerRef.current?.terminate()
    micStreamRef.current?.getTracks().forEach(track => track.stop())
    if (audioFrameRef.current !== null) cancelAnimationFrame(audioFrameRef.current)
    void audioContextRef.current?.close()
  }, [])

  useEffect(() => {
    if (!sessionReady || !signedIn || workerRef.current) return
    preloadVoiceWorker()
    const worker = workerRef.current as Worker | null
    return () => {
      worker?.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [sessionReady, signedIn, preloadVoiceWorker])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(null); return }
      if (!(event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'c') || event.ctrlKey || event.metaKey || event.altKey) return
      const active = document.activeElement
      if (active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return
      event.preventDefault(); inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visibleTasks = useMemo(() => {
    const active = tasks.filter(task => !task.deleted_at)
    if (view === 'Done') return active.filter(task => task.status === 'completed')
    if (view === 'Today') return active.filter(task => task.status === 'open' && isDueOnDay(task, selectedDay))
    if (view === 'Inbox' || view === 'Later') return active.filter(task => task.status === 'open' && classifyView(task) === view)
    const weekStart = startOfLocalWeek(new Date())
    const weekEnd = addLocalDays(weekStart, 7)
    return active.filter(task => task.status === 'open' && task.due_at && new Date(task.due_at) >= weekStart && new Date(task.due_at) < weekEnd)
  }, [tasks, view, selectedDay])
  const deletedTasks = useMemo(() => tasks.filter(task => task.deleted_at), [tasks])
  const todayDays = useMemo(() => getSevenDays(), [])
  const weekStart = useMemo(() => startOfLocalWeek(new Date()), [])
  const weekEnd = useMemo(() => addLocalDays(weekStart, 7), [weekStart])
  const weekTasks = useMemo(() => tasks.filter(task => !task.deleted_at && task.status === 'open' && task.due_at && new Date(task.due_at) >= weekStart && new Date(task.due_at) < weekEnd), [tasks, weekStart, weekEnd])
  const selectedDayTasks = view === 'Today' ? visibleTasks : []
  const oneThing = view === 'Today' ? rankOneThing(selectedDayTasks)[0] : undefined
  const remainingTodayTasks = oneThing ? selectedDayTasks.filter(task => task.id !== oneThing.id) : selectedDayTasks
  const missedTasks = view === 'Today' && isSameLocalDay(selectedDay, new Date())
    ? tasks.filter(task => !task.deleted_at && task.status === 'open' && isMissed(task))
    : []
  const basicTasks = useMemo(() => tasks.filter(needsDetailsPrompt), [tasks])
  const selectedQuickTask = quickDetailsTaskId ? tasks.find(task => task.id === quickDetailsTaskId && needsDetailsPrompt(task)) : undefined

  function chooseView(nextView: View) {
    if (nextView === 'Today') setSelectedDay(startOfLocalDay(new Date()))
    setViewState(nextView)
    setError('')
  }

  function setWhen(choice: WhenChoice) {
    if (draft.due_at && choice === 'today' && localDateInput(draft.due_at) === localDateInput(dateForChoice('today').due_at) && !draft.due_is_approx) {
      setDraft(d => ({ ...d, due_at: null, due_is_approx: false })); return
    }
    const date = dateForChoice(choice)
    setDraft(d => ({ ...d, ...date }))
  }

  async function addTask(event: FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!supabase || !cleanTitle || busy || !isOnline) return
    const client = supabase
    setBusy(true); setError('')
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setBusy(false); setError('Sign in again to save this task.'); return }
    const result = await client.from('tasks').insert({ user_id: auth.user.id, title: cleanTitle, ...draft, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' }).select('*, labels(name)').single()
    setBusy(false)
    if (result.error) { setError(`Not saved · ${result.error.message}`); return }
    setTasks(current => [result.data as Task, ...current]); setTitle(''); setDraft(blankDetails()); setError(''); setVoiceMessage(''); setVoiceState('idle'); voiceHasTranscriptRef.current = false
    setNewTaskId(result.data.id)
    window.setTimeout(() => setNewTaskId(current => current === result.data.id ? null : current), 160)
    setToast({ text: 'Task added', undo: async () => { const undone = await client.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', result.data.id); if (!undone.error) setTasks(current => current.filter(t => t.id !== result.data.id)); else setError(`Not saved · ${undone.error.message}`) } })
    inputRef.current?.focus()
  }

  function stopVoiceCapture() {
    if (audioFrameRef.current !== null) cancelAnimationFrame(audioFrameRef.current)
    audioFrameRef.current = null
    setVoiceLevel(0)
    micStreamRef.current?.getTracks().forEach(track => track.stop()); micStreamRef.current = null
    void audioContextRef.current?.close(); audioContextRef.current = null
    flushVoiceSegment()
    voiceCaptureEndedRef.current = true
    setVoiceState('transcribing')
    setVoiceMessage('Finishing the transcript…')
    postNextVoiceSegment()
  }

  function postNextVoiceSegment() {
    if (voiceWorkerBusyRef.current) return
    const audio = pendingVoiceSegmentsRef.current.shift()
    if (!audio) {
      setVoiceProcessing(false)
      if (voiceCaptureEndedRef.current) {
        setVoiceState('ready')
        setVoiceMessage(voiceHasTranscriptRef.current ? 'Transcript ready. Edit the title, then press Add.' : 'No speech was heard. Try again.')
      } else setVoiceMessage('Listening… transcript updates as speech is processed.')
      return
    }
    if (!workerRef.current) workerRef.current = new Worker(new URL('./features/voice/whisper.worker.ts', import.meta.url), { type: 'module' })
    const worker = workerRef.current
    voiceWorkerBusyRef.current = true; setVoiceProcessing(true)
    worker.onmessage = event => {
      if (event.data.state === 'loading') { setVoiceModelState('loading'); setVoiceMessage('Getting voice ready…'); return }
      if (event.data.state === 'fallback') { setVoiceMessage('Switching to the compatible on-device model…'); return }
      if (event.data.state === 'transcribing') { setVoiceMessage('Transcribing on this device…'); return }
      if (event.data.state === 'preloaded') { setVoiceModelState('ready'); return }
      if (event.data.state === 'preload-error') { setVoiceModelState('error'); return }
      voiceWorkerBusyRef.current = false
      if (event.data.error) {
        setVoiceModelState('error')
        micStreamRef.current?.getTracks().forEach(track => track.stop()); micStreamRef.current = null
        void audioContextRef.current?.close(); audioContextRef.current = null
        voiceCaptureEndedRef.current = true
        setVoiceProcessing(false); setVoiceState(voiceHasTranscriptRef.current ? 'ready' : 'idle')
        setVoiceMessage(`Transcription failed · ${String(event.data.error).slice(0, 180)}. No task was added.`)
        return
      }
      const partial = String(event.data.text ?? '').trim()
      setVoiceModelState('ready')
      if (partial) {
        voiceHasTranscriptRef.current = true
        setTitle(current => (current.trim() ? `${current.trim()} ${partial}` : partial).slice(0, 500))
      }
      postNextVoiceSegment()
    }
    worker.onerror = event => {
      micStreamRef.current?.getTracks().forEach(track => track.stop()); micStreamRef.current = null
      void audioContextRef.current?.close(); audioContextRef.current = null
      voiceWorkerBusyRef.current = false; voiceCaptureEndedRef.current = true; pendingVoiceSegmentsRef.current = []
      setVoiceProcessing(false); setVoiceState(voiceHasTranscriptRef.current ? 'ready' : 'idle')
      setVoiceMessage(`Voice worker failed · ${event.message || 'Check that the app loaded fully.'}. No task was added.`)
    }
    worker.postMessage({ audio, sampleRate: voiceSampleRateRef.current }, [audio.buffer])
  }

  function flushVoiceSegment() {
    if (!voiceSegmentSamplesRef.current.length) return
    if (voiceSegmentHasSpeechRef.current) {
      const length = voiceSegmentSamplesRef.current.reduce((total, sample) => total + sample.length, 0)
      const merged = new Float32Array(length)
      let offset = 0
      for (const sample of voiceSegmentSamplesRef.current) { merged.set(sample, offset); offset += sample.length }
      pendingVoiceSegmentsRef.current.push(merged)
    }
    voiceSegmentSamplesRef.current = []; voiceSegmentLengthRef.current = 0; voiceSegmentHasSpeechRef.current = false
    postNextVoiceSegment()
  }

  function cancelVoiceTranscription() {
    micStreamRef.current?.getTracks().forEach(track => track.stop()); micStreamRef.current = null
    void audioContextRef.current?.close(); audioContextRef.current = null
    workerRef.current?.terminate(); workerRef.current = null
    pendingVoiceSegmentsRef.current = []; voiceWorkerBusyRef.current = false; voiceCaptureEndedRef.current = true
    setVoiceLevel(0)
    preloadVoiceWorker()
    setVoiceProcessing(false); setVoiceState(voiceHasTranscriptRef.current ? 'ready' : 'idle')
    setVoiceMessage('Transcription stopped. No task was added.')
  }

  async function startVoiceCapture() {
    if (!['idle', 'ready'].includes(voiceState) || !isOnline) return
    voiceHasTranscriptRef.current = false; pendingVoiceSegmentsRef.current = []; voiceWorkerBusyRef.current = false; voiceCaptureEndedRef.current = false
    setVoiceLevel(0)
    setVoiceMessage('Microphone access lets Taski turn speech into a task on this device.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      micStreamRef.current = stream
      const context = new AudioContext()
      audioContextRef.current = context
      voiceSampleRateRef.current = context.sampleRate
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      voiceSegmentSamplesRef.current = []; voiceSegmentLengthRef.current = 0; voiceSegmentHasSpeechRef.current = false
      voiceStartedRef.current = Date.now(); lastVoiceRef.current = 0
      processor.onaudioprocess = event => {
        const input = event.inputBuffer.getChannelData(0)
        let rms = 0
        for (let i = 0; i < input.length; i++) rms += input[i] * input[i]
        rms = Math.sqrt(rms / input.length)
        setVoiceLevel(Math.min(1, rms * 10))
        if (rms > 0.012) { lastVoiceRef.current = Date.now(); voiceSegmentHasSpeechRef.current = true }
        if (lastVoiceRef.current && Date.now() - lastVoiceRef.current > 1300) { stopVoiceCapture(); return }
        if (!lastVoiceRef.current && Date.now() - voiceStartedRef.current > 8000) { stopVoiceCapture(); return }
        if (Date.now() - voiceStartedRef.current > 45000) { stopVoiceCapture(); return }
        const copy = new Float32Array(input)
        voiceSegmentSamplesRef.current.push(copy)
        voiceSegmentLengthRef.current += copy.length
        if (voiceSegmentLengthRef.current >= context.sampleRate * VOICE_SEGMENT_SECONDS) flushVoiceSegment()
      }
      source.connect(processor); processor.connect(context.destination)
      setVoiceState('listening'); setVoiceMessage('Listening… Speak now. Text appears as speech is processed.')
    } catch (cause) {
      micStreamRef.current?.getTracks().forEach(track => track.stop()); micStreamRef.current = null
      void audioContextRef.current?.close(); audioContextRef.current = null
      setVoiceLevel(0)
      setVoiceState('idle')
      const detail = cause instanceof Error ? cause.message : String(cause)
      setVoiceMessage(`Microphone could not start · ${detail.slice(0, 180)}. You can type your task instead.`)
    }
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
    const result = await supabase?.from('tasks').update({ details_prompted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', task.id).select('*, labels(name)').single()
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
    if (!action || !reminderId || !['open', 'done', 'later', 'skip'].includes(action)) return
    handledNotificationAction.current = true
    void (async () => {
      if (action === 'done' && taskId) {
        const completedAt = new Date().toISOString()
        const result = await supabase!.from('tasks').update({ status: 'completed', completed_at: completedAt, updated_at: completedAt }).eq('id', taskId).eq('status', 'open')
        if (result.error) setError(`Task could not be completed · ${result.error.message}`)
        else {
          setTasks(current => current.map(task => task.id === taskId ? { ...task, status: 'completed', completed_at: completedAt } : task))
          const client = supabase!
          setToast({ text: `Done “${taskId ? tasks.find(task => task.id === taskId)?.title ?? 'task' : 'task'}”`, undo: async () => {
            const restoredAt = new Date().toISOString()
            const undone = await client.from('tasks').update({ status: 'open', completed_at: null, updated_at: restoredAt }).eq('id', taskId)
            if (!undone.error) setTasks(current => current.map(task => task.id === taskId ? { ...task, status: 'open', completed_at: null } : task))
            else setError(`Not saved · ${undone.error.message}`)
          } })
        }
      } else if (action === 'later' && taskId) {
        const due = dateForChoice('tomorrow')
        const result = await supabase!.from('tasks').update({ ...due, updated_at: new Date().toISOString() }).eq('id', taskId).eq('status', 'open')
        if (result.error) setError(`Task could not be moved · ${result.error.message}`)
        else setTasks(current => current.map(task => task.id === taskId ? { ...task, ...due } : task))
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
    const quickDetailsId = params.get('quick_details')
    if (quickDetailsId) { setQuickDetailsTaskId(quickDetailsId); setViewState('Today'); params.delete('quick_details'); window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`) }
    if (params.get('capture') === 'voice') { params.delete('capture'); window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`); window.setTimeout(() => void startVoiceCapture(), 300) }
  }, [signedIn])

  async function updateTask(task: Task, values: Partial<Task>) {
    if (!supabase || !isOnline) return
    const updatedAt = new Date().toISOString()
    const { data, error: updateError } = await supabase.from('tasks').update({ ...values, updated_at: updatedAt }).eq('id', task.id).select('*, labels(name)').single()
    if (updateError) { setError(`Not saved · ${updateError.message}`); return }
    setTasks(current => current.map(item => item.id === task.id ? data as Task : item))
    if (values.reminder_offset && values.reminder_offset !== 'none' && !currentPushEndpoint) void setupPush(false)
  }

  async function completeTask(task: Task) {
    if (!supabase || !isOnline || completingTaskId) return
    const client = supabase
    const completedAt = new Date().toISOString()
    setCompletingTaskId(task.id)
    const { error: updateError } = await client.from('tasks').update({ status: 'completed', completed_at: completedAt, updated_at: completedAt }).eq('id', task.id)
    if (updateError) { setCompletingTaskId(null); setError(`Not saved · ${updateError.message}`); return }
    window.setTimeout(() => {
      setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'completed', completed_at: completedAt } : item))
      setCompletingTaskId(null)
      setToast({ text: `Done “${task.title}”`, undo: async () => {
        const restoredAt = new Date().toISOString()
        const undone = await client.from('tasks').update({ status: 'open', completed_at: null, updated_at: restoredAt }).eq('id', task.id)
        if (!undone.error) setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'open', completed_at: null } : item))
        else setError(`Not saved · ${undone.error.message}`)
      } })
    }, 180)
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

  async function createLabel() {
    const name = newLabel.trim()
    if (!supabase || !name || !isOnline) return
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return
    const { data, error: labelError } = await supabase.from('labels').insert({ user_id: userData.user.id, name }).select('*').single()
    if (labelError) setError(labelError.message)
    else { setLabels(current => [...current, data as Label]); setNewLabel('') }
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
      setDraft(current => current.label_id === label.id ? { ...current, label_id: null } : current)
    }
  }

  function renderTaskRows(items: Task[], listName: string, emptyMessage = 'Nothing here yet.') {
    return <section className="task-list" aria-label={`${listName} tasks`}>
      {!items.length && <p className="empty-state">{emptyMessage}</p>}
      {items.map(task => <article key={task.id} className={`task-card ${task.status === 'completed' ? 'is-complete' : ''} ${newTaskId === task.id ? 'task-entering' : ''} ${completingTaskId === task.id ? 'task-completing' : ''}`}>
        <div className="task-main"><button className={`complete-button ${task.status === 'completed' ? 'checked' : ''} ${listName === 'Done' && task.status === 'completed' ? 'done-undo-button' : ''}`} aria-label={task.status === 'completed' ? `Undo completion of ${task.title}` : `Complete ${task.title}`} disabled={!isOnline} onClick={() => task.status === 'open' ? void completeTask(task) : void updateTask(task, { status: 'open', completed_at: null })}>{task.status === 'completed' ? <>{listName === 'Done' && <span>Undo</span>}<Check size={17}/></> : <Circle size={21}/>}</button>
          <button className="task-title-button" onClick={() => { setExpanded(expanded === task.id ? null : task.id); setEditingTitle(task.title) }} aria-expanded={expanded === task.id}><span className="task-title">{task.title}</span><span className="task-meta">{task.due_at && <span className={`row-tag ${task.due_is_approx ? 'rough-tag' : ''}`}><CalendarDays size={12}/>{task.due_is_approx ? 'Around ' : ''}{new Date(task.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}{task.size && <span className="row-tag">{task.size === 'quick' ? 'Quick' : task.size === 'hour' ? 'An hour' : 'Big'}</span>}{task.reminder_offset !== 'none' && <span className="row-tag"><Clock3 size={12}/>{task.reminder_offset === 'at_time' ? 'Reminder' : task.reminder_offset === '1_day_before' ? '1 day before' : '2 days before'}</span>}{task.is_important && <span className="important-tag"><Star size={12}/>Important</span>}{task.labels?.name && <span className="label-tag">{task.labels.name}</span>}</span></button>
          <button className="icon-button expand-button" aria-label={expanded === task.id ? 'Close task details' : 'Edit task details'} onClick={() => { setExpanded(expanded === task.id ? null : task.id); setEditingTitle(task.title) }}>{expanded === task.id ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}</button><button className="icon-button remove-button" aria-label={`Remove ${task.title}`} disabled={!isOnline} onClick={() => void removeTask(task)}><Trash2 size={16}/></button>
        </div>
        {expanded === task.id && <div className="task-editor"><label className="edit-title-label">Title<input disabled={!isOnline} value={editingTitle} maxLength={500} onChange={e => setEditingTitle(e.target.value)} onBlur={() => { const next = editingTitle.trim(); if (next && next !== task.title) void updateTask(task, { title: next }) }} onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() }; if (e.key === 'Escape') { setEditingTitle(task.title); setExpanded(null) } }}/></label><label className="edit-select">When<input disabled={!isOnline} type="date" value={localDateInput(task.due_at)} onChange={e => void updateTask(task, { due_at: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null, due_is_approx: false })}/></label><label className="edit-select">Size<select disabled={!isOnline} value={task.size ?? ''} onChange={e => void updateTask(task, { size: (e.target.value || null) as Task['size'] })}><option value="">Not set</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label><label className="edit-select">Label<select disabled={!isOnline} value={task.label_id ?? ''} onChange={e => void updateTask(task, { label_id: e.target.value || null })}><option value="">No label</option>{labels.map(label => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label><label className="edit-select">Remind me<select disabled={!isOnline || !task.due_at || task.due_is_approx} value={task.reminder_offset} onChange={e => void updateTask(task, { reminder_offset: e.target.value as Task['reminder_offset'] })}><option value="none">No reminder</option><option value="at_time">At my reminder time</option><option value="1_day_before">A day before</option><option value="2_days_before">Two days before</option></select></label><button disabled={!isOnline} className={`choice-chip icon-chip ${task.is_important ? 'starred' : ''}`} aria-pressed={task.is_important} onClick={() => void updateTask(task, { is_important: !task.is_important })}><Star size={15}/>Important</button></div>}
      </article>)}
    </section>
  }

  function renderWeekAgenda(source: Task[], omitThrough?: Date) {
    const days = Array.from({ length: 7 }, (_, index) => addLocalDays(weekStart, index))
    const exactGroups = days.map(day => ({
      day,
      tasks: source.filter(task => task.due_at && !task.due_is_approx && isSameLocalDay(new Date(task.due_at), day)),
    })).filter(group => (!omitThrough || group.day > omitThrough) && group.tasks.length > 0)
    const roughTasks = source.filter(task => task.due_at && task.due_is_approx && (!omitThrough || new Date(task.due_at) > omitThrough))
    if (!exactGroups.length && !roughTasks.length) return <p className="empty-state">No more tasks this week.</p>
    return <div className="week-agenda">
      {exactGroups.map(group => <section className="week-day-group" key={group.day.toISOString()}><h3>{isSameLocalDay(group.day, new Date()) ? 'Today' : group.day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>{renderTaskRows(group.tasks, group.day.toLocaleDateString(undefined, { weekday: 'long' }))}</section>)}
      {roughTasks.length > 0 && <section className="week-day-group"><h3>Sometime this week</h3>{renderTaskRows(roughTasks, 'Sometime this week')}</section>}
    </div>
  }

  const viewCount = (tab: View) => tab === 'This week'
    ? weekTasks.length
    : tab === 'Done'
      ? tasks.filter(task => task.status === 'completed' && !task.deleted_at).length
      : tasks.filter(task => !task.deleted_at && task.status === 'open' && (tab === 'Today' ? isDueOnDay(task, new Date()) || isMissed(task) : classifyView(task) === tab)).length

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
    {!isOnline && <div className="offline-banner" role="status">Offline · read-only. Reconnect to load or save changes.</div>}
    <div className="workspace">
      <aside className="sidebar"><p className="nav-label">Your lists</p><nav aria-label="Task views">{tabs.map(tab => <button key={tab} className={`nav-item ${view === tab ? 'selected' : ''}`} onClick={() => chooseView(tab)}><span className={`nav-symbol ${tab.toLowerCase().replace(' ', '-')}`} />{tab}<span className="nav-count">{viewCount(tab)}</span></button>)}</nav></aside>
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
          {view !== 'Done' && <form className="composer" onSubmit={addTask}>
            <div className="composer-field"><Plus className="composer-plus" size={19} aria-hidden="true"/><input ref={inputRef} aria-label="Add a task" placeholder="Add a task…" value={title} maxLength={500} onChange={e => setTitle(e.target.value)} disabled={!isOnline} /><button type="button" className={`icon-button voice-button ${voiceState === 'listening' ? 'listening' : ''}`} aria-label={voiceState === 'listening' ? 'Stop listening' : 'Add by voice'} disabled={!isOnline || voiceProcessing && voiceState !== 'listening'} onClick={() => voiceState === 'listening' ? stopVoiceCapture() : void startVoiceCapture()}>{voiceState === 'listening' ? <MicOff size={18}/> : <Mic size={18}/>}</button><button className="primary-button add-button" type="submit" disabled={!title.trim() || busy || !isOnline || voiceState === 'listening' || voiceState === 'transcribing' || voiceProcessing}>{!isOnline ? 'Offline' : busy ? 'Saving…' : voiceState === 'ready' && voiceHasTranscriptRef.current ? 'Add task' : 'Add'}</button></div>
            {(voiceState !== 'idle' || voiceMessage || voiceModelState === 'loading' || voiceModelState === 'error') && <div className="voice-panel"><div className="voice-status-row">{voiceState === 'listening' && <div className="voice-meter" role="img" aria-label="Live microphone level">{[0.55, 0.78, 1, 0.78, 0.55].map((height, index) => <span key={index} style={{ transform: `scaleY(${Math.max(0.12, voiceLevel * height)})` }} />)}</div>}<p className="voice-status" role="status">{voiceMessage || (voiceModelState === 'loading' ? 'Getting voice ready…' : voiceModelState === 'error' && voiceState === 'idle' ? 'Voice could not load. Tap the mic to retry, or type instead.' : '')}</p>{voiceProcessing && <button type="button" className="text-button" onClick={cancelVoiceTranscription}>Stop transcription</button>}</div></div>}
            {title.length > 0 && <div className="composer-options">
              <div className="chip-row" aria-label="When"><span className="chip-group-label">When</span>{([['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['next-week', 'Next week']] as const).map(([key, label]) => <button type="button" disabled={!isOnline} key={key} className={`choice-chip ${draft.due_at && ((key === 'today' && !draft.due_is_approx && localDateInput(draft.due_at) === localDateInput(dateForChoice('today').due_at)) || (key === 'tomorrow' && !draft.due_is_approx && localDateInput(draft.due_at) === localDateInput(dateForChoice('tomorrow').due_at)) || (key === 'weekend' && draft.due_is_approx && localDateInput(draft.due_at) === localDateInput(dateForChoice('weekend').due_at)) || (key === 'next-week' && draft.due_is_approx && localDateInput(draft.due_at) === localDateInput(dateForChoice('next-week').due_at))) ? 'active' : ''}`} onClick={() => setWhen(key)}>{label}</button>)}</div>
              <div className="chip-row detail-row"><label className={`choice-chip date-chip ${draft.due_at && !draft.due_is_approx ? 'active' : ''}`}><CalendarDays size={14} /><span>Pick date</span><input aria-label="Pick date" type="date" disabled={!isOnline} value={localDateInput(draft.due_at)} onChange={e => setDraft(d => ({ ...d, due_at: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null, due_is_approx: false }))} /></label>
                <label className="select-chip"><Clock3 size={14} /><span className="sr-only">Size</span><select aria-label="Size" value={draft.size ?? ''} disabled={!isOnline} onChange={e => setDraft(d => ({ ...d, size: (e.target.value || null) as Task['size'] }))}><option value="">Size</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label>
                <button type="button" disabled={!isOnline} className={`choice-chip icon-chip ${draft.is_important ? 'starred' : ''}`} aria-label={draft.is_important ? 'Remove Important' : 'Mark Important'} aria-pressed={draft.is_important} onClick={() => setDraft(d => ({ ...d, is_important: !d.is_important }))}><Star size={15} />Important</button>
                <label className="select-chip label-select"><span className="sr-only">Label</span><select aria-label="Label" value={draft.label_id ?? ''} disabled={!isOnline} onChange={e => setDraft(d => ({ ...d, label_id: e.target.value || null }))}><option value="">Label</option>{labels.map(label => <option value={label.id} key={label.id}>{label.name}</option>)}</select></label>
                <button type="button" className="text-button manage-labels" disabled={!isOnline} onClick={() => setLabelEditor(v => !v)}>Edit labels</button>
              </div>
              {labelEditor && <div className="label-manager"><div className="label-form"><label htmlFor="new-label">New label</label><input id="new-label" disabled={!isOnline} value={newLabel} maxLength={32} onChange={e => setNewLabel(e.target.value)} placeholder="Label name"/><button type="button" disabled={!isOnline} className="secondary-button" onClick={() => void createLabel()}>Add label</button><button type="button" className="icon-button" aria-label="Close label editor" onClick={() => setLabelEditor(false)}><X size={16}/></button></div><div className="label-list">{labels.map(label => <div className="label-admin-row" key={label.id}><span className="label-tag">{label.name}</span><input aria-label={`Rename ${label.name}`} disabled={!isOnline} defaultValue={label.name} maxLength={32} onBlur={e => void renameLabel(label, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}/><button disabled={!isOnline} className="icon-button" aria-label={`Remove label ${label.name}`} onClick={() => void deleteLabel(label)}><Trash2 size={15}/></button></div>)}</div></div>}
            </div>}
          </form>}
          {error && <div className="error-banner" role="alert">{error}<button className="text-button" disabled={!isOnline || pushBusy} onClick={() => retryPushSetup === null ? void load() : void setupPush(retryPushSetup)}>Retry</button></div>}
          {view === 'Today' && <section className="day-strip" aria-label="Choose a day">{todayDays.map(day => {
            const count = tasks.filter(task => !task.deleted_at && task.status === 'open' && isDueOnDay(task, day)).length
            return <button type="button" key={day.toISOString()} className={`day-strip-item ${isSameLocalDay(day, selectedDay) ? 'selected' : ''}`} aria-pressed={isSameLocalDay(day, selectedDay)} onClick={() => setSelectedDay(day)}><span>{isSameLocalDay(day, new Date()) ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>{day.getDate()}</strong><span className="day-strip-count">{count || ' '}</span></button>
          })}</section>}
          {view === 'Today' && <div className="today-split">
            {basicTasks.length > 0 && <aside className="quick-details-prompt"><span>{basicTasks.length} {basicTasks.length === 1 ? 'task is' : 'tasks are'} just titles. Add details?</span><button className="secondary-button" onClick={() => setQuickDetailsTaskId(basicTasks[0].id)}>Quick details</button></aside>}
            {selectedQuickTask && <section className="quick-details-card" aria-label="Quick details"><p className="eyebrow">Quick details · {basicTasks.findIndex(task => task.id === selectedQuickTask.id) + 1} of {basicTasks.length}</p><h2>{selectedQuickTask.title}</h2>{selectedQuickTask.due_at && selectedQuickTask.due_is_approx && <div className="chip-row"><span className="chip-group-label">Choose a day</span>{Array.from({ length: 7 }, (_, index) => addLocalDays(startOfLocalWeek(new Date(selectedQuickTask.due_at!)), index)).filter(day => day >= startOfLocalDay(new Date())).map(day => <button key={day.toISOString()} className="choice-chip" onClick={() => void updateTask(selectedQuickTask, { due_at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString(), due_is_approx: false })}>{day.toLocaleDateString(undefined, { weekday: 'short' })} {day.getDate()}</button>)}</div>}
              <div className="chip-row"><label className="choice-chip date-chip"><CalendarDays size={14}/><span>When</span><input aria-label="When" type="date" value={localDateInput(selectedQuickTask.due_at)} onChange={e => void updateTask(selectedQuickTask, { due_at: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null, due_is_approx: false })}/></label><label className="select-chip"><span>Size</span><select aria-label="Size" value={selectedQuickTask.size ?? ''} onChange={e => void updateTask(selectedQuickTask, { size: (e.target.value || null) as Task['size'] })}><option value="">Not set</option><option value="quick">Quick</option><option value="hour">An hour</option><option value="big">Big</option></select></label><button className={`choice-chip ${selectedQuickTask.is_important ? 'starred' : ''}`} aria-pressed={selectedQuickTask.is_important} onClick={() => void updateTask(selectedQuickTask, { is_important: !selectedQuickTask.is_important })}><Star size={15}/>Important</button><label className="select-chip"><span>Label</span><select aria-label="Label" value={selectedQuickTask.label_id ?? ''} onChange={e => void updateTask(selectedQuickTask, { label_id: e.target.value || null })}><option value="">None</option>{labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label></div><div className="quick-details-actions"><button className="text-button" onClick={() => void finishQuickDetails(true)}>Skip</button><button className="primary-button" onClick={() => void finishQuickDetails(false)}>Done</button></div></section>}
            <section className="day-pane"><div className="pane-heading"><div><p className="eyebrow">Selected day</p><h2>{isSameLocalDay(selectedDay, new Date()) ? 'Today' : todayLabel}</h2></div></div>
              {oneThing && <article className={`one-thing-card ${completingTaskId === oneThing.id ? 'task-completing' : ''}`}><p className="eyebrow">One thing to start with</p><h3>{oneThing.title}</h3><p className="one-thing-reason">{oneThing.is_important ? 'Important' : oneThing.size ? (oneThing.size === 'quick' ? 'Quick task' : oneThing.size === 'hour' ? 'About an hour' : 'A bigger task') : `Due ${isSameLocalDay(selectedDay, new Date()) ? 'today' : selectedDay.toLocaleDateString(undefined, { weekday: 'long' })}`}</p><div className="one-thing-actions"><button className="secondary-button accent-outline-button" disabled={!isOnline} onClick={() => void completeTask(oneThing)}>Done</button><button className="secondary-button" disabled={!isOnline} onClick={() => void moveOneThingToTomorrow(oneThing)}>Tomorrow</button></div></article>}
              {renderTaskRows(remainingTodayTasks, `Other tasks for ${todayLabel}`, oneThing ? 'No other tasks for this day.' : 'Nothing is planned for this day.')}
              {missedTasks.length > 0 && <section className="missed-list"><h3>Missed</h3>{renderTaskRows(missedTasks, 'Missed tasks')}</section>}
            </section>
            <aside className="week-pane"><div className="pane-heading"><div><p className="eyebrow">Coming up</p><h2>This week</h2></div><button className="text-button pane-link" onClick={() => chooseView('This week')}>Open week</button></div>{renderWeekAgenda(laterThisWeekTasks, selectedDay)}</aside>
          </div>}
          {view === 'This week' && <section className="week-view"><div className="pane-heading"><div><p className="eyebrow">Monday–Sunday</p><h2>This week</h2></div></div>{renderWeekAgenda(visibleTasks)}</section>}
          {(view === 'Inbox' || view === 'Later' || view === 'Done') && renderTaskRows(visibleTasks, view)}
          {view === 'Done' && <section className="removed-section"><h2><ArchiveRestore size={17}/>Recently removed</h2>{deletedTasks.length ? deletedTasks.map(task => <div className="removed-row" key={task.id}><span>{task.title}</span><button className="secondary-button" disabled={!isOnline} onClick={() => void restoreTask(task)}><RotateCcw size={14}/>Restore</button></div>) : <p className="removed-empty">Removed tasks can be restored here.</p>}</section>}
        </div>
      </main>
    </div>
    {toast && <div className={`toast ${toastClosing ? 'toast-closing' : ''}`} role="status"><span>{toast.text}</span>{toast.edit && <button onClick={() => { toast.edit?.(); setToast(null) }}>Edit</button>}<button disabled={!isOnline} onClick={() => { void toast.undo(); setToast(null) }}>Undo</button></div>}
    <nav className="mobile-tabs" aria-label="Task views">{tabs.map(tab => <button key={tab} className={view === tab ? 'active' : ''} onClick={() => chooseView(tab)}><span className={`nav-symbol ${tab.toLowerCase().replace(' ', '-')}`} />{tab}</button>)}</nav>
  </div>
}

export default App
