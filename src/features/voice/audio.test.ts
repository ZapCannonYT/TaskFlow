import { describe, expect, it } from 'vitest'
import { resampleForWhisper, VOICE_SEGMENT_SECONDS } from './audio'

describe('voice audio preparation', () => {
  it('uses eight-second chunks to give Whisper more speech context', () => {
    expect(VOICE_SEGMENT_SECONDS).toBe(8)
  })

  it('preserves 16 kHz audio without changing its samples', () => {
    const audio = new Float32Array([0.2, -0.4, 0.1])
    expect(resampleForWhisper(audio, 16000)).toBe(audio)
  })

  it('resamples common 44.1 kHz microphone audio to 16 kHz for Whisper', () => {
    const input = new Float32Array(44100)
    for (let i = 0; i < input.length; i++) input[i] = Math.sin(2 * Math.PI * 440 * i / 44100)

    const output = resampleForWhisper(input, 44100)

    expect(output).toHaveLength(16000)
    expect(output.every(Number.isFinite)).toBe(true)
    expect(Math.max(...output.subarray(200, 500))).toBeGreaterThan(0.8)
    expect(Math.min(...output.subarray(200, 500))).toBeLessThan(-0.8)
  })
})
