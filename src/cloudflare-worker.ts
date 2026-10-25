interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
}

const MODEL_PATH = '/voice-model/'
const MODEL_REPOSITORIES = new Set([
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-base-ONNX',
  'onnx-community/whisper-base.en',
  'onnx-community/whisper-tiny.en',
])
const edgeCache = (caches as CacheStorage & { default: Cache }).default

async function fetchVoiceModel(request: Request, context: WorkerContext) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }

  const url = new URL(request.url)
  const rawParts = url.pathname.slice(MODEL_PATH.length).split('/')
  if (rawParts.some(part => /%2f|%5c/i.test(part))) return new Response('Not found', { status: 404 })

  let parts: string[]
  try {
    parts = rawParts.map(decodeURIComponent)
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const repository = parts.slice(0, 2).join('/')
  if (
    !MODEL_REPOSITORIES.has(repository)
    || parts[2] !== 'resolve'
    || parts[3] !== 'main'
    || parts.length < 5
    || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))
  ) return new Response('Not found', { status: 404 })

  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' })
  const range = request.headers.get('range')
  if (request.method === 'GET' && !range) {
    const cached = await edgeCache.match(cacheKey)
    if (cached) return cached
  }

  const upstreamPath = parts.map(encodeURIComponent).join('/')
  const upstreamUrl = new URL(upstreamPath, 'https://huggingface.co/')
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      ...(range ? { headers: { range } } : {}),
    })
  } catch {
    return new Response('Voice model download failed. Please retry.', { status: 502 })
  }
  const headers = new Headers()
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('cache-control', upstream.ok ? 'public, max-age=86400' : 'no-store')
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
  if (request.method === 'GET' && !range && response.ok) context.waitUntil(edgeCache.put(cacheKey, response.clone()))
  return response
}

export default {
  async fetch(request: Request, env: Env, context: WorkerContext): Promise<Response> {
    if (new URL(request.url).pathname.startsWith(MODEL_PATH)) {
      return fetchVoiceModel(request, context)
    }
    return env.ASSETS.fetch(request)
  },
}
