import {
  HERMES_SESSION_ID_HEADER,
  HERMES_SESSION_KEY_HEADER,
  resolveSessionKeyValue,
} from '../lib/send-stream-session-headers'
import { BEARER_TOKEN, CLAUDE_API } from './gateway-capabilities'
import { assertProfileResponseOk, scopedPath } from './profile-scope'

/**
 * Optional bearer token for authenticated OpenAI-compatible endpoints
 * (e.g. Codex OAuth, Hermes Agent gateway with API_SERVER_KEY set).
 *
 * Read at call time, not module-load time: under vite-node SSR the
 * top-level `process.env` snapshot can be empty when this module is
 * first evaluated, freezing a `const` to '' even though the env is
 * populated by the time requests actually run. Reading inside the
 * function avoids that.
 *
 * Resolution order matches the rest of the Hermes gateway client:
 * 1. `HERMES_API_TOKEN` env var
 * 2. `CLAUDE_API_TOKEN` env var (back-compat)
 * 3. `API_SERVER_KEY` from `~/.hermes/.env`
 *
 * Do not fall back to OPENAI_API_KEY or Codex OAuth tokens here. The local
 * Hermes gateway may be OpenAI-compatible on the wire, but its auth token is
 * the Hermes API server key. Sending unrelated OpenAI/Codex credentials causes
 * the gateway to reject otherwise-valid Switch UI chat requests with
 * `invalid_api_key`.
 */
function getBearerToken(): string {
  return BEARER_TOKEN
}

/**
 * Default model to send when the caller didn't pick one.
 *
 * This used to fall back to `GET /v1/models` and pick an entry from it. That
 * endpoint is NOT a model catalog — it returns the gateway's own advertised
 * identity (e.g. "hermes-agent", or the active profile name) plus any
 * configured `model_routes` aliases. Sending that back as an explicit
 * `model` value is a deliberate no-op per the gateway contract (the server
 * already resolves to the same thing when `model` is absent), so the fetch
 * bought nothing but latency and the risk of picking a `model_routes` alias
 * that isn't actually "the default". Omitting `model` entirely achieves the
 * identical effective result with no round trip.
 *
 * `CLAUDE_DEFAULT_MODEL` is kept as the one legitimate override: it's an
 * explicit operator setting, never inferred from the gateway's identity
 * endpoint.
 */
function getDefaultModel(): string | undefined {
  const envDefault = process.env.CLAUDE_DEFAULT_MODEL
  return envDefault && envDefault.trim() ? envDefault.trim() : undefined
}

export type OpenAICompatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenAICompatMessage = {
  role: string
  content: string | Array<OpenAICompatContentPart>
}

export type OpenAIChatOptions = {
  model?: string
  stream?: boolean
  temperature?: number
  signal?: AbortSignal
  sessionId?: string
  stableSessionKey?: string
  /** Override the base URL (e.g. for local providers). Bypasses gateway. */
  baseUrl?: string
  /** Explicitly selected profile; null/absent = unscoped (active profile).
   *  Ignored when `baseUrl` is set — that target is not the hermes gateway. */
  profile?: string | null
}

type OpenAIChatRequest = {
  // Omitted (not sent as an empty/placeholder string) when nothing was
  // explicitly selected — see getDefaultModel's doc comment.
  model?: string
  messages: Array<{
    role: string
    content: string | Array<OpenAICompatContentPart>
  }>
  stream: boolean
  temperature?: number
}

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
}

export async function buildRequestBody(
  messages: Array<OpenAICompatMessage>,
  options: OpenAIChatOptions,
): Promise<OpenAIChatRequest> {
  const model =
    options.model && options.model !== 'default'
      ? options.model
      : getDefaultModel()
  return {
    ...(model ? { model } : {}),
    messages,
    stream: options.stream === true,
    temperature: options.temperature,
  }
}

export type StreamChunkType =
  | { type: 'content' | 'reasoning'; text: string }
  | {
      type: 'tool'
      name: string
      label: string
      toolCallId?: string
      // Lifecycle phase from the upstream gateway. Vanilla Hermes Agent
      // emits 'running' at tool start and 'completed' at tool finish via
      // the `hermes.tool.progress` SSE event (#16588). Older builds that
      // sent `claude.tool.progress` did not carry status — we treat
      // missing/unknown values as a one-shot 'running' so existing flows
      // keep working.
      status?: 'running' | 'completed'
    }

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseClaudeToolProgressChunk(payload: string): StreamChunkType | null {
  try {
    const parsed = JSON.parse(payload) as unknown
    const record = readRecord(parsed)
    if (!record) return null
    const name = readString(record.tool) || readString(record.name) || 'tool'
    const emoji = readString(record.emoji)
    const labelText = readString(record.label)
    const label = [emoji, labelText].filter(Boolean).join(' ').trim()
    const toolCallId =
      readString(record.toolCallId) ||
      readString(record.tool_call_id) ||
      undefined
    const statusRaw = readString(record.status).toLowerCase()
    const status =
      statusRaw === 'running'
        ? ('running' as const)
        : statusRaw === 'completed' || statusRaw === 'complete'
          ? ('completed' as const)
          : undefined
    // Accept the chunk as long as we have either a label OR a stable
    // tool_call_id + status. Vanilla 'completed' events ship without
    // emoji/label and would otherwise be dropped, leaving cards stuck
    // in 'running'.
    if (!label && !toolCallId) return null
    return {
      type: 'tool',
      name,
      label: label || name,
      toolCallId,
      status,
    }
  } catch {
    return null
  }
}

