import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pipelineMock } = vi.hoisted(() => ({ pipelineMock: vi.fn() }))

vi.mock('@huggingface/transformers', () => ({ pipeline: pipelineMock }))

type WorkerHandler = (event: { data: { audio?: Float32Array; sampleRate?: number; requestId?: number; type?: string } }) => Promise<void>

async function startWorker() {
  vi.resetModules()
  await import('./whisper.worker')
  return (self as unknown as { onmessage: WorkerHandler }).onmessage
}

describe('on-device Whisper worker', () => {
  beforeEach(() => {
    pipelineMock.mockReset()
    ;(self as unknown as { messages?: unknown[] }).messages = []
    ;(self as unknown as { postMessage: (message: unknown) => void }).postMessage = function (message) {
      ;(self as unknown as { messages: unknown[] }).messages.push(message)
    }
  })

  it('uses the English-only model without task or language generation options', async () => {
    const transcriber = vi.fn(async () => ({ text: 'Call the dentist' }))
    pipelineMock.mockResolvedValue(transcriber)
    const onmessage = await startWorker()
    const audio = new Float32Array(16000)

    await onmessage({ data: { audio, sampleRate: 16000, requestId: 7 } })

    expect(pipelineMock).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'onnx-community/whisper-base.en',
      { device: 'wasm' },
    )
    expect(transcriber).toHaveBeenCalledTimes(1)
    expect(transcriber.mock.calls[0]).toHaveLength(1)
    expect((self as unknown as { messages: Array<{ text?: string; error?: string; requestId?: number }> }).messages)
      .toContainEqual(expect.objectContaining({ text: 'Call the dentist', requestId: 7 }))
  })

  it('preloads the model once and reuses it for the first recording', async () => {
    const transcriber = vi.fn(async () => ({ text: 'Buy milk' }))
    pipelineMock.mockResolvedValue(transcriber)
    const onmessage = await startWorker()

    await onmessage({ data: { type: 'preload' } })
    await onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })

    expect(pipelineMock).toHaveBeenCalledTimes(1)
    expect((self as unknown as { messages: Array<{ state?: string }> }).messages)
      .toContainEqual(expect.objectContaining({ state: 'preloaded' }))
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
    expect((self as unknown as { messages: Array<{ text?: string }> }).messages)
      .toContainEqual(expect.objectContaining({ text: 'Walk the dog' }))
  })

  it('returns an empty transcript without inventing task text', async () => {
    pipelineMock.mockResolvedValue(vi.fn(async () => ({ text: '   ' })))
    const onmessage = await startWorker()

    await onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })

    expect((self as unknown as { messages: Array<{ text?: string }> }).messages)
      .toContainEqual(expect.objectContaining({ text: '' }))
  })

  it('surfaces transcription errors as errors instead of task text', async () => {
    pipelineMock.mockResolvedValue(vi.fn(async () => { throw new Error('decoder failed') }))
    const onmessage = await startWorker()

    await onmessage({ data: { audio: new Float32Array(16000), sampleRate: 16000 } })

    expect((self as unknown as { messages: Array<{ error?: string; text?: string }> }).messages)
      .toContainEqual(expect.objectContaining({ error: 'decoder failed' }))
    expect((self as unknown as { messages: Array<{ text?: string }> }).messages.some(message => 'text' in message)).toBe(false)
  })
})
