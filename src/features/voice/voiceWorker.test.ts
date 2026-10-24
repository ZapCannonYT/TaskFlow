import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  sent: Array<{ message: Record<string, unknown>; transfer?: Transferable[] }> = []
  terminated = false
  constructor(_url: string | URL, _options?: WorkerOptions) { MockWorker.instances.push(this) }
  postMessage(message: Record<string, unknown>, transfer?: Transferable[]) { this.sent.push({ message, transfer }) }
  terminate() { this.terminated = true }
  emit(data: Record<string, unknown>) { this.onmessage?.({ data } as MessageEvent) }
}

describe('singleton voice worker', () => {
  beforeEach(() => { vi.resetModules(); MockWorker.instances = []; vi.stubGlobal('Worker', MockWorker) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('preloads once, publishes state, and resolves a transcription request', async () => {
    const voice = await import('./voiceWorker')
    voice.startVoicePreload(); voice.startVoicePreload()
    expect(MockWorker.instances).toHaveLength(1)
    const worker = MockWorker.instances[0]
    expect(worker.sent).toHaveLength(1)
    worker.emit({ state: 'loading' })
    worker.emit({ state: 'downloading', progress: 42 })
    expect(voice.getVoiceStatus()).toMatchObject({ state: 'downloading', progress: 42 })
    worker.emit({ state: 'fallback' })
    worker.emit({ state: 'preloaded', model: 'test-model', device: 'wasm', dtype: 'q8', loadMs: 10, warmupMs: 2 })
    expect(voice.getVoiceStatus()).toMatchObject({ state: 'ready', fallbacks: 1, model: 'test-model' })
    const result = voice.transcribeSegment(new Float32Array([0.1, 0.2]), 16000)
    const request = worker.sent.at(-1)!.message
    expect(request.kind).toBe('final')
    worker.emit({ requestId: request.requestId, text: 'Test result', timings: { resampleMs: 1, inferMs: 2 } })
    await expect(result).resolves.toMatchObject({ text: 'Test result', timings: { inferMs: 2 } })
    const cancelled = voice.transcribeSegment(new Float32Array([0.3]), 16000)
    voice.cancelAllTranscriptions()
    await expect(cancelled).rejects.toThrow('cancelled')
    expect(worker.terminated).toBe(true)
    expect(MockWorker.instances).toHaveLength(2)
    expect(MockWorker.instances[1].sent[0].message).toEqual({ type: 'preload' })
  })

  it('gives final work priority and replaces queued drafts', async () => {
    const voice = await import('./voiceWorker')
    voice.startVoicePreload()
    const worker = MockWorker.instances[0]
    worker.emit({ state: 'preloaded', model: 'test', device: 'wasm', dtype: 'q8', loadMs: 1, warmupMs: 1 })
    const firstFinal = voice.transcribeSegment(new Float32Array([1]), 16000, 'final')
    const firstRequest = worker.sent.at(-1)!.message
    const olderDraft = voice.transcribeSegment(new Float32Array([2]), 16000, 'draft')
    const newerDraft = voice.transcribeSegment(new Float32Array([3]), 16000, 'draft')
    await expect(olderDraft).rejects.toThrow('superseded')
    const queuedFinal = voice.transcribeSegment(new Float32Array([4]), 16000, 'final')
    expect(worker.sent.filter(entry => 'audio' in entry.message)).toHaveLength(1)
    worker.emit({ requestId: firstRequest.requestId, text: 'first' })
    await firstFinal
    expect(worker.sent.at(-1)!.message.kind).toBe('final')
    const finalRequest = worker.sent.at(-1)!.message
    worker.emit({ requestId: finalRequest.requestId, text: 'final' })
    await queuedFinal
    expect(worker.sent.at(-1)!.message.kind).toBe('draft')
    worker.emit({ requestId: worker.sent.at(-1)!.message.requestId, text: 'draft' })
    await newerDraft
  })

  it('ignores unknown worker states and recovers after a worker error', async () => {
    const voice = await import('./voiceWorker')
    voice.startVoicePreload()
    const worker = MockWorker.instances[0]
    worker.emit({ state: 'preloaded', model: 'test', device: 'wasm', dtype: 'q8', loadMs: 1, warmupMs: 1 })
    const pending = voice.transcribeSegment(new Float32Array([1]), 16000)
    worker.emit({ state: 'unknown-state' })
    expect(voice.getVoiceStatus().state).toBe('ready')
    worker.onerror?.({ message: 'worker crashed' } as ErrorEvent)
    await expect(pending).rejects.toThrow('worker crashed')
    expect(voice.getVoiceStatus()).toMatchObject({ state: 'error', error: 'worker crashed' })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(MockWorker.instances).toHaveLength(2)
    expect(MockWorker.instances[1].sent[0].message).toEqual({ type: 'preload' })
  })
})
