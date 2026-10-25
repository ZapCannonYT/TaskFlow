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

export function pickVoiceModel(): VoiceModelConfig {
  return MOONSHINE_TINY
}

export function fallbackChain(first: VoiceModelConfig): VoiceModelConfig[] {
  return [first, MOONSHINE_TINY, WHISPER_TINY_EN].filter(
    (model, index, models) => models.findIndex(candidate => candidate.id === model.id) === index,
  )
}
