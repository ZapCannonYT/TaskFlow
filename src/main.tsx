import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { startVoicePreload } from './features/voice/voiceWorker'

if (import.meta.env.DEV) void import('./features/voice/bench')

if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData !== true) {
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(startVoicePreload, { timeout: 500 })
  else window.setTimeout(startVoicePreload, 300)
}

if ('serviceWorker' in navigator && (import.meta.env.PROD || import.meta.env.VITE_ENABLE_SW === 'true')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
} else if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) void registration.unregister()
  })
}

if (import.meta.env.DEV && new URLSearchParams(location.search).has('dev')) {
  void import('./dev/DevPanel').then(({ default: DevPanel }) => {
    const host = document.createElement('div')
    document.body.append(host)
    ReactDOM.createRoot(host).render(<DevPanel />)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
