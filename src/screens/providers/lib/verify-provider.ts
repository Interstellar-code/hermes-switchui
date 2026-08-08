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
 *  2. Optionally send one real prompt. This is the only true end-to-end check,
 *     but it spends tokens and can hit a live rate limit, so it stays opt-in.
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
    if (!res.ok) {
      return { ok: false, message: `Chat request failed (HTTP ${res.status})` }
    }
    const text = await res.text()
    return text.trim()
      ? { ok: true, message: 'The provider answered a live prompt.' }
      : {
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
