import { useCallback, useEffect, useState } from 'react'
import { PushSubscriptionRow, supabase, UserPreferences } from '../../lib/supabase'
import { vapidBytes } from '../../lib/push'

type Options = {
  signedIn: boolean
  isOnline: boolean
  setError(message: string): void
  setErrorRetryable(retryable: boolean): void
}

export type SettingsDraft = { daily_nudge_time: string; quiet_hours_start: string; quiet_hours_end: string; weekly_summary_enabled: boolean }

const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'

/** Notification preferences, this device's push subscription, and the actions that change them. */
export function useNotificationSettings({ signedIn, isOnline, setError, setErrorRetryable }: Options) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRow[]>([])
  const [currentPushEndpoint, setCurrentPushEndpoint] = useState<string | null>(null)
  const [devicePushStateChecked, setDevicePushStateChecked] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({ daily_nudge_time: '18:30', quiet_hours_start: '22:30', quiet_hours_end: '08:00', weekly_summary_enabled: true })
  const [pushBusy, setPushBusy] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const [retryPushSetup, setRetryPushSetup] = useState<boolean | null>(null)

  const loadNotificationSettings = useCallback(async () => {
    if (!supabase) return
    const [{ data: pref, error: prefError }, { data: devices }] = await Promise.all([
      supabase.from('user_preferences').select('*').maybeSingle(),
      supabase.from('push_subscriptions').select('id,endpoint,disabled_at,created_at').is('disabled_at', null).order('created_at', { ascending: false }),
    ])
    if (prefError) { setError(`Settings could not load · ${prefError.message}`); return }
    if (pref) {
      const row = pref as UserPreferences
      setPreferences(row)
      setSettingsDraft({ daily_nudge_time: row.daily_nudge_time, quiet_hours_start: row.quiet_hours_start, quiet_hours_end: row.quiet_hours_end, weekly_summary_enabled: row.weekly_summary_enabled })
    }
    setPushSubscriptions((devices ?? []) as PushSubscriptionRow[])
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        setCurrentPushEndpoint(subscription?.endpoint ?? null)
      } catch {
        setCurrentPushEndpoint(null)
      }
    } else setCurrentPushEndpoint(null)
    setDevicePushStateChecked(true)
  }, [setError])

  useEffect(() => { if (signedIn) void loadNotificationSettings() }, [signedIn, loadNotificationSettings])

  async function savePreferences(values: Partial<UserPreferences>) {
    if (!supabase || !isOnline) return false
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) { setError('Settings not saved · Sign in again to update your notification settings.'); return false }
    const { data, error: saveError } = await supabase.from('user_preferences')
      .update(values)
      .eq('user_id', auth.user.id)
      .select('*')
      .single()
    if (saveError) { setError(`Settings not saved · ${saveError.message}`); return false }
    setPreferences(data as UserPreferences)
    return true
  }

  async function setupPush(enableDailyNudge: boolean) {
    if (!supabase || !isOnline || pushBusy) return
    setRetryPushSetup(null)
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!vapidPublicKey || !('Notification' in window) || !('PushManager' in window)) {
      setError('Notifications are not supported or configured in this browser.')
      return
    }
    setPushBusy(true); setError('')
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') { setError('Notifications were not enabled. You can change this in browser settings.'); return }
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(vapidPublicKey) })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('This browser did not return a complete push subscription.')
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error('Sign in again to enable notifications.')
      const { data: existing } = await supabase.from('push_subscriptions').select('id').eq('endpoint', json.endpoint).maybeSingle()
      const saved = existing
        ? await supabase.from('push_subscriptions').update({ p256dh: json.keys.p256dh, auth: json.keys.auth, disabled_at: null, last_seen_at: new Date().toISOString() }).eq('id', existing.id)
        : await supabase.from('push_subscriptions').insert({ user_id: userData.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
      if (saved.error) throw saved.error
      if (enableDailyNudge) {
        const enabled = await savePreferences({ daily_nudge_enabled: true, timezone: localTimezone() })
        if (!enabled) return
      }
      await loadNotificationSettings()
      setError('')
      setRetryPushSetup(null)
      if (!enableDailyNudge) setNotificationMessage('This device is set up for task reminders.')
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Try again.'
      setRetryPushSetup(enableDailyNudge)
      setErrorRetryable(true)
      setError(detail.includes('Registration failed - push service error')
        ? 'Chrome’s push service could not register this device. Retry in a moment. If it keeps happening, check your connection and Chrome’s notification permission for this site.'
        : `Notifications could not be enabled · ${detail}`)
    } finally { setPushBusy(false) }
  }

  async function deferNotificationPrompt() {
    if (!preferences) return
    const dismissals = Math.min(2, preferences.prompt_dismissals + 1)
    await savePreferences({ prompt_dismissals: dismissals, prompt_reoffer_at: dismissals < 2 ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() : null })
  }

  async function testNotification() {
    if (!supabase || !isOnline) return
    setPushBusy(true)
    const { error: testError } = await supabase.functions.invoke('test-push', { body: {} })
    setPushBusy(false)
    if (testError) { setError(`Test notification failed · ${testError.message}`); return }
    setError('')
    setNotificationMessage('Test notification sent to your active devices.')
  }

  async function saveNotificationTimes() {
    if (!settingsDraft.daily_nudge_time || !settingsDraft.quiet_hours_start || !settingsDraft.quiet_hours_end || settingsDraft.quiet_hours_start === settingsDraft.quiet_hours_end) {
      setError('Choose a nudge time and quiet hours with different start and end times.')
      return
    }
    await savePreferences(settingsDraft)
  }

  async function removeSubscription(device: PushSubscriptionRow) {
    if (!supabase || !isOnline) return
    const registration = await navigator.serviceWorker.ready
    const current = await registration.pushManager.getSubscription()
    if (current?.endpoint === device.endpoint) await current.unsubscribe()
    const { error: removeError } = await supabase.from('push_subscriptions').delete().eq('id', device.id)
    if (removeError) { setError(`Device could not be removed · ${removeError.message}`); return }
    await loadNotificationSettings()
  }

  return {
    preferences, pushSubscriptions, currentPushEndpoint, devicePushStateChecked, settingsDraft, setSettingsDraft, pushBusy, notificationMessage, retryPushSetup,
    loadNotificationSettings, savePreferences, setupPush, enableNotifications: () => setupPush(true), deferNotificationPrompt, testNotification, saveNotificationTimes, removeSubscription,
  }
}

export type NotificationSettings = ReturnType<typeof useNotificationSettings>
