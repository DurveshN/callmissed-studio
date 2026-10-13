import { randomUUID } from 'node:crypto'
import { creditsFor } from '@shared/ai/models'
import { StudioError } from '@shared/ipc/result'
import type { ApiCall } from './library-db'

export const CALLMISSED_URL = 'https://api.callmissed.com'
/** Image generation is one synchronous request (no job polling); GPT image models can take a while. */
const GENERATE_TIMEOUT_MS = 180_000
const DEFAULT_TIMEOUT_MS = 30_000
/** Signed history links come from CallMissed's storage; only https downloads are allowed. */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

export interface GenerateRequest {
  model: string
  prompt: string
  n: number
  size: string
  /** The flattened page (PNG), sent as the reference to edit. */
  reference: Uint8Array
}

export interface GeneratedImage {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
  revisedPrompt: string | null
}

export interface HistoryItem {
  id: string
  url: string
  model: string
  size: string
  prompt: string
  revisedPrompt: string | null
  created: number
}

export interface CatalogueModel {
  id: string
  status: string | null
  statusMessage: string | null
}

interface Deps {
  fetch: typeof fetch
  getKey(): Promise<string | null>
  log(call: ApiCall): void
  baseUrl?: string
}

/** Clear guidance per CallMissed error code (docs.callmissed.com/docs/errors, image-generation). */
const MESSAGES: Record<string, string> = {
  invalid_api_key: 'CallMissed did not accept the API key. Check it in Settings → CallMissed.',
  insufficient_credits:
    'Not enough CallMissed credits for this generation. Top up your account, then try again.',
  budget_exceeded: 'This API key has reached its spending cap. Raise the cap in the CallMissed console.',
  payment_method_required: 'CallMissed needs a payment method on your account before it can generate images.',
  permission_denied:
    'This API key may not generate images. Give it the "image" permission in the CallMissed console.',
  model_not_available: 'This model is not available on your CallMissed plan. Choose another model.',
  model_not_allowed: 'This API key is not allowed to use this model. Choose another model or change the key.',
  model_not_found: 'CallMissed does not know this model any more. Choose another model.',
  content_policy_violation:
    'CallMissed declined this request under its content policy (no credits were used). Change the prompt or the picture.',
  quota_exceeded:
    'Your monthly image limit on CallMissed is used up. Upgrade the plan or wait for next month.',
  rate_limit_exceeded: 'Too many requests to CallMissed right now. Wait a moment, then try again.',
  too_many_concurrent_requests:
    'CallMissed is still working on other requests from this key. Try again shortly.',
  upstream_error: 'The image service is temporarily unavailable (no credits were used). Try again shortly.',
  model_under_maintenance: 'This model is under maintenance on CallMissed. Choose another model for now.'
}

/** CallMissed's error body: {error: {message, type, code}}, or {detail} / {detail: [{msg}]} (422). */
async function apiError(response: Response): Promise<{ code: string; message: string }> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // not JSON
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const detail = (body as { detail?: unknown } | null)?.detail
  const code =
    typeof error?.code === 'string'
      ? error.code
      : response.status === 401
        ? 'invalid_api_key'
        : response.status === 422
          ? 'validation_error'
          : `http_${response.status}`
  const serverMessage =
    typeof error?.message === 'string'
      ? error.message
      : typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((d) => (d as { msg?: unknown }).msg)
              .filter((m) => typeof m === 'string')
              .join('; ')
          : ''
  const retryAfter = Number(response.headers.get('retry-after'))
  let message =
    MESSAGES[code] ??
    (serverMessage ? `CallMissed: ${serverMessage}` : `CallMissed returned HTTP ${response.status}.`)
  if ((code === 'rate_limit_exceeded' || code === 'too_many_concurrent_requests') && retryAfter > 0) {
    message = `${message.replace(/ Wait a moment, then try again\.| Try again shortly\./, '')} Try again in ${Math.ceil(retryAfter)} s.`
  }
  return { code, message }
}

const isAbort = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')

/** The CallMissed REST API, called from the main process only (the key never reaches the renderer). */
export class CallMissedClient {
  private readonly base: string

  constructor(private readonly deps: Deps) {
    this.base = (deps.baseUrl ?? CALLMISSED_URL).replace(/\/$/, '')
  }

  private async key(): Promise<string> {
    const key = await this.deps.getKey()
    if (!key) throw new StudioError('API', 'Add your CallMissed API key in Settings → CallMissed first.')
    return key
  }

