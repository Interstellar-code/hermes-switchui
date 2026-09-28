import {
  BEARER_TOKEN,
  CLAUDE_API,
  dashboardFetch,
  ensureGatewayProbed,
  getCapabilities,
} from '@/server/gateway-capabilities'
import { getLocalMessages, getLocalSession } from '@/server/local-session-store'
import { scopedPath } from '@/server/profile-scope'
import { getActiveProfileName, readProfile } from '@/server/profiles-browser'

export type ContextUsageSnapshot = {
  ok: true
  contextPercent: number
  maxTokens: number
  usedTokens: number
  model: string
  staticTokens: number
  conversationTokens: number
  /** False only when `usedTokens` is the gateway's own last-prompt count. */
  estimated: boolean
  /** Where `maxTokens` came from — `default` means nothing better was known. */
  maxSource: 'gateway' | 'config' | 'catalog' | 'default'
  /** `compression.threshold` (0–1) the gateway auto-compacts at, or null. */
  compressionThreshold: number | null
}

type ContextLimits = Pick<
  ContextUsageSnapshot,
  'maxTokens' | 'maxSource' | 'compressionThreshold'
>

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Window size and compaction threshold from the active profile's config.yaml:
// `providers.<p>.models.<m>.context_length`, then `providers.<p>.context_length`,
// then `model.context_length`. A routing model like `manifest/auto` has no
// catalog entry, so without this the gauge silently assumed 200k.
function readConfigLimits(model: string): {
  contextLength: number
  compressionThreshold: number | null
} {
  try {
    const cfg = readProfile(getActiveProfileName()).config as Record<
      string,
      any
    >
    const modelCfg = typeof cfg.model === 'object' && cfg.model ? cfg.model : {}
    const providerName = String(modelCfg.provider || '')
    const provider = cfg.providers?.[providerName] ?? {}
    const modelName = model || String(modelCfg.default || '')
    const contextLength =
      num(provider.models?.[modelName]?.context_length) ||
      num(provider.context_length) ||
      num(modelCfg.context_length)
    const compression = cfg.compression ?? {}
    const threshold = Number(compression.threshold)
    return {
      contextLength,
      compressionThreshold:
        compression.enabled !== false && threshold > 0 && threshold < 1
          ? threshold
          : null,
    }
  } catch {
    return { contextLength: 0, compressionThreshold: null }
  }
}

function resolveLimits(model: string, gatewayLength = 0): ContextLimits {
  const config = readConfigLimits(model)
  if (gatewayLength > 0) {
    return {
      maxTokens: gatewayLength,
      maxSource: 'gateway',
      compressionThreshold: config.compressionThreshold,
    }
  }
  if (config.contextLength > 0) {
    return {
      maxTokens: config.contextLength,
      maxSource: 'config',
      compressionThreshold: config.compressionThreshold,
    }
  }
  const catalog = getContextWindow(model)
  return {
    maxTokens: catalog,
    maxSource: catalog === DEFAULT_CONTEXT_WINDOW ? 'default' : 'catalog',
    compressionThreshold: config.compressionThreshold,
  }
}

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-haiku-3.5': 200_000,
  'gpt-5.4': 1_000_000,
  'gpt-5.2-codex': 1_000_000,
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  o1: 200_000,
  'o3-mini': 200_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'kimi-k2.6': 256_000,
}

const CHARS_PER_TOKEN = 3.5
const DEFAULT_CONTEXT_WINDOW = 200_000

function getContextWindow(model: string): number {
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model]
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (
      model.toLowerCase().includes(key.toLowerCase()) ||
      key.toLowerCase().includes(model.toLowerCase())
    )
      return value
  }
  return DEFAULT_CONTEXT_WINDOW
}

function authHeaders(): Record<string, string> {
  return BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}
}

/** Append `profile=` to a dashboard path. No-op when profile is falsy, so
 *  unscoped callers get the exact same path as before P2. */
