import { supabase } from '../../lib/supabase'
import { resampleForWhisper } from './audio'

export const CLOUD_MAX_SECONDS = 60

/** The endpoint is missing or not configured, as opposed to a single failed request. */
export class CloudUnavailableError extends Error {
  constructor() { super('Cloud transcription is unavailable.') }
}

/** 16 kHz mono 16-bit PCM WAV, the format Whisper expects. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

export async function transcribeInCloud(audio: Float32Array, sampleRate: number, signal?: AbortSignal): Promise<string> {
  const { data } = await supabase?.auth.getSession() ?? { data: { session: null } }
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in again to use voice capture.')
  const clipped = resampleForWhisper(audio, sampleRate).subarray(0, 16000 * CLOUD_MAX_SECONDS)
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav' },
    body: encodeWav(clipped),
    signal,
  })
  // Plain `vite` dev has no worker, so the SPA fallback answers with HTML.
  if (!response.headers.get('content-type')?.includes('application/json')) throw new CloudUnavailableError()
  const body = await response.json().catch(() => ({})) as { text?: string; error?: string }
  if (response.status === 404 || response.status === 503) throw new CloudUnavailableError()
  if (!response.ok) throw new Error(body.error ?? `Cloud transcription failed (${response.status}).`)
  return (body.text ?? '').trim()
}