  /**
   * One request: logs it, maps failures to clear messages. `credits` (called with the parsed body)
   * says what a successful call cost.
   */
  private async request<T>(
    endpoint: string,
    init: RequestInit & { timeoutMs?: number; signal?: AbortSignal; auth?: boolean; model?: string | null },
    parse: (response: Response) => Promise<T>,
    cost: (result: T) => { images: number; credits: number } = () => ({ images: 0, credits: 0 })
  ): Promise<T> {
    const started = Date.now()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init.headers as Record<string, string>)
    }
    if (init.auth !== false) headers['Authorization'] = `Bearer ${await this.key()}`
    const timeout = AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    const log = (httpStatus: number | null, errorCode: string | null, used = { images: 0, credits: 0 }) =>
      this.deps.log({
        endpoint: endpoint.replace(/^\/?(api\/)?v1\//, '').replace(/\?.*$/, ''),
        model: init.model ?? null,
        httpStatus,
        errorCode,
        ...used,
        latencyMs: Date.now() - started,
        createdAt: new Date().toISOString()
      })
    let response: Response
    try {
      response = await this.deps.fetch(`${this.base}/${endpoint.replace(/^\//, '')}`, {
        ...init,
        headers,
        signal
      })
    } catch (error) {
      if (init.signal?.aborted) {
        log(null, 'cancelled')
        throw new StudioError('CANCELLED', 'Cancelled')
      }
      if (isAbort(error)) {
        log(null, 'timeout')
        throw new StudioError(
          'API',
          'CallMissed did not answer in time. The request may still finish on CallMissed; check Usage → account history before trying again.'
        )
      }
      log(null, 'network')
      throw new StudioError('API', 'Could not reach CallMissed. Check your internet connection.')
    }
    if (!response.ok) {
      const { code, message } = await apiError(response)
      log(response.status, code)
      throw new StudioError('API', message)
    }
    const result = await parse(response)
    log(response.status, null, cost(result))
    return result
  }

  /** Checks the key works (lists the models it can use). */
  async testKey(): Promise<void> {
    await this.request('/v1/models', { method: 'GET' }, async () => undefined)
  }

  /** The public image model catalogue (no key needed), for availability (e.g. maintenance). */
  async catalogue(): Promise<CatalogueModel[]> {
    return this.request('/api/v1/models?category=image', { method: 'GET', auth: false }, async (response) => {
      const body = (await response.json()) as {
        data?: { id?: unknown; status?: unknown; status_message?: unknown }[]
      }
      return (body.data ?? []).flatMap((m) =>
        typeof m.id === 'string'
          ? [
              {
                id: m.id,
                status: typeof m.status === 'string' ? m.status : null,
                statusMessage: typeof m.status_message === 'string' ? m.status_message : null
              }
            ]
          : []
      )
    })
  }

  /**
   * Image-to-image: the page as the reference plus the prompt. Never retried automatically: an
   * image request runs (and is billed) again on every attempt, even with an idempotency key.
   */
  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GeneratedImage[]> {
    return this.request(
      '/v1/images/generations',
      {
        method: 'POST',
        model: req.model,
        timeoutMs: GENERATE_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({
          model: req.model,
          prompt: req.prompt,
          n: req.n,
          size: req.size,
          response_format: 'b64_json',
          reference_images: [`data:image/png;base64,${Buffer.from(req.reference).toString('base64')}`]
        })
      },
      async (response) => {
        const body = (await response.json()) as { data?: { b64_json?: unknown; revised_prompt?: unknown }[] }
        return (body.data ?? []).flatMap((item): GeneratedImage[] => {
          if (typeof item.b64_json !== 'string') return []
          const bytes = new Uint8Array(Buffer.from(item.b64_json, 'base64'))
          return [
            {
              bytes,
              mime: bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png',
              revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : null
            }
          ]
        })
      },
      (images) => ({ images: images.length, credits: creditsFor(req.model, images.length) })
    )
  }

  /** Images made with this key (newest first); `before` is the previous page's cursor. */
  async history(
    before: string | null,
    limit = 30
  ): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) })
    return this.request(`/v1/images/history?${query.toString()}`, { method: 'GET' }, async (response) => {
      const body = (await response.json()) as { data?: Record<string, unknown>[]; next_cursor?: unknown }
      const items = (body.data ?? []).flatMap((d): HistoryItem[] =>
        typeof d['id'] === 'string' && typeof d['url'] === 'string'
          ? [
              {
                id: d['id'],
                url: d['url'],
                model: typeof d['model'] === 'string' ? d['model'] : '',
                size: typeof d['size'] === 'string' ? d['size'] : '',
                prompt: typeof d['prompt'] === 'string' ? d['prompt'] : '',
                revisedPrompt: typeof d['revised_prompt'] === 'string' ? d['revised_prompt'] : null,
                created: typeof d['created'] === 'number' ? d['created'] : 0
              }
            ]
          : []
      )
      return { items, nextCursor: typeof body.next_cursor === 'string' ? body.next_cursor : null }
    })
  }

  /** Downloads an image from a signed history link (https only, size-capped). */
  async download(url: string): Promise<{ bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' }> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new StudioError('INVALID_INPUT', 'Invalid image link')
    }
    if (parsed.protocol !== 'https:')
      throw new StudioError('INVALID_INPUT', 'Only https image links can be downloaded')
    let response: Response
    try {
      response = await this.deps.fetch(parsed, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS * 2) })
    } catch {
      throw new StudioError(
        'API',
        'Could not download the image. The link may have expired; refresh the history.'
      )
    }
    if (!response.ok)
      throw new StudioError('API', 'The image link has expired. Refresh the history and try again.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES)
      throw new StudioError('API', 'The image is too large to import.')
    const png = bytes[0] === 0x89 && bytes[1] === 0x50
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8
    if (!png && !jpeg) throw new StudioError('API', 'The link did not return a PNG or JPEG image.')
    return { bytes, mime: png ? 'image/png' : 'image/jpeg' }
  }
}