function withProfileQuery(path: string, profile?: string | null): string {
  if (!profile) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}profile=${encodeURIComponent(profile)}`
}

function emptySnapshot(): ContextUsageSnapshot {
  return {
    ok: true,
    contextPercent: 0,
    maxTokens: 0,
    usedTokens: 0,
    model: '',
    staticTokens: 0,
    conversationTokens: 0,
    estimated: true,
    maxSource: 'default',
    compressionThreshold: null,
  }
}

export async function readContextUsage(
  sessionId = '',
  profile?: string | null,
): Promise<ContextUsageSnapshot> {
  try {
    let sessionData: Record<string, unknown> | null = null
    const explicitSessionId = sessionId.trim()
    const capabilities = await ensureGatewayProbed()

    if (explicitSessionId) {
      const localSession = getLocalSession(explicitSessionId)
      if (localSession) {
        const messages = getLocalMessages(explicitSessionId)
        const totalChars = messages.reduce(
          (sum, msg) => sum + (msg.content || '').length,
          0,
        )
        const usedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN)
        const model = localSession.model || 'gpt-5.5'
        const limits = resolveLimits(model)
        const maxTokens = limits.maxTokens
        const contextPercent =
          maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 1000) / 10 : 0
        return {
          ok: true,
          contextPercent,
          usedTokens,
          model,
          staticTokens: 0,
          conversationTokens: usedTokens,
          estimated: true,
          ...limits,
        }
      }
    }

    if (explicitSessionId) {
      try {
        const res = capabilities.dashboard.available
          ? await dashboardFetch(
              withProfileQuery(
                `/api/sessions/${encodeURIComponent(explicitSessionId)}`,
                profile,
              ),
              { signal: AbortSignal.timeout(3000) },
            )
          : await fetch(
              `${CLAUDE_API}${await scopedPath(`/api/sessions/${encodeURIComponent(explicitSessionId)}`, profile)}`,
              {
                headers: authHeaders(),
                signal: AbortSignal.timeout(3000),
              },
            )
        if (res.ok) {
          const data = (await res.json()) as {
            session?: Record<string, unknown>
          } & Record<string, unknown>
          sessionData = capabilities.dashboard.available
            ? data
            : (data.session ?? null)
        }
      } catch {
        /* ignore */
      }
    }

    // If the caller asked for a specific session and neither the local store nor
    // the gateway has it, return empty. Falling back to the latest session makes
    // new/portable chats inherit unrelated large context usage in the UI.
    if (explicitSessionId && !sessionData) return emptySnapshot()

    if (!sessionData) {
      try {
        const listRes = capabilities.dashboard.available
          ? await dashboardFetch(
              withProfileQuery('/api/sessions?limit=1', profile),
              {
                signal: AbortSignal.timeout(3000),
              },
            )
          : await fetch(
              `${CLAUDE_API}${await scopedPath('/api/sessions?limit=1', profile)}`,
              {
                headers: authHeaders(),
                signal: AbortSignal.timeout(3000),
              },
            )
        if (listRes.ok) {
          const listData = (await listRes.json()) as {
            items?: Array<Record<string, unknown>>
            sessions?: Array<Record<string, unknown>>
          }
          const sessions = capabilities.dashboard.available
            ? (listData.sessions ?? [])
            : (listData.items ?? [])
          if (sessions.length > 0) {
            sessionData = sessions[0]
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!sessionData) return emptySnapshot()

    const model = String(sessionData.model || '')
    const gatewayContextLength =
      Number(sessionData.effective_context_length) > 0
        ? Number(sessionData.effective_context_length)
        : Number(sessionData.context_length) > 0
          ? Number(sessionData.context_length)
          : 0
    const limits = resolveLimits(model, gatewayContextLength)
    const maxTokens = limits.maxTokens

    const gatewayLastPromptTokens =
      Number(sessionData.last_prompt_tokens) > 0
        ? Number(sessionData.last_prompt_tokens)
        : 0

    if (gatewayLastPromptTokens > 0) {
      const usedTokens = Math.min(gatewayLastPromptTokens, maxTokens)
      const contextPercent =
        maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 1000) / 10 : 0
      return {
        ok: true,
        contextPercent,
        usedTokens,
        model,
        staticTokens: 0,
        conversationTokens: usedTokens,
        estimated: false,
        ...limits,
      }
    }

    const cacheReadTokens = Number(sessionData.cache_read_tokens) || 0
    const messageCount = Number(sessionData.message_count) || 0

    let usedTokens = 0
    const assistantTurns = Math.max(1, Math.ceil(messageCount / 2))

    // Transcript size first. The cache-read heuristic is a last resort only:
    // cache_read_tokens is cumulative over every tool-loop call, so dividing
    // by turns overstates a live prompt several times over (a 14-message chat
    // read as 178k).
    if (messageCount > 0) {
      try {
        const targetSessionId =
          explicitSessionId || String(sessionData.id || '')
        if (targetSessionId) {
          const capabilitiesNow = getCapabilities()
          const msgRes = capabilitiesNow.dashboard.available
            ? await dashboardFetch(
                withProfileQuery(
                  `/api/sessions/${encodeURIComponent(targetSessionId)}/messages`,
                  profile,
                ),
                { signal: AbortSignal.timeout(5000) },
              )
            : await fetch(
                `${CLAUDE_API}${await scopedPath(`/api/sessions/${encodeURIComponent(targetSessionId)}/messages`, profile)}`,
                {
                  headers: authHeaders(),
                  signal: AbortSignal.timeout(5000),
                },
              )
          if (msgRes.ok) {
            const msgData = (await msgRes.json()) as {
              items?: Array<{
                content?: string
                tool_calls?: unknown
                reasoning?: string
              }>
              messages?: Array<{
                content?: string
                tool_calls?: unknown
                reasoning?: string
              }>
            }
            const messages = capabilitiesNow.dashboard.available
              ? (msgData.messages ?? [])
              : (msgData.items ?? [])
            let totalChars = 0
            for (const msg of messages) {
              totalChars += (msg.content || '').length
              if (msg.reasoning) totalChars += msg.reasoning.length
              if (msg.tool_calls)
                totalChars += JSON.stringify(msg.tool_calls).length
            }
            usedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN)
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (usedTokens === 0 && cacheReadTokens > 0) {
      usedTokens = Math.ceil((cacheReadTokens / assistantTurns) * 1.2)
    }

    usedTokens = Math.min(usedTokens, maxTokens)
    const contextPercent =
      maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 1000) / 10 : 0

    return {
      ok: true,
      contextPercent,
      usedTokens,
      model,
      staticTokens: 0,
      conversationTokens: usedTokens,
      estimated: true,
      ...limits,
    }
  } catch {
    return {
      ok: true,
      contextPercent: 0,
      maxTokens: 128_000,
      usedTokens: 0,
      model: '',
      staticTokens: 0,
      conversationTokens: 0,
      estimated: true,
      maxSource: 'default',
      compressionThreshold: null,
    }
  }
}
