/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers'
import { resampleForWhisper } from './audio'

const scope = self as DedicatedWorkerGlobalScope
let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null
let transcriberPromise: Promise<Awaited<ReturnType<typeof pipeline>>> | null = null

async function loadTranscriber() {
  let gpuAvailable = false
  try { gpuAvailable = Boolean(await (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu?.requestAdapter()) } catch { /* try WASM */ }
  if (gpuAvailable) {
    try { return await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', { device: 'webgpu' }) }
    catch { scope.postMessage({ state: 'fallback' }) }
  }
  return await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', { device: 'wasm' })
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

scope.onmessage = async event => {
  const { audio, sampleRate, requestId, type } = event.data as { audio?: Float32Array; sampleRate?: number; requestId?: number; type?: string }
  if (type === 'preload') {
    scope.postMessage({ state: 'loading' })
    try {
      await getTranscriber()
      scope.postMessage({ state: 'preloaded' })
    } catch (error) {
      scope.postMessage({ state: 'preload-error', error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  try {
    if (!audio?.length) throw new Error('No speech was recorded.')
    if (!transcriber) scope.postMessage({ state: 'loading' })
    const activeTranscriber = await getTranscriber()
    scope.postMessage({ state: 'transcribing' })
    const waveform = resampleForWhisper(audio, sampleRate || 16000)
    const result = await (activeTranscriber as unknown as (input: Float32Array) => Promise<{ text?: string }>)(waveform)
    scope.postMessage({ text: result.text?.trim() ?? '', requestId })
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error), requestId })
  }
}
