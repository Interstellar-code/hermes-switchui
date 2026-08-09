/**
 * verify-provider.ts — did the save actually take effect?
 *
 * There is no per-provider test endpoint, so verification has two passes:
 *
 *  1. Poll `GET /api/models` until the provider appears with a real model row.
 *     Free, fast, and it distinguishes "written to config" from "the gateway
 *     can see it" — the synthetic `auto` entry means the gateway knows the
 *     provider exists but has not loaded its catalogue, which almost always
 *     means it has not been restarted.
 *  2. Send one real, minimal completion. This is the only pass that proves the
 *     *credential* resolved, and it is the reason the wizard can now stop
 *     claiming success on a write it never checked: config resolution and
 *     credential resolution fail independently, and the second failure is the
 *     common one (a `key_env` that resolves to nothing under multiplexing, a
 *     key shadowed by an inline copy, a rotated key with a stale mirror).
 *
 * Pass 2 used to be opt-in behind a button and treated any non-empty body as a
 * pass — including a body that was nothing but an SSE `error` event. It now
 * parses the stream and returns the gateway's own message, because "Save
 * failed" tells the user nothing and "401 Unauthorized from api.example.com"
 * tells them everything.
 */
import { normalizeProviderId } from '@/lib/provider-catalog'

export type VerifyOutcome = {
  status: 'confirmed' | 'pending-restart' | 'missing'
  modelCount: number
  message: string
}

type PollOptions = {
  timeoutMs?: number
  intervalMs?: number
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Injected in tests so the poll does not really sleep. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Abort when the caller goes away, so the loop cannot outlive its UI. */
  signal?: AbortSignal
}

/** Returned when the caller aborts; the UI simply stops showing progress. */
export const VERIFY_ABORTED: VerifyOutcome = {
  status: 'missing',
  modelCount: 0,
  message: 'Verification cancelled.',
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function verifyProviderVisible(
  providerId: string,
  options: PollOptions = {},
): Promise<VerifyOutcome> {
  const {
    timeoutMs = 20_000,
    intervalMs = 1_500,
    fetchImpl = fetch,
    sleep = defaultSleep,
    now = Date.now,
    signal,
  } = options

  const id = normalizeProviderId(providerId)
  const deadline = now() + timeoutMs
  let sawProvider = false

  for (;;) {
    if (signal?.aborted) return VERIFY_ABORTED
    try {
      const res = await fetchImpl('/api/models')
      if (res.ok) {
        const data = (await res.json()) as {
          models?: Array<{ id?: string; provider?: string }>
          configuredProviders?: Array<string>
        }
        const configured = (data.configuredProviders ?? []).some(
          (candidate) => normalizeProviderId(candidate) === id,
        )
        const rows = (data.models ?? []).filter(
          (model) => normalizeProviderId(model.provider ?? '') === id,
        )
        const realModels = rows.filter((model) => model.id !== 'auto')

        if (realModels.length > 0) {
          return {
            status: 'confirmed',
            modelCount: realModels.length,
            message: `The gateway lists ${realModels.length} model${
              realModels.length === 1 ? '' : 's'
            } for this provider.`,
          }
        }
        if (configured || rows.length > 0) sawProvider = true
      }
    } catch {
      // Network blips are expected while a gateway restarts.
    }

    if (now() >= deadline) break
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())))
    if (signal?.aborted) return VERIFY_ABORTED
  }

  return sawProvider
    ? {
        status: 'pending-restart',
        modelCount: 0,
        message:
          'Saved, and the gateway knows the provider — but it is reporting no models yet. Restart it to load the catalogue.',
      }
    : {
        status: 'missing',
        modelCount: 0,
        message:
          'Saved to config.yaml, but the gateway does not list this provider yet. A restart is usually all it needs.',
      }
}

export type LiveTestOutcome = {
  ok: boolean
  message: string
  /** The gateway's verbatim error, when it gave one. */
  gatewayError?: string
}

/**
 * Pull the first `error` event out of an SSE body, and note whether any
 * assistant text arrived.
 *
 * The stream is `event: <name>\ndata: <json>\n\n`. An error carries
 * `{ message }` (`routes/api/send-stream.ts:922`), and a non-2xx response is
 * plain JSON `{ ok: false, error }` instead — both shapes are handled, because
 * a credential failure can surface as either depending on how far the request
 * got before the provider rejected it.
 */
