import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelAllTranscriptions, getVoiceStatus, startVoicePreload, subscribeVoiceStatus, transcribeSegment, type VoiceStatus } from './voiceWorker'
import { createLiveSession } from './liveSession'
import { shouldStop, SPEECH_RMS } from './vad'
import { CLOUD_MAX_SECONDS, CloudUnavailableError, transcribeInCloud } from './cloudTranscribe'

type State = 'idle' | 'listening' | 'transcribing' | 'ready'
const MIC_CONSTRAINTS = { channelCount: 1, echoCancellation: true, noiseSuppression: true }
const RAW_MIC_CONSTRAINTS = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
// Once the cloud endpoint is known to be missing (e.g. plain `vite` dev), use the on-device model for the rest of the page's life.
let cloudUnavailable = false

function joinChunks(chunks: Float32Array[]) {
  const output = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
  return output
}

export function useVoiceCapture({ isOnline, onText }: { isOnline: boolean; onText: (title: string) => void }) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  const [processing, setProcessing] = useState(false)
  const [hasTranscript, setHasTranscript] = useState(false)
  const [modelStatus, setModelStatus] = useState<VoiceStatus>(getVoiceStatus())
  const meterRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const sessionRef = useRef<ReturnType<typeof createLiveSession> | null>(null)
  const endedRef = useRef(false)
  const jobsRef = useRef(0)
  const startedRef = useRef(0)
  const lastVoiceRef = useRef(0)
  const rateRef = useRef(16000)
  const frameRef = useRef<number | null>(null)
  const intervalRef = useRef<number | null>(null)
  const statusRef = useRef(getVoiceStatus())
  const activeFallbacksRef = useRef(0)
  const hasTranscriptRef = useRef(false)
  const cloudRef = useRef(false)
  const recordedRef = useRef<Float32Array[]>([])
  const baseTitleRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => subscribeVoiceStatus(status => {
    statusRef.current = status
    setModelStatus(status)
    if (!jobsRef.current) return
    if (status.fallbacks > activeFallbacksRef.current) setMessage('Switching to the compatible on-device model…')
    else if (status.state === 'loading') setMessage('Getting voice ready…')
    else if (status.state === 'downloading') setMessage('Downloading voice model… this may take a moment.')
    else if (status.state === 'ready') setMessage('Transcribing on this device…')
  }), [])

  const clearAudio = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
    intervalRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    if (meterRef.current) meterRef.current.style.setProperty('--level', '0')
    if (nodeRef.current instanceof AudioWorkletNode) nodeRef.current.port.onmessage = null
    nodeRef.current?.disconnect(); nodeRef.current = null
    sourceRef.current?.disconnect(); sourceRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null
    void contextRef.current?.close(); contextRef.current = null
  }, [])

  const finishIfDone = useCallback(() => {
    if (!endedRef.current || jobsRef.current > 0) return
    setProcessing(false)
    setState('ready')
    setMessage(hasTranscriptRef.current ? 'Transcript ready. Edit the title, then press Add.' : 'No speech was heard. Try again.')
  }, [])

  const runAction = useCallback((action: Exclude<ReturnType<ReturnType<typeof createLiveSession>['nextAction']>, { type: 'none' }>) => {
    jobsRef.current++
    setProcessing(true)
    const fallbacks = statusRef.current.fallbacks
    activeFallbacksRef.current = fallbacks
    const priority = action.type === 'draft' ? 'draft' : 'final'
    void transcribeSegment(action.audio, rateRef.current, priority).then(result => {
      const session = sessionRef.current
      if (!session) return
      if (action.type === 'draft') session.onDraftResult(action.utteranceId, action.seq, result.text, result.timings?.inferMs ?? 0)
      else session.onFinalResult(action.utteranceId, result.text)
      const text = session.getText()
      if (action.type === 'draft') onText(session.getStableText())
      else onText(text)
      if (action.type === 'commit' && text) { hasTranscriptRef.current = true; setHasTranscript(true) }
      if (!session.draftsEnabled() && !endedRef.current) setMessage('Live text is slow on this device. Text will appear after each pause.')
      else if (statusRef.current.fallbacks > fallbacks) setMessage('Switching to the compatible on-device model…')
      else if (endedRef.current) setMessage('Finishing the transcript…')
      else setMessage('Listening… text appears as you speak.')
    }).catch(cause => {
      const reason = cause instanceof Error ? cause.message : String(cause)
      if (reason === 'superseded' || reason === 'cancelled') return
      clearAudio()
      endedRef.current = false
      setState(hasTranscriptRef.current ? 'ready' : 'idle')
      setMessage(`Transcription failed · ${reason.slice(0, 180)}. No task was added.`)
    }).finally(() => {
      jobsRef.current = Math.max(0, jobsRef.current - 1)
      if (jobsRef.current === 0) { setProcessing(false); finishIfDone() }
    })
  }, [clearAudio, finishIfDone, onText])

  const transcribeWhole = useCallback(() => {
    const audio = joinChunks(recordedRef.current)
    recordedRef.current = []
    if (!lastVoiceRef.current || !audio.length) return
    const rate = rateRef.current
    const controller = new AbortController()
    abortRef.current = controller
    jobsRef.current++
    setProcessing(true)
    setMessage('Transcribing…')
    const applyText = (text: string) => {
      const title = [baseTitleRef.current.trim(), text].filter(Boolean).join(' ').slice(0, 500)
      if (text) { hasTranscriptRef.current = true; setHasTranscript(true); onText(title) }
    }
    void transcribeInCloud(audio, rate, controller.signal).then(applyText).catch(async cause => {
      if (controller.signal.aborted) return
      if (cause instanceof CloudUnavailableError) cloudUnavailable = true
      setMessage('Cloud voice is unavailable, using the on-device model…')
      try {
        const result = await transcribeSegment(audio, rate, 'final')
        if (!controller.signal.aborted) applyText(result.text.trim())
      } catch (fallbackCause) {
        const reason = fallbackCause instanceof Error ? fallbackCause.message : String(fallbackCause)
        if (reason !== 'cancelled') setMessage(`Transcription failed · ${reason.slice(0, 180)}. No task was added.`)
      }
    }).finally(() => {
      if (abortRef.current === controller) abortRef.current = null
      jobsRef.current = Math.max(0, jobsRef.current - 1)
      if (jobsRef.current === 0 && !controller.signal.aborted) { setProcessing(false); finishIfDone() }
    })
  }, [finishIfDone, onText])

  const stop = useCallback(() => {
    if (endedRef.current) return
    clearAudio()
    endedRef.current = true
    setState('transcribing')
    setMessage('Finishing the transcript…')
    if (cloudRef.current) { transcribeWhole(); finishIfDone(); return }
    const finalActions = sessionRef.current?.finish(Date.now()) ?? []
    for (const action of finalActions) runAction(action)
    finishIfDone()
  }, [clearAudio, finishIfDone, runAction, transcribeWhole])

  const start = useCallback(async (baseTitle = '') => {
    if (!isOnline || !['idle', 'ready'].includes(state)) return
    cloudRef.current = !cloudUnavailable
    if (!cloudRef.current && statusRef.current.state !== 'ready') startVoicePreload()
    hasTranscriptRef.current = false; setHasTranscript(false); jobsRef.current = 0; endedRef.current = false
    recordedRef.current = []; baseTitleRef.current = baseTitle
    sessionRef.current = createLiveSession(baseTitle)
    setMessage('Allow microphone access so Taski can turn speech into a task.')
    try {
      const raw = new URLSearchParams(location.search).get('mic') === 'raw'
      const stream = await navigator.mediaDevices.getUserMedia({ audio: raw ? RAW_MIC_CONSTRAINTS : MIC_CONSTRAINTS })
      streamRef.current = stream
      let context: AudioContext
      try {
        context = new AudioContext({ sampleRate: 16000 })
        if (context.sampleRate !== 16000) { await context.close(); throw new Error('Requested sample rate unavailable') }
      } catch { context = new AudioContext() }
      contextRef.current = context; rateRef.current = context.sampleRate
      const source = context.createMediaStreamSource(stream); sourceRef.current = source
      startedRef.current = Date.now(); lastVoiceRef.current = 0
      const handleAudio = (input: Float32Array, rms: number) => {
        const now = Date.now()
        const session = sessionRef.current
        if (!session || endedRef.current) return
        if (cloudRef.current) recordedRef.current.push(new Float32Array(input))
        else session.pushAudio(input, context.sampleRate, rms, now)
        const updateMeter = () => {
          meterRef.current?.style.setProperty('--level', String(Math.min(1, rms * 10)))
          frameRef.current = null
        }
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(updateMeter)
        if (rms > SPEECH_RMS) lastVoiceRef.current = now
        if (shouldStop(now, lastVoiceRef.current, startedRef.current) || (cloudRef.current && now - startedRef.current >= CLOUD_MAX_SECONDS * 1000)) { stop(); return }
      }
      let workletConnected = false
      if (context.audioWorklet) {
        try {
          await context.audioWorklet.addModule('/voice-recorder-worklet.js')
          const node = new AudioWorkletNode(context, 'voice-recorder', { numberOfInputs: 1, numberOfOutputs: 1 })
          nodeRef.current = node
          node.port.onmessage = event => handleAudio(event.data.samples as Float32Array, Number(event.data.rms))
          source.connect(node); node.connect(context.destination); workletConnected = true
        } catch { /* use ScriptProcessor on browsers without a working AudioWorklet */ }
      }
      if (!workletConnected) {
        const processor = context.createScriptProcessor(4096, 1, 1); nodeRef.current = processor
        processor.onaudioprocess = event => {
          const input = event.inputBuffer.getChannelData(0)
          let power = 0; for (const value of input) power += value * value
          handleAudio(input, Math.sqrt(power / input.length))
        }
        source.connect(processor); processor.connect(context.destination)
      }
      setState('listening'); setMessage(cloudRef.current ? 'Listening… pause when you are done.' : 'Listening… text appears as you speak.')
      intervalRef.current = window.setInterval(() => {
        const session = sessionRef.current
        if (!session || endedRef.current || cloudRef.current) return
        const action = session.nextAction(Date.now(), jobsRef.current > 0)
        if (action.type !== 'none') runAction(action)
      }, 100)
    } catch (cause) {
      clearAudio(); setState('idle')
      const detail = cause instanceof Error ? cause.message : String(cause)
      setMessage(`Microphone could not start · ${detail.slice(0, 180)}. You can type your task instead.`)
    }
  }, [clearAudio, isOnline, runAction, state, stop])

  const cancelTranscription = useCallback(() => {
    clearAudio(); endedRef.current = false; sessionRef.current = null; jobsRef.current = 0
    abortRef.current?.abort(); abortRef.current = null; recordedRef.current = []
    cancelAllTranscriptions(); setProcessing(false); setState(hasTranscriptRef.current ? 'ready' : 'idle'); setMessage('Transcription stopped. No task was added.')
  }, [clearAudio])
  const reset = useCallback(() => {
    clearAudio(); endedRef.current = true; sessionRef.current = null; jobsRef.current = 0; hasTranscriptRef.current = false
    abortRef.current?.abort(); abortRef.current = null; recordedRef.current = []
    setState('idle'); setMessage(''); setProcessing(false); setHasTranscript(false)
  }, [clearAudio])
  useEffect(() => () => clearAudio(), [clearAudio])
  return { state, message, processing, hasTranscript, start, stop, cancelTranscription, reset, meterRef, modelStatus }
}
