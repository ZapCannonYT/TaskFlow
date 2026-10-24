import { SPEECH_RMS } from './vad'
import { COMMIT_PAUSE_MS, DRAFT_INTERVAL_MS, DRAFT_SLOW_MS, DRAFT_SLOW_STRIKES, MAX_UTTERANCE_MS, MIN_NEW_AUDIO_MS } from './liveConfig'

export const liveConfig = { COMMIT_PAUSE_MS, DRAFT_INTERVAL_MS, DRAFT_SLOW_MS, DRAFT_SLOW_STRIKES, MAX_UTTERANCE_MS, MIN_NEW_AUDIO_MS }
let pageDraftsEnabled = true
export function resetLiveSessionForTests() { pageDraftsEnabled = true }

type Action = { type: 'none' } | { type: 'draft'; utteranceId: number; seq: number; audio: Float32Array } | { type: 'commit'; utteranceId: number; audio: Float32Array }
export function createLiveSession(baseText: string, cfg = liveConfig) {
  let committed = ''
  let currentDraft = ''
  let previousDraft = ''
  let stableDraft = ''
  let utteranceId = 0
  let seq = 0
  let newestSeq = 0
  let slowStrikes = 0
  let chunks: Float32Array[] = []
  let length = 0
  let samplesSinceDraft = 0
  let speechSamples = 0
  let startedAt = 0
  let lastVoiceAt = 0
  let lastDraftAt = Number.NEGATIVE_INFINITY
  let heardSpeech = false
  let currentDraftId: number | null = null
  let sampleRateNow = 16000
  const awaitingFinals = new Set<number>()

  const audioCopy = () => {
    const output = new Float32Array(length)
    let offset = 0
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
    return output
  }
  const resetUtterance = () => {
    utteranceId++; seq = 0; newestSeq = 0; chunks = []; length = 0; samplesSinceDraft = 0; speechSamples = 0
    startedAt = 0; lastVoiceAt = 0; lastDraftAt = Number.NEGATIVE_INFINITY; heardSpeech = false
    currentDraft = ''; previousDraft = ''; stableDraft = ''
  }
  const commit = (): Action => {
    const id = utteranceId
    if (!heardSpeech) { resetUtterance(); return { type: 'none' } }
    const audio = audioCopy()
    awaitingFinals.add(id)
    resetUtterance()
    return { type: 'commit', utteranceId: id, audio }
  }
  return {
    pushAudio(samples: Float32Array, sampleRate: number, rms: number, nowMs: number) {
      if (!length) startedAt = nowMs
      const copy = new Float32Array(samples)
      chunks.push(copy); length += copy.length; samplesSinceDraft += copy.length
      if (rms > SPEECH_RMS) { heardSpeech = true; lastVoiceAt = nowMs; speechSamples += copy.length }
      // Keep the rate for threshold calculation associated with the latest audio block.
      sampleRateNow = sampleRate
    },
    nextAction(nowMs: number, inFlight: boolean): Action {
      if (length && ((heardSpeech && nowMs - lastVoiceAt >= cfg.COMMIT_PAUSE_MS) || nowMs - startedAt >= cfg.MAX_UTTERANCE_MS)) return commit()
      if (!pageDraftsEnabled || !heardSpeech || inFlight || !length || speechSamples < sampleRateNow * 0.9) return { type: 'none' }
      if (nowMs - lastDraftAt < cfg.DRAFT_INTERVAL_MS || samplesSinceDraft < sampleRateNow * cfg.MIN_NEW_AUDIO_MS / 1000) return { type: 'none' }
      lastDraftAt = nowMs; samplesSinceDraft = 0; seq++; newestSeq = seq
      return { type: 'draft', utteranceId, seq, audio: audioCopy() }
    },
    onDraftResult(id: number, resultSeq: number, text: string, inferMs: number) {
      if (id !== utteranceId || resultSeq < newestSeq) return
      currentDraft = text.trim()
      if (previousDraft) {
        const before = previousDraft.split(/\s+/)
        const now = currentDraft.split(/\s+/)
        const sameWord = (a: string, b: string) => a.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === b.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
        let shared = 0
        while (shared < before.length && shared < now.length && sameWord(before[shared], now[shared])) shared++
        stableDraft = now.slice(0, shared).join(' ')
      }
      previousDraft = currentDraft
      currentDraftId = id
      if (inferMs > cfg.DRAFT_SLOW_MS) slowStrikes++
      else slowStrikes = 0
      if (slowStrikes >= cfg.DRAFT_SLOW_STRIKES) pageDraftsEnabled = false
    },
    onFinalResult(id: number, text: string) {
      if (!awaitingFinals.delete(id)) return
      const clean = text.trim()
      if (clean) committed = [committed, clean].filter(Boolean).join(' ')
      if (currentDraftId === id) { currentDraft = ''; previousDraft = ''; stableDraft = ''; currentDraftId = null }
    },
    finish(_nowMs: number): Array<{ type: 'commit'; utteranceId: number; audio: Float32Array }> {
      const action = length && heardSpeech ? commit() : (length ? (resetUtterance(), { type: 'none' as const }) : { type: 'none' as const })
      return action.type === 'commit' ? [action] : []
    },
    getText() { return [baseText.trim(), committed.trim(), currentDraft.trim()].filter(Boolean).join(' ').trim().slice(0, 500) },
    getDraftText() { return currentDraftId === utteranceId ? currentDraft : '' },
    getStableText() { return [baseText.trim(), committed.trim(), stableDraft.trim()].filter(Boolean).join(' ').trim().slice(0, 500) },
    draftsEnabled() { return pageDraftsEnabled },
  }
}
