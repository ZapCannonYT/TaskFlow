import { createClient } from 'npm:@supabase/supabase-js@2.76.1'
import webpush from 'npm:web-push@3.6.7'
import { isSupportedPushEndpoint, selectSupabaseKey } from '../_shared/companion.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '')
  const url = Deno.env.get('SUPABASE_URL')
  const anon = selectSupabaseKey(Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'))
  const service = selectSupabaseKey(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SUPABASE_SECRET_KEYS'))
  if (!token || !url || !anon || !service) return reply({ error: 'Sign in to send a test notification.' }, 401)

  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return reply({ error: 'Your session expired. Sign in again.' }, 401)

  const publicKey = Deno.env.get('TASKFLOW_VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('TASKFLOW_VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('TASKFLOW_VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) return reply({ error: 'Push delivery is not configured on the server yet.' }, 503)

  try {
    const admin = createClient(url, service, { auth: { persistSession: false } })
    const { data: subscriptions, error } = await admin.from('push_subscriptions').select('*').eq('user_id', user.id).is('disabled_at', null)
    if (error) throw error
    if (!subscriptions?.length) return reply({ error: 'This device is not set up for notifications yet.' }, 404)
    webpush.setVapidDetails(subject, publicKey, privateKey)
    let delivered = 0
    for (const sub of subscriptions) {
      if (!isSupportedPushEndpoint(sub.endpoint)) continue
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({
          title: 'Taskflow is ready', body: 'Notifications are reaching this device.',
          icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' }, actions: [],
        }))
        delivered++
      } catch (error) {
        const pushError = error as { statusCode?: number }
        if (pushError.statusCode === 404 || pushError.statusCode === 410) {
          await admin.from('push_subscriptions').update({ disabled_at: new Date().toISOString() }).eq('id', sub.id)
        }
      }
    }
    return delivered ? reply({ delivered }) : reply({ error: 'Push could not reach this device. Check the device subscription and Edge Function logs.' }, 502)
  } catch (error) {
    console.error('Test push failed:', error)
    return reply({ error: 'The test notification failed. Check Edge Function logs.' }, 500)
  }
})
