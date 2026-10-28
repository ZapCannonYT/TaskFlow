import type { ReactNode } from 'react'
import { ArrowLeft, Bell, Database, LogOut, Sparkles, UserRound } from 'lucide-react'
import type { MotionPref } from '../../lib/motion'
import type { NotificationSettings } from './useNotificationSettings'
import { ChangePassword } from './ChangePassword'

type SettingsPageProps = {
  settings: NotificationSettings
  isOnline: boolean
  pushConfigured: boolean
  email: string | null
  motionPref: MotionPref
  onMotionPref(pref: MotionPref): void
  onExport(): void
  onRestore(file?: File): void
  /** `everywhere` ends the sessions on all devices, for a lost phone or a shared computer. */
  onSignOut(everywhere: boolean): void
  onClose(): void
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="settings-section"><h2>{icon}{title}</h2>{children}</section>
}

/** A page of its own, opened from the gear in the top bar; Back, Escape or any tab returns to the lists. */
export function SettingsPage({ settings, isOnline, pushConfigured, email, motionPref, onMotionPref, onExport, onRestore, onSignOut, onClose }: SettingsPageProps) {
  const { preferences, settingsDraft, setSettingsDraft, pushBusy, pushSubscriptions, currentPushEndpoint, devicePushStateChecked, notificationMessage } = settings
  return <div className="settings-page" aria-label="Settings">
    <div className="page-heading settings-page-heading"><button className="text-button settings-back" onClick={onClose}><ArrowLeft size={16}/>Back</button><h1>Settings</h1></div>

    <Section icon={<Bell size={16}/>} title="Notifications">
      <p className="settings-copy">Taskflow only sends the daily nudge you choose and reminders you set on a task.</p>
      {!pushConfigured && <p className="settings-copy" role="status">Notifications need the public push key configured before this app can enable them.</p>}
      <div className="settings-actions">{preferences?.daily_nudge_enabled ? <button className="secondary-button" disabled={!isOnline} onClick={() => void settings.savePreferences({ daily_nudge_enabled: false, prompt_dismissals: 2 })}>Turn off daily nudge</button> : <button className="primary-button" disabled={!isOnline || !pushConfigured || pushBusy} onClick={() => void settings.enableNotifications()}>{pushBusy ? 'Setting up…' : 'Turn on daily nudge'}</button>}{preferences?.daily_nudge_enabled && devicePushStateChecked && !currentPushEndpoint && <button className="primary-button" disabled={!isOnline || !pushConfigured || pushBusy} onClick={() => void settings.enableNotifications()}>{pushBusy ? 'Setting up…' : 'Set up this device'}</button>}{preferences?.daily_nudge_enabled && <button className="secondary-button" disabled={!isOnline || !pushConfigured || pushBusy} onClick={() => void settings.testNotification()}>{pushBusy ? 'Sending…' : 'Send test notification'}</button>}</div>
      <div className="settings-grid"><label>Daily nudge time<input type="time" value={settingsDraft.daily_nudge_time.slice(0, 5)} onChange={e => setSettingsDraft(d => ({ ...d, daily_nudge_time: e.target.value }))}/></label><label>Quiet hours start<input type="time" value={settingsDraft.quiet_hours_start.slice(0, 5)} onChange={e => setSettingsDraft(d => ({ ...d, quiet_hours_start: e.target.value }))}/></label><label>Quiet hours end<input type="time" value={settingsDraft.quiet_hours_end.slice(0, 5)} onChange={e => setSettingsDraft(d => ({ ...d, quiet_hours_end: e.target.value }))}/></label></div>
      <label className="settings-check"><input type="checkbox" checked={settingsDraft.weekly_summary_enabled} onChange={e => setSettingsDraft(d => ({ ...d, weekly_summary_enabled: e.target.checked }))}/>Send a short summary on Sunday</label>
      <div className="settings-actions"><button className="secondary-button" disabled={!isOnline || !preferences} onClick={() => void settings.saveNotificationTimes()}>Save times</button></div>
      <div className="settings-devices"><strong>Devices receiving notifications</strong>{pushSubscriptions.length ? pushSubscriptions.map((device, index) => <div className="settings-device-row" key={device.id}><span>{currentPushEndpoint === device.endpoint ? 'This device' : `Other device ${index + 1}`}</span><button className="text-button" disabled={!isOnline} onClick={() => void settings.removeSubscription(device)}>Remove</button></div>) : <p className="settings-copy">No devices are set up yet.</p>}</div>
      {notificationMessage && <p className="settings-copy" role="status">{notificationMessage}</p>}
    </Section>

    <Section icon={<Sparkles size={16}/>} title="Appearance">
      <div className="settings-grid settings-motion"><label>Motion<select value={motionPref} onChange={e => onMotionPref(e.target.value as MotionPref)}><option value="full">Full animations</option><option value="reduced">Reduced</option><option value="system">Follow system</option></select></label></div>
    </Section>

    <Section icon={<Database size={16}/>} title="Your data">
      <p className="settings-copy">Download everything as a JSON file, or restore from one.</p>
      <div className="settings-actions"><button className="secondary-button" disabled={!isOnline} onClick={onExport}>Export data</button><label className="secondary-button backup-import">Restore backup<input type="file" accept="application/json,.json" disabled={!isOnline} onChange={e => { onRestore(e.target.files?.[0]); e.currentTarget.value = '' }}/></label></div>
    </Section>

    <Section icon={<UserRound size={16}/>} title="Account">
      {email && <p className="settings-copy">Signed in as <strong>{email}</strong></p>}
      {email && <ChangePassword email={email} isOnline={isOnline}/>}
      <div className="settings-actions"><button className="secondary-button" onClick={() => onSignOut(false)}><LogOut size={15}/>Sign out</button><button className="secondary-button" disabled={!isOnline} title="Ends every session, on all your devices" onClick={() => onSignOut(true)}>Sign out everywhere</button></div>
    </Section>

    <p className="settings-copy settings-version">Version {__APP_VERSION__.replace(/\.0$/, '')}</p>
  </div>
}
