import { FormEvent, useState } from 'react'
import { Check, Eye, EyeOff, Mic, Bell, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../lib/password'

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'reset'
type Notice = { text: string; tone: 'error' | 'info' }

/** Supabase's messages, in the app's own words where a plainer one helps. */
function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match. Check them, or reset your password.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: open the link we sent you, then sign in.'
  if (/already registered/i.test(message)) return 'An account with this email already exists. Sign in instead.'
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.'
  if (/failed to fetch|network/i.test(message)) return 'Could not reach the server. Check your connection and try again.'
  return message
}

const HEADINGS: Record<Mode, { title: string; copy: string; submit: string }> = {
  'sign-in': { title: 'Welcome back', copy: 'Sign in to pick up where you left off, on any device.', submit: 'Sign in' },
  'sign-up': { title: 'Create your account', copy: 'Your tasks sync between your phone and laptop.', submit: 'Create account' },
  forgot: { title: 'Reset your password', copy: 'Enter your email and we will send you a link to choose a new password.', submit: 'Send reset link' },
  reset: { title: 'Choose a new password', copy: 'Pick a password you have not used here before.', submit: 'Save password' },
}

/** Sign in, create an account, request a reset link, or (after following that link) set a new password. */
export function AuthScreen({ recovering = false, onSignedIn }: { recovering?: boolean; onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>(recovering ? 'reset' : 'sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const heading = HEADINGS[mode]
  const switchMode = (next: Mode) => { setMode(next); setNotice(null); setPassword('') }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy) return
    const address = email.trim()
    const weak = mode === 'sign-up' || mode === 'reset' ? passwordProblem(password, address) : null
    if (weak) { setNotice({ tone: 'error', text: weak }); return }
    setBusy(true); setNotice(null)
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: window.location.origin })
        if (error) throw error
        setNotice({ tone: 'info', text: `If ${address} has an account, a reset link is on its way.` })
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        onSignedIn()
      } else if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password })
        if (error) throw error
        onSignedIn()
      } else {
        const { data, error } = await supabase.auth.signUp({ email: address, password })
        if (error) throw error
        if (data.session) onSignedIn()
        else setNotice({ tone: 'info', text: `Check ${address} for a link to finish creating your account.` })
      }
    } catch (cause) {
      setNotice({ tone: 'error', text: friendly(cause instanceof Error ? cause.message : 'Something went wrong. Try again.') })
    } finally { setBusy(false) }
  }

  const needsEmail = mode !== 'reset'
  const needsPassword = mode !== 'forgot'
  return <main className="auth-wrap">
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-mark" aria-hidden="true"><Check size={18}/></span><span>Taskflow</span></div>
      {(mode === 'sign-in' || mode === 'sign-up') && <div className="auth-switch" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={mode === 'sign-in'} onClick={() => switchMode('sign-in')}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === 'sign-up'} onClick={() => switchMode('sign-up')}>Create account</button>
      </div>}
      <h1>{heading.title}</h1>
      <p className="auth-copy">{heading.copy}</p>
      <form onSubmit={submit} className="auth-form">
        {needsEmail && <label>Email<input type="email" autoComplete="email" inputMode="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)}/></label>}
        {needsPassword && <div className="auth-field">
          <span className="auth-label-row"><label htmlFor="auth-password">Password</label>{mode === 'sign-in' && <button type="button" className="text-button auth-forgot" onClick={() => switchMode('forgot')}>Forgot password?</button>}</span>
          <span className="password-field">
            <input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={mode === 'sign-in' ? undefined : MIN_PASSWORD_LENGTH} required autoFocus={!needsEmail} value={password} onChange={e => setPassword(e.target.value)}/>
            <button type="button" className="icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(shown => !shown)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
          </span>
          {mode !== 'sign-in' && <span className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters, with a letter and a number.</span>}
        </div>}
        {notice && <p className={`notice ${notice.tone === 'error' ? 'notice-error' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : heading.submit}</button>
      </form>
      {mode === 'forgot' && <button type="button" className="text-button switch-auth" onClick={() => switchMode('sign-in')}>Back to sign in</button>}
      {mode === 'sign-up' && <ul className="auth-points" aria-label="What you get">
        <li><Mic size={15} aria-hidden="true"/>Add tasks by typing or speaking</li>
        <li><Bell size={15} aria-hidden="true"/>Gentle reminders, never nagging</li>
        <li><RefreshCw size={15} aria-hidden="true"/>Synced across your devices</li>
      </ul>}
    </section>
  </main>
}
