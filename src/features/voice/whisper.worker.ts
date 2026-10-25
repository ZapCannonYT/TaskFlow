/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers'
import { resampleForWhisper } from './audio'
import { detectDevice, fallbackChain, pickVoiceModel, type VoiceModelConfig } from './models'

const scope = self as DedicatedWorkerGlobalScope
type Transcriber = Awaited<ReturnType<typeof pipeline>>
type ProgressInfo = { status?: string; name?: string; file?: string; progress?: number }

let transcriber: Transcriber | null = null
let transcriberConfig: VoiceModelConfig | null = null
let transcriberPromise: Promise<Transcriber> | null = null
let transcriberLoadMs = 0
let transcriberWarmupMs = 0

env.useBrowserCache = true
// Ship the matching ONNX Runtime with the app so voice capture does not depend on
// a third-party CDN being reachable from the browser.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL('/onnx-runtime/ort-wasm-simd-threaded.mjs', self.location.origin).href,
  wasm: new URL('/onnx-runtime/ort-wasm-simd-threaded.wasm', self.location.origin).href,
}
const customModelHost = import.meta.env.VITE_VOICE_MODEL_HOST?.trim()
if (customModelHost) {
  env.remoteHost = customModelHost.endsWith('/') ? customModelHost : `${customModelHost}/`
  env.remotePathTemplate = '{model}/{file}'
}

function remoteFileUrl(modelId: string, file: string) {
  const path = env.remotePathTemplate
    .replaceAll('{model}', modelId)
    .replaceAll('{revision}', encodeURIComponent('main'))
  const relativePath = `${path}${file}`.replace(/^\/+/, '')
  return new URL(relativePath, env.remoteHost).href
}

async function isBrowserCacheHit(modelId: string, file: string): Promise<boolean | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(env.cacheKey)
    return Boolean(await cache.match(remoteFileUrl(modelId, file)))
  } catch {
    return null
  }
}

function progressCallback(modelId: string) {
  return (info: ProgressInfo) => {
    if (info.status !== 'progress' || !info.file || typeof info.progress !== 'number') return
    void isBrowserCacheHit(modelId, info.file).then(cacheHit => {
      // Transformers.js reports progress for cached reads too; only an absent exact cache key proves a fetch.
      if (cacheHit === false) scope.postMessage({ state: 'downloading', progress: info.progress })
    })
  }
}

function isFetchFailure(error: unknown) {
  return error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message)
}

function voiceErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (isFetchFailure(error)) {
    return 'Model download blocked. Allow huggingface.co and its hf.co file/CDN hosts, then retry.'
  }
  return message
}

async function loadModel(config: VoiceModelConfig) {
  const options = {
    device: config.device,
    ...(config.dtype ? { dtype: config.dtype as 'q8' | 'fp16' } : {}),
    progress_callback: progressCallback(config.id),
  }
  try {
    return await pipeline('automatic-speech-recognition', config.id, options)
  } catch (error) {
    // Browser model downloads occasionally fail before a response is received. A single
    // retry is cheap and avoids needlessly discarding a spoken task on transient failures.
    if (!isFetchFailure(error)) throw error
    return pipeline('automatic-speech-recognition', config.id, options)
  }
}

async function loadTranscriber() {
  const loadStarted = performance.now()
  const device = await detectDevice()
  const first = pickVoiceModel(device)
  let lastError: unknown

  for (const [index, config] of fallbackChain(first).entries()) {
    if (index > 0) scope.postMessage({ state: 'fallback' })
    try {
      const loaded = await loadModel(config)
      transcriberLoadMs = performance.now() - loadStarted
      transcriberConfig = config
      transcriberWarmupMs = await warmTranscriber(loaded)
      return loaded
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('No compatible on-device voice model could be loaded.')
}

function getTranscriber() {
  if (transcriber) return Promise.resolve(transcriber)
  if (!transcriberPromise) {
    transcriberPromise = loadTranscriber()
      .then(loaded => { transcriber = loaded; return loaded })
      .catch(error => { transcriberPromise = null; throw error })
  }
  return transcriberPromise
}

async function warmTranscriber(loaded: Transcriber) {
  const warmupStarted = performance.now()
  try {
    await (loaded as unknown as (input: Float32Array) => Promise<unknown>)(new Float32Array(16000))
  } catch { /* A silent warm-up can fail for a model without affecting real recordings. */ }
  return performance.now() - warmupStarted
}

let messageQueue: Promise<void> = Promise.resolve()

async function handleMessage(event: MessageEvent) {
  const { audio, sampleRate, requestId, type, kind } = event.data as {
    audio?: Float32Array
    sampleRate?: number
    requestId?: number
    type?: string
    kind?: 'draft' | 'final'
  }

  if (type === 'preload') {
    scope.postMessage({ state: 'loading' })
    try {
      await getTranscriber()
      const config = transcriberConfig!
      scope.postMessage({
        state: 'preloaded',
        model: config.id,
        device: config.device,
        dtype: config.dtype ?? 'default',
        loadMs: transcriberLoadMs,
        warmupMs: transcriberWarmupMs,
      })
    } catch (error) {
      scope.postMessage({ state: 'preload-error', error: voiceErrorMessage(error) })
    }
    return
  }

  try {
    if (!audio?.length) throw new Error('No speech was recorded.')
    if (!transcriber) scope.postMessage({ state: 'loading' })
    const activeTranscriber = await getTranscriber()
    scope.postMessage({ state: 'transcribing' })
    const resampleStarted = performance.now()
    const waveform = resampleForWhisper(audio, sampleRate || 16000)
    const resampleMs = performance.now() - resampleStarted
    const inferStarted = performance.now()
    const result = await (activeTranscriber as unknown as (input: Float32Array) => Promise<{ text?: string }>)(waveform)
    const inferMs = performance.now() - inferStarted
    scope.postMessage({ text: result.text?.trim() ?? '', requestId, kind, timings: { resampleMs, inferMs } })
  } catch (error) {
    scope.postMessage({ error: voiceErrorMessage(error), requestId })
  }
}

scope.onmessage = event => {
  messageQueue = messageQueue.then(() => handleMessage(event)).catch(error => {
    scope.postMessage({ error: voiceErrorMessage(error), requestId: (event.data as { requestId?: number }).requestId })
  })
  return messageQueue
}
