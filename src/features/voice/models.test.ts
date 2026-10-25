import { describe, expect, it } from 'vitest'
import {
  MOONSHINE_TINY,
  WHISPER_BASE_EN_GPU,
  WHISPER_TINY_EN,
  fallbackChain,
  pickVoiceModel,
} from './models'

describe('pickVoiceModel', () => {
  it('uses the small WASM model on every device', () => {
    expect(pickVoiceModel()).toBe(MOONSHINE_TINY)
  })
})

describe('fallbackChain', () => {
  it('preserves the requested fallback order', () => {
    expect(fallbackChain(WHISPER_BASE_EN_GPU)).toEqual([WHISPER_BASE_EN_GPU, MOONSHINE_TINY, WHISPER_TINY_EN])
  })

  it('removes duplicate IDs while preserving their first occurrence', () => {
    expect(fallbackChain(MOONSHINE_TINY)).toEqual([MOONSHINE_TINY, WHISPER_TINY_EN])
  })
})
