import { describe, expect, it } from 'vitest'
import { NO_SPEECH_STOP_MS, shouldStop, SILENCE_STOP_MS } from './vad'

describe('voice activity detection', () => {
  it('stops only after the silence boundary', () => {
    expect(shouldStop(1500 + SILENCE_STOP_MS, 1500, 0)).toBe(false)
    expect(shouldStop(1502 + SILENCE_STOP_MS, 1501, 0)).toBe(true)
  })
  it('stops only after the no-speech boundary', () => {
    expect(shouldStop(NO_SPEECH_STOP_MS, 0, 0)).toBe(false)
    expect(shouldStop(NO_SPEECH_STOP_MS + 1, 0, 0)).toBe(true)
  })
})