export async function* parseOpenAIStream(
  response: Response,
): AsyncGenerator<StreamChunkType, void, void> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        let eventName = ''
        const dataLines: Array<string> = []

        for (const line of rawEvent.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.startsWith('event:')) {
            eventName = trimmed.slice(6).trim()
            continue
          }
          if (trimmed.startsWith('data:')) {
            dataLines.push(trimmed.slice(5).trim())
          }
        }

        for (const payload of dataLines) {
          if (!payload || payload === '[DONE]') continue

          if (
            eventName === 'claude.tool.progress' ||
            eventName === 'hermes.tool.progress'
          ) {
            const toolChunk = parseClaudeToolProgressChunk(payload)
            if (toolChunk) yield toolChunk
            continue
          }

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{
                delta?: {
                  content?: string | null
                  reasoning?: string | null
                  reasoning_content?: string | null
                }
              }>
            }
            const d = parsed.choices?.[0]?.delta
            const content = d?.content || ''
            const reasoning = d?.reasoning || d?.reasoning_content || ''
            // Yield content when available; fall back to reasoning only if no content yet
            if (content) yield { type: 'content' as const, text: content }
            else if (reasoning)
              yield { type: 'reasoning' as const, text: reasoning }
          } catch {
            // Ignore malformed chunks.
          }
        }

        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    // Always release the reader lock so the fetch connection is returned to
    // the pool on consumer break, abort, or exception (#72).
    await reader.cancel().catch(() => {})
  }
}

export function openaiChat(
  messages: Array<OpenAICompatMessage>,
  options: OpenAIChatOptions & { stream: true },
): Promise<AsyncGenerator<StreamChunkType, void, void>>
export function openaiChat(
  messages: Array<OpenAICompatMessage>,
  options?: OpenAIChatOptions & { stream?: false },
): Promise<string>
export async function openaiChat(
  messages: Array<OpenAICompatMessage>,
  options: OpenAIChatOptions = {},
): Promise<string | AsyncGenerator<StreamChunkType, void, void>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const bearer = getBearerToken()
  if (bearer) {
    headers['Authorization'] = `Bearer ${bearer}`
  }
  // Only send session header when authenticated — gateways without
  // API_SERVER_KEY reject this header with an auth error.
  if (options.sessionId && bearer) {
    // Gateway binds the portable run to a state.db session via this header
    // (must be X-Hermes-Session-Id, not the legacy X-Claude-Session-Id the
    // gateway ignores). The value matches the sessionKey the reload path reads
    // back via getMessages(), so portable transcripts survive reload.
    headers[HERMES_SESSION_ID_HEADER] = options.sessionId
  }
  // baseUrl targets a non-Hermes local provider (e.g. Ollama) — deliberately
  // excluded, per the "does not send Hermes session key headers to
  // local-provider base URLs" contract below.
  if (!options.baseUrl) {
    const sessionKeyValue = resolveSessionKeyValue({
      stableSessionKey: options.stableSessionKey,
      sessionId: options.sessionId,
    })
    // Omitted only when there's genuinely no session (e.g. /api/memory/chat,
    // a stateless completion with no session concept at all) — never
    // conditionally skipped for a session that sends the header elsewhere.
    if (sessionKeyValue) {
      headers[HERMES_SESSION_KEY_HEADER] = sessionKeyValue
    }
  }

  const endpoint = options.baseUrl
    ? `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`
    : `${CLAUDE_API}${await scopedPath('/v1/chat/completions', options.profile)}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(await buildRequestBody(messages, options)),
    signal: options.signal,
  })

  await assertProfileResponseOk(
    response,
    options.baseUrl ? null : options.profile,
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI-compatible chat: ${response.status} ${text}`)
  }

  if (options.stream) {
    return parseOpenAIStream(response)
  }

  const data = (await response.json()) as OpenAIChatCompletionResponse
  return data.choices?.[0]?.message?.content ?? ''
}
