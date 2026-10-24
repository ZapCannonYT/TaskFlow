import { describe, expect, it } from 'vitest'
import { resampleForWhisper, VOICE_SEGMENT_SECONDS } from './audio'

function referenceResample(input: Float32Array, sourceRate: number) {
  if (sourceRate === 16000) return input
  const ratio = sourceRate / 16000
  const output = new Float32Array(Math.ceil(input.length / ratio))
  const cutoff = Math.min(1, 16000 / sourceRate) * 0.94
  const radius = 24
  for (let outIndex = 0; outIndex < output.length; outIndex++) {
    const center = outIndex * ratio
    const first = Math.max(0, Math.floor(center) - radius + 1)
    const last = Math.min(input.length - 1, Math.floor(center) + radius)
    let total = 0, weightTotal = 0
    for (let index = first; index <= last; index++) {
      const distance = index - center
      const normalized = distance / radius
      const window = 0.54 + 0.46 * Math.cos(Math.PI * normalized)
      const x = Math.PI * cutoff * distance
      const sinc = x === 0 ? 1 : Math.sin(x) / x
      const weight = cutoff * sinc * window
      total += input[index] * weight; weightTotal += weight
    }
    output[outIndex] = weightTotal ? total / weightTotal : 0
  }
  return output
}

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

  it.each([44100, 48000, 22050])('matches the reference resampler for %i Hz', rate => {
    let seed = 17
    const input = Float32Array.from({ length: rate * 2 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff * 2 - 1 })
    const expected = referenceResample(input, rate), actual = resampleForWhisper(input, rate)
    expect(actual).toHaveLength(expected.length)
    let maxDifference = 0
    for (let index = 0; index < actual.length; index++) maxDifference = Math.max(maxDifference, Math.abs(actual[index] - expected[index]))
    expect(maxDifference).toBeLessThanOrEqual(1e-5)
  })
})
