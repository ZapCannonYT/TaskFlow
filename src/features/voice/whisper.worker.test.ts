import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pipelineMock, envMock } = vi.hoisted(() => ({
  pipelineMock: vi.fn(),
  envMock: { useBrowserCache: false, remoteHost: 'https://huggingface.co/', remotePathTemplate: '{model}/resolve/{revision}/', cacheKey: 'transformers-cache' },
}))

vi.mock('@huggingface/transformers', () => ({ pipeline: pipelineMock, env: envMock }))

type WorkerMessage = {
  audio?: Float32Array
  sampleRate?: number
  requestId?: number
  type?: string
  state?: string
  text?: string
  error?: string
  model?: string
  device?: string
  dtype?: string
  timings?: { resampleMs: number; inferMs: number }
}
type WorkerHandler = (event: { data: WorkerMessage }) => Promise<void>

async function startWorker() {
  vi.resetModules()
  await import('./whisper.worker')
  return (self as unknown as { onmessage: WorkerHandler }).onmessage
}

function messages() {
  return (self as unknown as { messages: WorkerMessage[] }).messages
}

describe('on-device speech worker', () => {
  beforeEach(() => {
    pipelineMock.mockReset()
    envMock.useBrowserCache = false
    envMock.remoteHost = 'https://huggingface.co/'
    envMock.remotePathTemplate = '{model}/resolve/{revision}/'
    ;(self as unknown as { messages?: WorkerMessage[] }).messages = []
    ;(self as unknown as { postMessage: (message: WorkerMessage) => void }).postMessage = function (message) {
      ;(self as unknown as { messages: WorkerMessage[] }).messages.push(message)
    }
  })

  it('uses Moonshine Tiny on devices without WebGPU and transcribes the recording', async () => {
    const transcriber = vi.fn(async (_audio: Float32Array) => ({ text: 'Call the dentist' }))
    pipelineMock.mockResolvedValue(transcriber)
    const onmessage = await startWorker()
    const audio = new Float32Array(16000)

    await onmessage({ data: { audio, sampleRate: 16000, requestId: 7 } })

    expect(envMock.useBrowserCache).toBe(true)
    expect(pipelineMock).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/moonshine-tiny-ONNX',
      expect.objectContaining({ device: 'wasm', dtype: 'q8', progress_callback: expect.any(Function) }),
    )
    expect(transcriber.mock.calls.at(-1)).toHaveLength(1)
    expect(transcriber.mock.calls.at(-1)?.[0]).toBe(audio)
    expect(messages()).toContainEqual(expect.objectContaining({ text: 'Call the dentist', requestId: 7 }))
  })

  it('preloads and warms the model once, then reuses it for the first recording', async () => {
    const transcriber = vi.fn(async (_audio: Float32Array) => ({ text: 'Buy milk' }))
    pipelineMock.mockResolvedValue(transcriber)
    const onmessage = await startWorker()

    await onmessage({ data: { type: 'preload' } })
    await onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })

    expect(pipelineMock).toHaveBeenCalledTimes(1)
    expect(transcriber).toHaveBeenCalledTimes(2)
    expect(transcriber.mock.calls[0][0]).toEqual(new Float32Array(16000))
    expect(messages()).toContainEqual(expect.objectContaining({ state: 'preloaded' }))
  })

  it('shares an in-progress preload when recording starts immediately', async () => {
    const transcriber = vi.fn(async () => ({ text: 'Walk the dog' }))
    let finishLoading!: (value: typeof transcriber) => void
    pipelineMock.mockImplementation(() => new Promise(resolve => { finishLoading = resolve }))
    const onmessage = await startWorker()
    const preload = onmessage({ data: { type: 'preload' } })
    const recording = onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })

    await vi.waitFor(() => expect(pipelineMock).toHaveBeenCalledTimes(1))
    finishLoading(transcriber)
    await Promise.all([preload, recording])

    expect(pipelineMock).toHaveBeenCalledTimes(1)
    expect(messages()).toContainEqual(expect.objectContaining({ text: 'Walk the dog' }))
  })

  it('returns an empty transcript without inventing task text', async () => {
    pipelineMock.mockResolvedValue(vi.fn(async () => ({ text: '   ' })))
    const onmessage = await startWorker()
    await onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })
    expect(messages()).toContainEqual(expect.objectContaining({ text: '' }))
  })

  it('surfaces transcription errors as errors instead of task text', async () => {
    pipelineMock.mockResolvedValue(vi.fn(async () => { throw new Error('decoder failed') }))
    const onmessage = await startWorker()
    await onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })
    expect(messages()).toContainEqual(expect.objectContaining({ error: 'decoder failed' }))
    expect(messages().some(message => 'text' in message)).toBe(false)
  })

  it('tries the next model and posts fallback when the first pipeline fails', async () => {
    pipelineMock.mockRejectedValueOnce(new Error('tiny failed')).mockResolvedValue(vi.fn(async () => ({ text: 'Fallback worked' })))
    const onmessage = await startWorker()
    await onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })
    expect(pipelineMock).toHaveBeenNthCalledWith(2, 'automatic-speech-recognition', 'onnx-community/whisper-tiny.en', expect.any(Object))
    expect(messages()).toContainEqual({ state: 'fallback' })
    expect(messages()).toContainEqual(expect.objectContaining({ text: 'Fallback worked' }))
  })

  it('includes the selected model configuration in preloaded', async () => {
    pipelineMock.mockResolvedValue(vi.fn(async () => ({ text: '' })))
    const onmessage = await startWorker()
    await onmessage({ data: { type: 'preload' } })
    expect(messages()).toContainEqual(expect.objectContaining({
      state: 'preloaded', model: 'onnx-community/moonshine-tiny-ONNX', device: 'wasm', dtype: 'q8',
      loadMs: expect.any(Number), warmupMs: expect.any(Number),
    }))
  })

  it('includes resampling and inference timings in the transcription result', async () => {
    pipelineMock.mockResolvedValue(vi.fn(async () => ({ text: 'timed' })))
    const onmessage = await startWorker()
    await onmessage({ data: { audio: new Float32Array(48000), sampleRate: 48000, requestId: 9 } })
    expect(messages()).toContainEqual(expect.objectContaining({
      text: 'timed', requestId: 9,
      timings: { resampleMs: expect.any(Number), inferMs: expect.any(Number) },
    }))
  })

  it('continues to preloaded if the silent warm-up inference throws', async () => {
    const transcriber = vi.fn().mockRejectedValueOnce(new Error('empty audio rejected')).mockResolvedValue({ text: '' })
    pipelineMock.mockResolvedValue(transcriber)
    const onmessage = await startWorker()
    await onmessage({ data: { type: 'preload' } })
    expect(messages()).toContainEqual(expect.objectContaining({ state: 'preloaded' }))
  })
})
