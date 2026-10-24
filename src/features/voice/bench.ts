import { env, pipeline } from '@huggingface/transformers'
import { resampleForWhisper } from './audio'
import { MOONSHINE_BASE, MOONSHINE_TINY, WHISPER_BASE_EN_GPU, WHISPER_TINY_EN } from './models'

type BenchDevice = 'webgpu' | 'wasm'
type VoiceWindow = Window & {
  __voiceBench?: (modelId: string, dtype?: string, device?: BenchDevice) => Promise<void>
}

function configureModelHost() {
  env.useBrowserCache = true
  const customModelHost = import.meta.env.VITE_VOICE_MODEL_HOST?.trim()
  if (customModelHost) {
    env.remoteHost = customModelHost.endsWith('/') ? customModelHost : `${customModelHost}/`
    env.remotePathTemplate = '{model}/{file}'
  }
}

function modelDefaults(modelId: string) {
  const known = [MOONSHINE_TINY, MOONSHINE_BASE, WHISPER_BASE_EN_GPU, WHISPER_TINY_EN]
  const model = known.find(candidate => candidate.id === modelId)
  return { dtype: model?.dtype, device: model?.device ?? 'webgpu' as BenchDevice }
}

async function recordFiveSeconds() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
  const context = new AudioContext()
  const sourceRate = context.sampleRate
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  processor.onaudioprocess = event => chunks.push(event.inputBuffer.getChannelData(0).slice())
  source.connect(processor)
  processor.connect(context.destination)
  try {
    await new Promise(resolve => window.setTimeout(resolve, 5_000))
  } finally {
    processor.disconnect()
    source.disconnect()
    stream.getTracks().forEach(track => track.stop())
    await context.close()
  }

  const raw = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length }
  if (!raw.length) throw new Error('No audio was captured. Check microphone permission and try again.')
  return resampleForWhisper(raw, sourceRate || 16000)
}

async function runVoiceBench(modelId: string, dtype?: string, device?: BenchDevice) {
  if (!modelId) throw new Error('Pass a model ID, such as onnx-community/moonshine-tiny-ONNX.')
  const defaults = modelDefaults(modelId)
  const selectedDtype = dtype ?? defaults.dtype
  const selectedDevice = device ?? defaults.device
  const audio = await recordFiveSeconds()
  configureModelHost()
  const options = { device: selectedDevice, ...(selectedDtype ? { dtype: selectedDtype as 'q8' | 'fp16' } : {}) }
  const loadStarted = performance.now()
  const transcriber = await pipeline('automatic-speech-recognition', modelId, options)
  const loadMs = performance.now() - loadStarted
  const inferStarted = performance.now()
  const result = await (transcriber as unknown as (input: Float32Array) => Promise<{ text?: string }>)(audio)
  const transcribeMs = performance.now() - inferStarted
  console.table([{ modelId, device: selectedDevice, dtype: selectedDtype ?? 'default', loadMs, transcribeMs, transcript: result.text?.trim() ?? '' }])
}

if (import.meta.env.DEV) (window as VoiceWindow).__voiceBench = runVoiceBench
