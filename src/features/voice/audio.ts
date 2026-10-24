export const VOICE_SEGMENT_SECONDS = 8

export function resampleForWhisper(input: Float32Array, sourceRate: number) {
  if (sourceRate === 16000) return input
  const ratio = sourceRate / 16000
  const output = new Float32Array(Math.ceil(input.length / ratio))
  const cutoff = Math.min(1, 16000 / sourceRate) * 0.94
  const radius = 24
  for (let outIndex = 0; outIndex < output.length; outIndex++) {
    const center = outIndex * ratio
    const first = Math.max(0, Math.floor(center) - radius + 1)
    const last = Math.min(input.length - 1, Math.floor(center) + radius)
    let total = 0
    let weightTotal = 0
    for (let index = first; index <= last; index++) {
      const distance = index - center
      const normalized = distance / radius
      const window = 0.54 + 0.46 * Math.cos(Math.PI * normalized)
      const x = Math.PI * cutoff * distance
      const sinc = x === 0 ? 1 : Math.sin(x) / x
      const weight = cutoff * sinc * window
      total += input[index] * weight
      weightTotal += weight
    }
    output[outIndex] = weightTotal ? total / weightTotal : 0
  }
  return output
}