export function parseLiveTestStream(body: string): {
  error: string | null
  sawContent: boolean
} {
  let error: string | null = null
  let sawContent = false

  // Non-stream error body.
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { ok?: boolean; error?: unknown }
      if (parsed.ok === false && typeof parsed.error === 'string') {
        return { error: parsed.error, sawContent: false }
      }
    } catch {
      // Not JSON after all — fall through to the SSE scan.
    }
  }

  let currentEvent = ''
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('event:')) {
      currentEvent = line.slice('event:'.length).trim()
      continue
    }
    if (!line.startsWith('data:')) continue
    const payload = line.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue

    let data: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(payload)
      if (parsed && typeof parsed === 'object') {
        data = parsed as Record<string, unknown>
      }
    } catch {
      // A non-JSON data line is content in practice.
      if (currentEvent !== 'error') sawContent = true
      continue
    }

    if (currentEvent === 'error' || typeof data.error === 'string') {
      const message =
        (typeof data.message === 'string' && data.message) ||
        (typeof data.error === 'string' && data.error) ||
        ''
      if (message && !error) error = message
      continue
    }
    const text = data.text ?? data.delta ?? data.content
    if (typeof text === 'string' && text.length > 0) sawContent = true
  }

  return { error, sawContent }
}

/**
 * One real round trip through the chat endpoint. Aborts after `timeoutMs` so a
 * hung provider cannot wedge the wizard.
 */
export async function sendLiveTestPrompt(
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<LiveTestOutcome> {
  const { timeoutMs = 20_000, fetchImpl = fetch } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl('/api/send-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionKey: 'new',
        friendlyId: 'new',
        message: 'Reply with the single word: ok',
      }),
      signal: controller.signal,
    })
    const text = await res.text().catch(() => '')
    const { error, sawContent } = parseLiveTestStream(text)

    if (error) {
      return {
        ok: false,
        // Verbatim. A paraphrase of "invalid_api_key" helps nobody.
        message: error,
        gatewayError: error,
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        message: `Chat request failed (HTTP ${res.status})`,
      }
    }
    if (sawContent || text.trim().length > 0) {
      return { ok: true, message: 'The provider answered a live prompt.' }
    }
    return {
      ok: false,
      message: 'The provider accepted the request but sent nothing back.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === 'AbortError'
          ? 'The provider did not respond within 20 seconds.'
          : error instanceof Error
            ? error.message
            : 'Live test failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

export type PostSaveVerification = {
  resolution: VerifyOutcome
  live: LiveTestOutcome | null
  /**
   * True when the provider resolves but the credential does not — the case
   * where offering the inline fallback is the right move rather than telling
   * the user to restart the gateway again.
   */
  credentialFailed: boolean
}

/** Signals in a gateway error that mean "the credential did not resolve". */
const CREDENTIAL_ERROR_RE =
  /\b(401|403|unauthor|invalid[_ -]?api[_ -]?key|invalid[_ -]?token|no[_ -]?key|api[_ -]?key|authentication|credential|forbidden)\b/i

/**
 * The full post-write check: does the gateway see the provider, and will it
 * actually talk to it?
 *
 * Runs the live prompt unconditionally once resolution succeeds. It costs one
 * two-token completion, which is a price worth paying to never again tell a
 * user "Saved" about a provider that 401s the first time they use it.
 */
export async function verifyProviderAfterSave(
  providerId: string,
  options: PollOptions & { skipLiveTest?: boolean } = {},
): Promise<PostSaveVerification> {
  const resolution = await verifyProviderVisible(providerId, options)
  if (resolution.status !== 'confirmed' || options.skipLiveTest) {
    return { resolution, live: null, credentialFailed: false }
  }
  const live = await sendLiveTestPrompt({ fetchImpl: options.fetchImpl })
  return {
    resolution,
    live,
    credentialFailed:
      !live.ok && CREDENTIAL_ERROR_RE.test(live.gatewayError ?? live.message),
  }
}
