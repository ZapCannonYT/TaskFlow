export const VOICE_SEGMENT_SECONDS = 8

const kernelCache = new Map<number, Float64Array[]>()
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

function kernelsFor(sourceRate: number) {
  const cached = kernelCache.get(sourceRate)
  if (cached) return cached
  const divisor = gcd(sourceRate, 16000)
  const phases = 16000 / divisor
  const cutoff = Math.min(1, 16000 / sourceRate) * 0.94
  const radius = 24
  const kernels = Array.from({ length: phases }, (_, phase) => {
    const fraction = phase / phases
    const weights = new Float64Array(radius * 2)
    let total = 0
    for (let tap = 0; tap < weights.length; tap++) {
      const distance = tap - (radius - 1) - fraction
      const normalized = distance / radius
      const window = 0.54 + 0.46 * Math.cos(Math.PI * normalized)
      const x = Math.PI * cutoff * distance
      const sinc = x === 0 ? 1 : Math.sin(x) / x
      weights[tap] = cutoff * sinc * window
      total += weights[tap]
    }
    for (let tap = 0; tap < weights.length; tap++) weights[tap] /= total
    return weights
  })
  kernelCache.set(sourceRate, kernels)
  return kernels
}

export function resampleForWhisper(input: Float32Array, sourceRate: number) {
  if (sourceRate === 16000) return input
  const ratio = sourceRate / 16000
  const output = new Float32Array(Math.ceil(input.length / ratio))
  const cutoff = Math.min(1, 16000 / sourceRate) * 0.94
  const radius = 24
  const kernels = kernelsFor(sourceRate)
  for (let outIndex = 0; outIndex < output.length; outIndex++) {
    const center = outIndex * ratio
    const base = Math.floor(center)
    const first = Math.max(0, base - radius + 1)
    const last = Math.min(input.length - 1, base + radius)
    if (first === base - radius + 1 && last === base + radius) {
      const phaseCount = kernels.length
      const phase = ((outIndex * (sourceRate / gcd(sourceRate, 16000))) % phaseCount + phaseCount) % phaseCount
      const weights = kernels[phase]
      let total = 0
      for (let tap = 0; tap < weights.length; tap++) total += input[first + tap] * weights[tap]
      output[outIndex] = total
      continue
    }
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
