import { FormEvent, useState } from 'react'
import { Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true); setNotice('')
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)
    if (result.error) setNotice(result.error.message)
    else if (mode === 'sign-up' && !result.data.session) setNotice('Check your email to finish creating your account.')
    else onSignedIn()
  }
  return <main className="auth-wrap"><section className="auth-card">
    <div className="brand-mark" aria-hidden="true"><Check size={18} /></div>
    <p className="eyebrow">A quiet place for your tasks</p><h1>Taskflow</h1>
    <p className="auth-copy">Sign in to keep your tasks in sync across devices.</p>
    <form onSubmit={submit} className="auth-form">
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {notice && <p className="notice" role="status">{notice}</p>}
      <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
    </form>
    <button className="text-button switch-auth" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setNotice('') }}>
      {mode === 'sign-in' ? 'Create an account' : 'Already have an account? Sign in'}
    </button>
  </section></main>
}
