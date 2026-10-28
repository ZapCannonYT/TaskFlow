import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildSeedTasks } from './seed'

type VoiceWindow = Window & { __voiceStatus?: () => unknown }

export default function DevPanel() {
  const [expanded, setExpanded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [message, setMessage] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('voice status not available')
  const host = useMemo(() => {
    try { return new URL(import.meta.env.VITE_SUPABASE_URL ?? '').hostname } catch { return 'not configured' }
  }, [])
  const isProductionData = Boolean(import.meta.env.VITE_PRODUCTION_SUPABASE_HOST && host === import.meta.env.VITE_PRODUCTION_SUPABASE_HOST)

  useEffect(() => {
    if (!expanded) return
    const updateVoiceStatus = () => {
      const status = (window as VoiceWindow).__voiceStatus
      setVoiceStatus(status ? JSON.stringify(status()) : 'voice status not available')
    }
    updateVoiceStatus()
    const timer = window.setInterval(updateVoiceStatus, 1_000)
    return () => window.clearInterval(timer)
  }, [expanded])

  async function seedTasks() {
    if (!supabase) { setMessage('Supabase is not configured.'); return }
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) { setMessage('Sign in before seeding tasks.'); return }
    const { error } = await supabase.from('tasks').insert(buildSeedTasks(new Date()).map(task => ({ ...task, user_id: userData.user!.id })), { defaultToNull: false })
    setMessage(error ? `Seed failed: ${error.message}` : 'Sample tasks added.')
  }

  async function removeSeededTasks() {
    if (!supabase) { setMessage('Supabase is not configured.'); return }
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) { setMessage('Sign in before removing sample tasks.'); return }
    const { error } = await supabase.from('tasks').delete().eq('user_id', userData.user.id).like('title', '[seed] %')
    setMessage(error ? `Removal failed: ${error.message}` : 'Seeded tasks removed.')
  }

  function setSimulatedOffline(next: boolean) {
    setOffline(next)
    window.dispatchEvent(new Event(next ? 'offline' : 'online'))
  }

  function clearSnapshots() {
    Object.keys(localStorage).filter(key => key.startsWith('taskflow:snapshot:')).forEach(key => localStorage.removeItem(key))
    setMessage('Cached task snapshots cleared.')
  }

  if (!expanded) return <button type="button" onClick={() => setExpanded(true)} style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 9999 }}>Dev</button>

  return <section style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 9999, width: 300, padding: 12, background: 'white', color: 'black', border: '1px solid black', fontFamily: 'sans-serif', fontSize: 13 }}>
    <button type="button" onClick={() => setExpanded(false)} style={{ float: 'right' }}>Close</button>
    <p style={{ color: isProductionData ? 'red' : 'inherit' }}>Supabase: {host}{isProductionData ? ' — PRODUCTION DATA' : ''}</p>
    <button type="button" onClick={() => void seedTasks()}>Seed sample tasks</button>{' '}
    <button type="button" onClick={() => void removeSeededTasks()}>Remove seeded tasks</button>
    <p><label><input type="checkbox" checked={offline} onChange={event => setSimulatedOffline(event.target.checked)} /> Simulate offline</label><br />Affects the app&apos;s own listeners only, not the network.</p>
    <p>Voice: {voiceStatus}</p>
    <button type="button" onClick={clearSnapshots}>Clear cached task snapshot</button>
    {message && <p>{message}</p>}
  </section>
}
