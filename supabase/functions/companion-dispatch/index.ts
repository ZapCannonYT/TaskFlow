import { createClient } from 'npm:@supabase/supabase-js@2.76.1'
import webpush from 'npm:web-push@3.6.7'
import { localDateTime, localParts, quietEndAt, constantTimeEqual, isSupportedPushEndpoint, safeTimeZone, selectSupabaseKey } from '../_shared/companion.ts'
import { rankCompanionTasks } from '../../../src/lib/companion.ts'

type Preference = {
  user_id: string; timezone: string; daily_nudge_enabled: boolean; daily_nudge_time: string
  quiet_hours_start: string; quiet_hours_end: string; weekly_summary_enabled: boolean
  weekly_summary_day: number; skipped_until: string | null
}
type Reminder = {
  id: string; user_id: string; task_id: string | null; kind: string; scheduled_at: string
  payload: Record<string, unknown>; attempt_count: number
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function configurePush() {
  const publicKey = Deno.env.get('TASKFLOW_VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('TASKFLOW_VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('TASKFLOW_VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) throw new Error('Push delivery is not configured.')
  webpush.setVapidDetails(subject, publicKey, privateKey)
}

async function createDailyRows(admin: ReturnType<typeof createClient>) {
  const { data: preferences, error } = await admin.from('user_preferences').select('*').eq('daily_nudge_enabled', true)
  if (error) throw error
  const now = new Date()
  for (const prefs of (preferences ?? []) as Preference[]) {
    const timezone = safeTimeZone(prefs.timezone)
    const { data: subscriptions } = await admin.from('push_subscriptions').select('id').eq('user_id', prefs.user_id).is('disabled_at', null).limit(1)
    if (!subscriptions?.length) continue
    const local = localParts(now, timezone)
    if (prefs.skipped_until === local.day) continue
    const [hour, minute] = prefs.daily_nudge_time.slice(0, 5).split(':').map(Number)
    if (local.hour * 60 + local.minute < hour * 60 + minute) continue

    const weekday = new Date(`${local.day}T00:00:00Z`).getUTCDay()
    const isWeekly = prefs.weekly_summary_enabled && weekday === prefs.weekly_summary_day
    const { data: taskRows, error: taskError } = await admin.from('tasks')
      .select('id,title,due_at,due_is_approx,size,is_important,status,created_at,deleted_at')
      .eq('user_id', prefs.user_id).eq('status', 'open').is('deleted_at', null)
    if (taskError) throw taskError
    const ranked = rankCompanionTasks(taskRows ?? [], now, timezone)[0]
    if (!ranked) continue

    const dueSoon = (taskRows ?? []).filter((task: { due_at: string | null }) => {
      if (!task.due_at) return false
      const dayDiff = Math.floor((Date.parse(task.due_at) - now.getTime()) / 86400000)
      return dayDiff >= 0 && dayDiff <= 3
    }).length
    const dueDay = ranked.task.due_at ? localParts(new Date(ranked.task.due_at), timezone).day : null
    const dayOffset = dueDay ? Math.round((Date.parse(`${dueDay}T00:00:00Z`) - Date.parse(`${local.day}T00:00:00Z`)) / 86400000) : null
    const title = isWeekly ? 'Your week at a glance'
      : dueDay && dayOffset !== null && dayOffset < 0 ? `Missed: ${ranked.task.title}`
        : dueDay && dayOffset === 0 ? `Do now: ${ranked.task.title}`
        : ranked.task.size === 'big' && dayOffset !== null && dayOffset <= 2 ? `Start today: ${ranked.task.title}`
          : `Next up: ${ranked.task.title}`
    const body = isWeekly
      ? `This week: ${(taskRows ?? []).length} open · ${dueSoon} due soon · Biggest: ${ranked.task.title}`
      : `${ranked.reason}${(taskRows ?? []).length > 1 ? ` · ${taskRows.length - 1} more` : ''}`
    const planned = localDateTime(local.day, prefs.daily_nudge_time, timezone)
    const deferred = quietEndAt(planned, timezone, prefs.quiet_hours_start, prefs.quiet_hours_end)
    const scheduledAt = (deferred && deferred.getTime() > planned.getTime() ? deferred : planned).toISOString()
    const key = `${isWeekly ? 'weekly' : 'daily'}:${prefs.user_id}:${local.day}`
    await admin.from('task_reminders').upsert({
      user_id: prefs.user_id, task_id: isWeekly ? null : ranked.task.id,
      kind: isWeekly ? 'weekly' : 'daily', scheduled_at: scheduledAt, dedupe_key: key,
      payload: {
        task_id: isWeekly ? null : ranked.task.id, title, body, local_day: local.day,
        reason: ranked.reason, urgent: !isWeekly && dayOffset !== null && dayOffset <= 0,
      },
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  }
}

async function sendToUser(admin: ReturnType<typeof createClient>, prefs: Preference, reminder: Reminder) {
  const { data: currentReminder, error: reminderError } = await admin.from('task_reminders').select('status').eq('id', reminder.id).maybeSingle()
  if (reminderError) throw reminderError
  if (!currentReminder || currentReminder.status !== 'processing') return 'cancelled'
  const timezone = safeTimeZone(prefs.timezone)
  if (reminder.kind === 'details_prompt') {
    const localDay = localParts(new Date(), timezone).day
    const nextDay = new Date(`${localDay}T00:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const { data: sentToday, error: budgetError } = await admin.from('task_reminders').select('id')
      .eq('user_id', prefs.user_id).eq('kind', 'details_prompt').eq('status', 'sent')
      .gte('sent_at', localDateTime(localDay, '00:00', timezone).toISOString())
      .lt('sent_at', localDateTime(nextDay.toISOString().slice(0, 10), '00:00', timezone).toISOString())
    if (budgetError) throw budgetError
    if ((sentToday ?? []).length >= 2) {
      await admin.from('task_reminders').update({ status: 'cancelled', locked_at: null }).eq('id', reminder.id)
      return 'cancelled'
    }
  }
  const quietEnd = quietEndAt(new Date(), timezone, prefs.quiet_hours_start, prefs.quiet_hours_end)
  if (quietEnd) {
    if (reminder.kind === 'daily_repeat') {
      await admin.from('task_reminders').update({ status: 'cancelled', locked_at: null }).eq('id', reminder.id)
      return 'cancelled'
    }
    await admin.from('task_reminders').update({ status: 'pending', scheduled_at: quietEnd.toISOString(), locked_at: null }).eq('id', reminder.id)
    return 'deferred'
  }

  const taskId = reminder.task_id ?? (typeof reminder.payload.task_id === 'string' ? reminder.payload.task_id : null)
  let task: Record<string, unknown> | null = null
  if (taskId) {
    const { data } = await admin.from('tasks').select('id,title,status,deleted_at,due_at,due_is_approx,size,is_important,label_id,recurrence_rule,description,reminder_offset,details_prompted_at').eq('id', taskId).eq('user_id', prefs.user_id).maybeSingle()
    task = data
    if (!task || task.status !== 'open' || task.deleted_at) {
      await admin.from('task_reminders').update({ status: 'cancelled', locked_at: null }).eq('id', reminder.id)
      return 'cancelled'
    }
    if (reminder.kind === 'details_prompt') {
      const count = Number(Boolean(task.due_at && !task.due_is_approx)) + Number(Boolean(task.size)) + Number(Boolean(task.is_important)) + Number(Boolean(task.label_id))
        + Number(Boolean(task.recurrence_rule)) + Number(Boolean(typeof task.description === 'string' && task.description.trim())) + Number(Boolean(task.reminder_offset && task.reminder_offset !== 'none'))
      if (task.details_prompted_at || count >= 5) {
        await admin.from('task_reminders').update({ status: 'cancelled', locked_at: null }).eq('id', reminder.id)
        return 'cancelled'
      }
    }
  }

  if (reminder.kind === 'daily_repeat') {
    const parentId = reminder.payload.parent_id
    const { data: parent } = await admin.from('task_reminders').select('action_at').eq('id', parentId).maybeSingle()
    if (!parent || parent.action_at) {
      await admin.from('task_reminders').update({ status: 'cancelled', locked_at: null }).eq('id', reminder.id)
      return 'cancelled'
    }
  }

  const { data: subscriptions, error } = await admin.from('push_subscriptions').select('*').eq('user_id', prefs.user_id).is('disabled_at', null)
  if (error) throw error
  let delivered = 0
  let lastError = ''
  for (const sub of subscriptions ?? []) {
    if (!isSupportedPushEndpoint(sub.endpoint)) {
      lastError = 'Unsupported push endpoint.'
      await admin.from('push_subscriptions').update({ disabled_at: new Date().toISOString() }).eq('id', sub.id)
      continue
    }
    try {
      const actions = ['advance', 'due'].includes(reminder.kind)
        ? [
          { action: 'done', title: 'Done' },
          { action: 'later', title: 'Remind me tomorrow' },
        ]
        : taskId ? [
          { action: 'done', title: 'Done' },
          { action: 'later', title: 'Tomorrow' },
          { action: 'skip', title: 'Skip today' },
        ] : []
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({
        title: String(reminder.payload.title ?? (['advance', 'due'].includes(reminder.kind) ? 'Task reminder' : 'Taskflow')),
        body: String(reminder.payload.body ?? task?.title ?? 'You have a task to look at.'),
        icon: '/icon-192.png', badge: '/icon-192.png',
        data: { reminder_id: reminder.id, task_id: taskId, url: reminder.kind === 'details_prompt' && taskId ? `/?quick_details=${encodeURIComponent(taskId)}` : '/' },
        actions,
        silent: reminder.kind === 'daily_repeat' || reminder.kind === 'details_prompt',
      }))
      delivered++
    } catch (error) {
      const pushError = error as { statusCode?: number; message?: string }
      lastError = pushError.message ?? 'Push delivery failed.'
      if (pushError.statusCode === 404 || pushError.statusCode === 410) {
        await admin.from('push_subscriptions').update({ disabled_at: new Date().toISOString() }).eq('id', sub.id)
      }
    }
  }
  if (!delivered) {
    const retryDelay = Math.min(60, 2 ** reminder.attempt_count) * 60 * 1000
    await admin.from('task_reminders').update({ status: 'failed', last_error: lastError || 'No active push subscriptions.', next_attempt_at: new Date(Date.now() + retryDelay).toISOString(), locked_at: null }).eq('id', reminder.id)
    return 'failed'
  }

  await admin.from('task_reminders').update({ status: 'sent', sent_at: new Date().toISOString(), delivered_via: 'push', last_error: null, locked_at: null }).eq('id', reminder.id)
  if (reminder.kind === 'details_prompt' && taskId) await admin.from('tasks').update({ details_prompted_at: new Date().toISOString() }).eq('id', taskId).eq('user_id', prefs.user_id)

  if (reminder.kind === 'daily' && reminder.payload.urgent === true && taskId) {
    const local = localParts(new Date(), timezone)
    const localMinutes = local.hour * 60 + local.minute
    if (localMinutes <= 19 * 60 + 15) {
      await admin.from('task_reminders').upsert({
        user_id: prefs.user_id, task_id: taskId, kind: 'daily_repeat',
        scheduled_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        dedupe_key: `repeat:${prefs.user_id}:${local.day}`,
        payload: { task_id: taskId, local_day: local.day, parent_id: reminder.id, title: 'Still time for this today', body: String(reminder.payload.title ?? task?.title ?? 'Your task') },
      }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    }
  }
  return 'sent'
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const provided = request.headers.get('x-taskflow-cron-secret') ?? ''
  const expected = Deno.env.get('TASKFLOW_DISPATCH_SECRET') ?? ''
  if (!expected || !constantTimeEqual(provided, expected)) return json({ error: 'Unauthorized.' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = selectSupabaseKey(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SUPABASE_SECRET_KEYS'))
  if (!url || !serviceKey) return json({ error: 'Server database configuration is missing.' }, 500)
  try {
    configurePush()
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    await createDailyRows(admin)
    const { data: reminders, error } = await admin.rpc('claim_taskflow_reminders', { batch_size: 50 })
    if (error) throw error
    let sent = 0, failed = 0, skipped = 0
    for (const reminder of (reminders ?? []) as Reminder[]) {
      const { data: prefs } = await admin.from('user_preferences').select('*').eq('user_id', reminder.user_id).maybeSingle()
      if (!prefs) {
        await admin.from('task_reminders').update({ status: 'cancelled', locked_at: null }).eq('id', reminder.id)
        skipped++
        continue
      }
      const result = await sendToUser(admin, prefs as Preference, reminder)
      if (result === 'sent') sent++
      else if (result === 'failed') failed++
      else skipped++
    }
    return json({ claimed: reminders?.length ?? 0, sent, failed, skipped })
  } catch (error) {
    console.error('Companion dispatch failed:', error)
    return json({ error: 'Reminder dispatch failed. Check Edge Function logs.' }, 500)
  }
})
