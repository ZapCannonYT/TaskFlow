interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  AI?: { run(model: string, input: Record<string, unknown>): Promise<{ text?: string }> }
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
}

const TRANSCRIBE_PATH = '/api/transcribe'
const TRANSCRIBE_MODEL = '@cf/openai/whisper-large-v3-turbo'
// 16 kHz mono 16-bit WAV is 32 KB/s, so this allows a little over a minute of speech.
const MAX_AUDIO_BYTES = 2_200_000
const TRANSCRIBE_PROMPT = 'A short to-do item, for example: Call the bank tomorrow at 5 pm.'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

async function isSignedIn(request: Request, env: Env) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ') || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return false
  try {
    const response = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), { headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY } })
    return response.ok
  } catch {
    return false
  }
}

async function transcribe(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!env.AI) return json({ error: 'Cloud transcription is not configured.' }, 503)
  if (!await isSignedIn(request, env)) return json({ error: 'Sign in again to use voice capture.' }, 401)
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_AUDIO_BYTES) return json({ error: 'Recording is too long.' }, 413)
  const audio = new Uint8Array(await request.arrayBuffer())
  if (!audio.length) return json({ error: 'No audio received.' }, 400)
  if (audio.length > MAX_AUDIO_BYTES) return json({ error: 'Recording is too long.' }, 413)
  try {
    const result = await env.AI.run(TRANSCRIBE_MODEL, { audio: toBase64(audio), language: 'en', vad_filter: true, initial_prompt: TRANSCRIBE_PROMPT })
    return json({ text: (result.text ?? '').trim() })
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : 'Transcription failed.' }, 502)
  }
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
    const pathname = new URL(request.url).pathname
    if (pathname === TRANSCRIBE_PATH) return transcribe(request, env)
    if (pathname.startsWith(MODEL_PATH)) {
      return fetchVoiceModel(request, context)
    }
    return env.ASSETS.fetch(request)
  },
}
