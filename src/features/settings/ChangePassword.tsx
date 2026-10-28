import { FormEvent, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../../lib/password'

/** Asks for the current password first, so an unlocked device left open is not enough to take over the account. */
export function ChangePassword({ email, isOnline }: { email: string; isOnline: boolean }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    const weak = passwordProblem(next, email) ?? (next === current ? 'Choose a password different from your current one.' : null)
    if (weak) { setMessage({ text: weak, error: true }); return }
    setBusy(true); setMessage(null)
    const check = await supabase.auth.signInWithPassword({ email, password: current })
    if (check.error) { setBusy(false); setMessage({ text: 'Your current password is not right.', error: true }); return }
    const { error } = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (error) { setMessage({ text: `Password not changed · ${error.message}`, error: true }); return }
    setCurrent(''); setNext(''); setOpen(false)
    setMessage({ text: 'Password changed.', error: false })
  }

  if (!open) return <>
    {message && <p className={`settings-copy ${message.error ? 'notice-error' : ''}`} role="status">{message.text}</p>}
    <button className="secondary-button" disabled={!isOnline} onClick={() => { setOpen(true); setMessage(null) }}>Change password</button>
  </>
  return <form className="change-password" onSubmit={submit}>
    <label>Current password<input type="password" autoComplete="current-password" required autoFocus value={current} onChange={e => setCurrent(e.target.value)}/></label>
    <label>New password<input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={next} onChange={e => setNext(e.target.value)}/><span className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters, with a letter and a number.</span></label>
    {message && <p className={`settings-copy ${message.error ? 'notice-error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    <div className="settings-actions"><button className="primary-button" disabled={busy || !isOnline}>{busy ? 'Saving…' : 'Save new password'}</button><button type="button" className="text-button" onClick={() => { setOpen(false); setCurrent(''); setNext(''); setMessage(null) }}>Cancel</button></div>
  </form>
}
