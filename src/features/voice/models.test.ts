import { describe, expect, it } from 'vitest'
import {
  MOONSHINE_TINY,
  WHISPER_BASE_EN_GPU,
  WHISPER_TINY_EN,
  fallbackChain,
  pickVoiceModel,
} from './models'

describe('pickVoiceModel', () => {
  it('chooses Moonshine Tiny for mobile devices', () => {
    expect(pickVoiceModel({ isMobile: true, deviceMemoryGB: 16, hasWebGPU: true })).toBe(MOONSHINE_TINY)
  })

  it('chooses Moonshine Tiny for devices with at most 4 GB of memory', () => {
    expect(pickVoiceModel({ isMobile: false, deviceMemoryGB: 4, hasWebGPU: true })).toBe(MOONSHINE_TINY)
  })

  it('chooses Whisper Base English on WebGPU-capable laptops with more than 4 GB of memory', () => {
    expect(pickVoiceModel({ isMobile: false, deviceMemoryGB: 8, hasWebGPU: true })).toBe(WHISPER_BASE_EN_GPU)
  })

  it('chooses Moonshine Tiny when WebGPU is unavailable', () => {
    expect(pickVoiceModel({ isMobile: false, deviceMemoryGB: 8, hasWebGPU: false })).toBe(MOONSHINE_TINY)
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
