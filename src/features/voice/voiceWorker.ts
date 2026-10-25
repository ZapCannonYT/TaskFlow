export type VoiceStatus = { state: 'idle' | 'loading' | 'downloading' | 'ready' | 'error'; progress?: number; model?: string; device?: string; dtype?: string; loadMs?: number; warmupMs?: number; fallbacks: number; error?: string }
type Timings = { resampleMs: number; inferMs: number }
type Pending = { resolve: (v: { text: string; timings?: Timings }) => void; reject: (e: Error) => void; audio: Float32Array; sampleRate: number; priority: 'draft' | 'final' }
type VoiceWindow = Window & { __voiceStatus?: () => VoiceStatus }
let worker: Worker | null = null
let status: VoiceStatus = { state: 'idle', fallbacks: 0 }
let nextId = 1
let persisted = false
let inFlight: number | null = null
let queuedDraft: number | null = null
const finals: number[] = []
const pending = new Map<number, Pending>()
const subscribers = new Set<(s: VoiceStatus) => void>()
function publish(next: Partial<VoiceStatus>) {
  status = { ...status, ...next }
  subscribers.forEach(cb => cb(status))
  if (status.state === 'ready' && !persisted) { persisted = true; try { void navigator.storage?.persist?.() } catch { /* optional browser hint */ } }
}
function rejectAll(reason: string) { pending.forEach(item => item.reject(new Error(reason))); pending.clear(); finals.length = 0; queuedDraft = null; inFlight = null }
function route(event: MessageEvent) {
  const data = event.data as Record<string, unknown>
  if (typeof data.requestId === 'number') {
    const id = data.requestId, item = pending.get(id)
    if (!item) return
    pending.delete(id); inFlight = null
    if (data.error) item.reject(new Error(String(data.error)))
    else item.resolve({ text: String(data.text ?? ''), timings: data.timings as Timings | undefined })
    pump(); return
  }
  if (data.state === 'loading') publish({ state: 'loading', error: undefined })
  else if (data.state === 'downloading') publish({ state: 'downloading', progress: typeof data.progress === 'number' ? data.progress : undefined })
  else if (data.state === 'fallback') publish({ fallbacks: status.fallbacks + 1 })
  else if (data.state === 'preloaded') publish({ state: 'ready', model: String(data.model), device: String(data.device), dtype: String(data.dtype), loadMs: Number(data.loadMs), warmupMs: Number(data.warmupMs), progress: undefined, error: undefined })
  else if (data.state === 'preload-error') publish({ state: 'error', error: String(data.error ?? 'Voice model could not load.') })
}
function createWorker() {
  if (worker) return worker
  try {
    const instance = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    worker = instance
    instance.onmessage = route
    instance.onerror = event => { publish({ state: 'error', error: event.message || 'Voice worker failed.' }); rejectAll(event.message || 'Voice worker failed.'); if (worker === instance) worker = null }
    return instance
  } catch (cause) { publish({ state: 'error', error: cause instanceof Error ? cause.message : String(cause) }); return null }
}
function pump() {
  if (inFlight !== null) return
  const id = finals.shift() ?? queuedDraft
  if (id == null) return
  if (queuedDraft === id) queuedDraft = null
  const item = pending.get(id), instance = createWorker()
  if (!item) return pump()
  if (!instance) { pending.delete(id); item.reject(new Error(status.error ?? 'Voice worker could not start.')); return pump() }
  inFlight = id
  instance.postMessage({ audio: item.audio, sampleRate: item.sampleRate, requestId: id, kind: item.priority }, [item.audio.buffer])
}
export function startVoicePreload() {
  if (status.state === 'loading' || status.state === 'downloading' || status.state === 'ready') return
  const instance = createWorker(); if (!instance) return
  publish({ state: 'loading', error: undefined }); instance.postMessage({ type: 'preload' })
}
export function getVoiceStatus() { return status }
export function subscribeVoiceStatus(cb: (s: VoiceStatus) => void) { subscribers.add(cb); return () => { subscribers.delete(cb) } }
export function transcribeSegment(audio: Float32Array, sampleRate: number, priority: 'draft' | 'final' = 'final'): Promise<{ text: string; timings?: Timings }> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const instance = createWorker()
    if (!instance) { reject(new Error(status.error ?? 'Voice worker could not start.')); return }
    pending.set(id, { resolve, reject, audio, sampleRate, priority })
    if (priority === 'draft') {
      if (queuedDraft !== null) { pending.get(queuedDraft)?.reject(new Error('superseded')); pending.delete(queuedDraft) }
      queuedDraft = id
    } else finals.push(id)
    pump()
  })
}
export function cancelAllTranscriptions() {
  rejectAll('cancelled'); worker?.terminate(); worker = null
  publish({ state: 'idle', progress: undefined })
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  // The on-device model is only a fallback now, so reload it lazily on next use instead of eagerly.
  if (document.visibilityState === 'visible' && status.state === 'error') { worker = null; publish({ state: 'idle', error: undefined }) }
})
if (import.meta.env.DEV && typeof window !== 'undefined') (window as VoiceWindow).__voiceStatus = getVoiceStatus
