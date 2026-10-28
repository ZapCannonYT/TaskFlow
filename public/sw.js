const CACHE_NAME = 'taskflow-app-shell-v3'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/')
    if (!response.ok) throw new Error('Could not cache the app shell.')
    const html = await response.clone().text()
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)].map(match => match[1])
    const cache = await caches.open(CACHE_NAME)
    await cache.put('/', response)
    await cache.addAll([...APP_SHELL.slice(1), ...assets])
  })())
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('taskflow-app-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) void caches.open(CACHE_NAME).then(cache => cache.put('/', response.clone()))
      return response
    }).catch(async () => (await caches.match('/')) || Response.error()))
    return
  }

  if (url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) void caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()))
      return response
    })))
  }
})

self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { body: event.data?.text() ?? '' } }
  const actions = Array.isArray(payload.actions) ? payload.actions : []
  event.waitUntil(self.registration.showNotification(payload.title || 'Taskflow', {
    body: payload.body || 'You have a task to look at.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    data: payload.data || { url: '/' },
    actions,
    silent: Boolean(payload.silent),
    tag: payload.data?.reminder_id ? `taskflow-${payload.data.reminder_id}` : undefined,
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data || {}
  // Only ever open this app: a push payload pointing elsewhere falls back to the home screen.
  const requested = new URL(data.url || '/', self.location.origin)
  const target = requested.origin === self.location.origin ? requested : new URL('/', self.location.origin)
  if (data.reminder_id) {
    const action = ['done', 'hour', 'later', 'skip'].includes(event.action) ? event.action : 'open'
    target.searchParams.set('task_action', action)
    if (action !== 'open') target.searchParams.delete('quick_details')
    if (data.task_id) target.searchParams.set('task_id', data.task_id)
    target.searchParams.set('reminder_id', data.reminder_id)
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const current = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (current) {
      await current.navigate(target.href)
      await current.focus()
      return
    }
    await self.clients.openWindow(target.href)
  })())
})
