export type VoiceModelConfig = { id: string; device: 'webgpu' | 'wasm'; dtype?: string; label: string }

export const WHISPER_BASE_EN_GPU: VoiceModelConfig = {
  id: 'onnx-community/whisper-base.en',
  device: 'webgpu',
  label: 'Whisper Base English',
}

export const MOONSHINE_TINY: VoiceModelConfig = {
  id: 'onnx-community/moonshine-tiny-ONNX',
  device: 'wasm',
  dtype: 'q8',
  label: 'Moonshine Tiny',
}

export const MOONSHINE_BASE: VoiceModelConfig = {
  id: 'onnx-community/moonshine-base-ONNX',
  device: 'webgpu',
  dtype: 'fp16',
  label: 'Moonshine Base',
}

export const WHISPER_TINY_EN: VoiceModelConfig = {
  id: 'onnx-community/whisper-tiny.en',
  device: 'wasm',
  dtype: 'q8',
  label: 'Whisper Tiny English',
}

export type DeviceInfo = { isMobile: boolean; deviceMemoryGB: number | undefined; hasWebGPU: boolean }

// To trial Moonshine base on laptops, change rule 3 to return MOONSHINE_BASE after bench results.
export function pickVoiceModel(d: DeviceInfo): VoiceModelConfig {
  if (d.isMobile) return MOONSHINE_TINY
  if (d.deviceMemoryGB !== undefined && d.deviceMemoryGB <= 4) return MOONSHINE_TINY
  if (d.hasWebGPU) return WHISPER_BASE_EN_GPU
  return MOONSHINE_TINY
}

export function fallbackChain(first: VoiceModelConfig): VoiceModelConfig[] {
  return [first, MOONSHINE_TINY, WHISPER_TINY_EN].filter(
    (model, index, models) => models.findIndex(candidate => candidate.id === model.id) === index,
  )
}

export async function detectDevice(): Promise<DeviceInfo> {
  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean }
    deviceMemory?: number
    gpu?: { requestAdapter: () => Promise<unknown> }
  }
  const isMobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav.userAgent)
  let hasWebGPU = false
  try { hasWebGPU = Boolean(nav.gpu && await nav.gpu.requestAdapter()) } catch { hasWebGPU = false }
  return { isMobile, deviceMemoryGB: nav.deviceMemory, hasWebGPU }
}
