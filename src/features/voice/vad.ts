export const SPEECH_RMS = 0.012
export const SILENCE_STOP_MS = 2000
export const NO_SPEECH_STOP_MS = 8000

export function shouldStop(nowMs: number, lastVoiceMs: number, startedMs: number) {
  return (lastVoiceMs > 0 && nowMs - lastVoiceMs > SILENCE_STOP_MS)
    || (lastVoiceMs === 0 && nowMs - startedMs > NO_SPEECH_STOP_MS)
}
