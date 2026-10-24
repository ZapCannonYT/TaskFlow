import { RefObject } from 'react'

export function VoiceMeter({ meterRef }: { meterRef: RefObject<HTMLDivElement | null> }) {
  return <div className="voice-meter" ref={meterRef} role="img" aria-label="Live microphone level">
    {[0.55, 0.78, 1, 0.78, 0.55].map((bar, index) => <span key={index} style={{ '--bar': bar } as React.CSSProperties} />)}
  </div>
}
