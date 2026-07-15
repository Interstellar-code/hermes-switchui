import { createFileRoute } from '@tanstack/react-router'
import {
  HERMES_SESSION_KEY_HEADER,
  buildResolvedSessionHeaders,
} from '../../lib/send-stream-session-headers'
import {
  parseJsonIfPossible,
  readRecord,
  readString,
  stripDataUrlPrefix,
} from '../../lib/stream-utils'
import { resolveSessionKey } from '../../server/session-utils'
import { resolveMainSessionId } from '../../server/main-session-resolver'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { publishChatEvent } from '../../server/chat-event-bus'
import {
  registerActiveSendRun,
  unregisterActiveSendRun,
} from '../../server/send-run-tracker'
import {
  appendRunText,
  createPersistedRun,
  markRunStatus,
  setRunThinking,
  upsertRunToolCall,
} from '../../server/run-store'
import { getChatMode } from '../../server/gateway-capabilities'
import { appendLocalMessage, ensureLocalSession, getLocalMessages, touchLocalSession } from '../../server/local-session-store'
import { getDiscoveredModels, getLocalProviderDef } from '../../server/local-provider-discovery'
import {
  
  
  openaiChat
} from '../../server/openai-compat-api'
import { streamResponses } from '../../server/responses-api'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  createSession,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getMessages as getSessionMessagesFromAgent,
  listSessions,
  streamChat,
} from '../../server/hermes-api'
import { resolveOrphanedToolCards } from './-send-stream-orphan-tools'
import {
  collectSyntheticLiveToolEvents,
  createSyntheticLiveToolTracker,
} from './-send-stream-live-tools'
import type {OpenAICompatContentPart, OpenAICompatMessage} from '../../server/openai-compat-api';
import { normalizeClarifyChoices } from '@/lib/clarify-choices'
// Claude agent runs can take 5+ minutes with complex tool chains
const SEND_STREAM_RUN_TIMEOUT_MS = 600_000
const SESSION_BOOTSTRAP_KEYS = new Set(['main', 'new'])

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function normalizeAttachments(
  attachments: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined
  }

  const normalized: Array<Record<string, unknown>> = []
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') continue
    const source = attachment as Record<string, unknown>

    const id = readString(source.id)
    const name = readString(source.name) || readString(source.fileName)
    const mimeType =
      readString(source.contentType) ||
      readString(source.mimeType) ||
      readString(source.mediaType)
    const size = readNumber(source.size)

    const base64Raw =
      readString(source.content) ||
      readString(source.data) ||
      readString(source.base64) ||
      readString(source.dataUrl)
    const content = stripDataUrlPrefix(base64Raw)
    if (!content) continue

    const type =
      readString(source.type) ||
      (mimeType.toLowerCase().startsWith('image/') ? 'image' : 'file')

    const dataUrl =
      readString(source.dataUrl) ||
      (mimeType ? `data:${mimeType};base64,${content}` : '')

    normalized.push({
      id: id || undefined,
      name: name || undefined,
      fileName: name || undefined,
      type,
      contentType: mimeType || undefined,
      mimeType: mimeType || undefined,
      mediaType: mimeType || undefined,
      content,
      data: content,
      base64: content,
      dataUrl: dataUrl || undefined,
      size,
    })
  }

  return normalized.length > 0 ? normalized : undefined
}

function getChatMessage(
  message: string,
  attachments?: Array<Record<string, unknown>>,
): string {
  if (message.trim().length > 0) return message
  if (attachments && attachments.length > 0) {
    return 'Please review the attached content.'
  }
  return message
}

/**
 * Build OpenAI-compatible multimodal content for portable mode.
 * If there are image attachments, returns an array of content parts;
 * otherwise returns a plain string.
 */
function buildMultimodalContent(
  message: string,
  attachments?: Array<Record<string, unknown>>,
): string | Array<OpenAICompatContentPart> {
  const imageParts: Array<OpenAICompatContentPart> = []

  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      const mime = (att.contentType ||
        att.mimeType ||
        att.mediaType ||
        '') as string
      if (!mime.toLowerCase().startsWith('image/')) continue

      let b64 = (att.base64 || att.content || att.data || '') as string
      if (!b64) {
        const dataUrl = (att.dataUrl || '') as string
        if (dataUrl.startsWith('data:') && dataUrl.includes(',')) {
          b64 = dataUrl.split(',')[1]
        }
      }
      if (!b64) continue

      imageParts.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${b64}` },
      })
    }
  }

  if (imageParts.length === 0) {
    return getChatMessage(message, attachments)
  }

  const parts: Array<OpenAICompatContentPart> = []
  const text = message.trim() || 'Please review the attached content.'
  parts.push({ type: 'text', text })
  parts.push(...imageParts)
  return parts
}

type PortableHistoryMessage = {
  role: string
  content: string
}

function normalizePortableHistory(
  value: unknown,
): Array<PortableHistoryMessage> {
  if (!Array.isArray(value) || value.length === 0) return []

  const normalized: Array<PortableHistoryMessage> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const role = readString(record.role)
    const content = readString(record.content)
    if (!role || !content) continue
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue
    normalized.push({ role, content })
  }

  return normalized
}

function normalizeClaudeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.trim()
  if (!message) return 'Claude request failed'
  return message.replace(/\bserver\b/gi, 'Claude')
}

function getToolName(data: Record<string, unknown>): string {
  const toolCall = readRecord(data.tool_call)
  const tool = readRecord(data.tool)
  const toolFunction = readRecord(toolCall?.function)
  return (
    readString(toolCall?.tool_name) ||
    readString(toolCall?.name) ||
    readString(toolFunction?.name) ||
    readString(tool?.name) ||
    readString(data.tool_name) ||
    readString(data.name) ||
    'tool'
  )
}

function getToolCallId(
  data: Record<string, unknown>,
  runId: string | undefined,
  toolName: string,
): string {
  const toolCall = readRecord(data.tool_call)
  const tool = readRecord(data.tool)
  return (
    readString(toolCall?.id) ||
    readString(tool?.id) ||
    readString(data.tool_call_id) ||
    readString(data.call_id) ||
    readString(data.id) ||
    `${runId || 'run'}:${toolName}`
  )
}

function getToolArgs(data: Record<string, unknown>): unknown {
  const toolCall = readRecord(data.tool_call)
  const toolFunction = readRecord(toolCall?.function)
  return parseJsonIfPossible(
    toolCall?.arguments ?? toolFunction?.arguments ?? data.args,
  )
}

function getToolResultPreview(data: Record<string, unknown>): string {
  const raw = data.result_preview ?? data.result ?? data.output ?? data.message
  if (typeof raw === 'string') return raw
  if (raw === undefined || raw === null) return ''
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

export const Route = createFileRoute('/api/send-stream')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth check
        if (!isAuthenticated(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        await ensureGatewayProbed()

        // Read body manually to handle large payloads (image attachments
        // can push the JSON body above the default ~1MB parse limit).
        let body: Record<string, unknown> = {}
        try {
          const rawBody = await request.text()
          body = JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          // Fall through — body stays empty, will hit 'message required' below
        }

        const rawSessionKey =
          typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
        const headerSessionKey =
          request.headers.get(HERMES_SESSION_KEY_HEADER)?.trim() || ''
        const requestedFriendlyId =
          typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
        const message = String(body.message ?? '')
        const thinking =
          typeof body.thinking === 'string' ? body.thinking : undefined
        const attachments = normalizeAttachments(body.attachments)
        const history = normalizePortableHistory(body.history)
        if (!message.trim() && (!attachments || attachments.length === 0)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'message required' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        // Resolve session key
        let sessionKey: string
        let resolvedFriendlyId: string
        try {
          const resolved = await resolveSessionKey({
            rawSessionKey,
            friendlyId: requestedFriendlyId,
            defaultKey: 'main',
          })
          sessionKey = resolved.sessionKey
          resolvedFriendlyId = resolved.sessionKey
        } catch (err) {
          const errorMsg = normalizeClaudeErrorMessage(err)
          if (errorMsg === 'session not found') {
            return new Response(
              JSON.stringify({ ok: false, error: 'session not found' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }
          return new Response(JSON.stringify({ ok: false, error: errorMsg }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Check if the selected model is a local provider model — force portable + direct routing
        let chatMode = getChatMode()
        let localBaseUrl: string | undefined
        const requestModel = typeof body.model === 'string' ? body.model : ''
        const bareModel = requestModel.includes('/') ? requestModel.split('/').slice(1).join('/') : requestModel
        if (requestModel) {
          const discoveredModels = getDiscoveredModels()
          const localMatch = discoveredModels.find((m) => m.id === requestModel || m.id === bareModel)
          if (localMatch) {
            const providerDef = getLocalProviderDef(localMatch.provider)
            if (providerDef) {
              chatMode = 'portable'
              localBaseUrl = providerDef.baseUrl
            }
          }
        }
        if (chatMode === 'portable' && sessionKey === 'new') {
          sessionKey = crypto.randomUUID()
          resolvedFriendlyId = sessionKey
        }
        let stableSessionKey =
          headerSessionKey ||
          requestedFriendlyId ||
          rawSessionKey ||
          resolvedFriendlyId ||
          sessionKey
        if (stableSessionKey === 'new') {
          stableSessionKey = sessionKey
        }

        // Create streaming response using the SHARED server connection
        const encoder = new TextEncoder()
        let streamClosed = false
        let activeRunId: string | null = null
        let activeRunSessionKey: string | null = null
        let persistedRunReady: Promise<unknown> | null = null
        let unregisterTimer: ReturnType<typeof setTimeout> | null = null
        let streamTimeoutTimer: ReturnType<typeof setTimeout> | null = null
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null
        const abortController = new AbortController()
        let closeStream = () => {
          streamClosed = true
        }

        const stream = new ReadableStream({
          async start(controller) {
            let lastClientEventAt = Date.now()
            const enqueueRaw = (payload: string) => {
              if (streamClosed) return
              controller.enqueue(encoder.encode(payload))
            }
            const sendEvent = (event: string, data: unknown) => {
              if (streamClosed) return
              lastClientEventAt = Date.now()
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              enqueueRaw(payload)
            }

            // Cloudflare Tunnel/Access can otherwise leave small SSE streams idle
            // long enough that the browser-side fetch is canceled before visible
            // assistant chunks arrive. Send an initial padding comment and a
            // lightweight recognized event periodically so public Workspace chats
            // do not sit at "Thinking…" until the frontend reports failure.
            enqueueRaw(`: ${' '.repeat(2048)}\n\n`)
            heartbeatTimer = setInterval(() => {
              if (streamClosed) return
              if (Date.now() - lastClientEventAt < 10_000) return
              // Heartbeat to keep Cloudflare/Access from culling the SSE stream.
              // Use a dedicated hb_signal event (not 'thinking') so it does not
              // pollute the TUI activity card with fake thinking text. Send a
              // tiny SSE comment as the actual keepalive byte.
              sendEvent('hb_signal', { sessionKey })
              enqueueRaw(': keepalive\n\n')
            }, 10_000)

            closeStream = () => {
              if (streamClosed) return
              streamClosed = true
              if (heartbeatTimer) {
                clearInterval(heartbeatTimer)
                heartbeatTimer = null
              }
              if (unregisterTimer) {
                clearTimeout(unregisterTimer)
                unregisterTimer = null
              }
              if (streamTimeoutTimer) {
                clearTimeout(streamTimeoutTimer)
                streamTimeoutTimer = null
              }
              if (activeRunId) {
                unregisterActiveSendRun(activeRunId)
                activeRunId = null
              }
              abortController.abort()
              try {
                controller.close()
              } catch {
                // ignore
              }
            }

            // Keep the SSE stream alive during long agent processing (tool calls,
            // slow LLM responses on large contexts). Without this the client-side
            // no-activity timer fires after 2-3 min and aborts the stream.
            heartbeatTimer = setInterval(() => {
              sendEvent('heartbeat', { timestamp: Date.now() })
            }, 30_000)

            const persistRunStarted = (
              runId: string | undefined,
              runSessionKey: string,
              friendlyId: string,
            ) => {
              if (!runId || persistedRunReady) return
              activeRunSessionKey = runSessionKey
              persistedRunReady = createPersistedRun({
                runId,
                sessionKey: runSessionKey,
                friendlyId,
              }).catch(() => null)
            }

            const persistActiveRun = (
              write: (sessionKey: string, runId: string) => Promise<unknown>,
            ) => {
              if (!activeRunId || !activeRunSessionKey) return
              const runId = activeRunId
              const runSessionKey = activeRunSessionKey
              void (persistedRunReady ?? Promise.resolve())
                .then(() => write(runSessionKey, runId))
                .catch(() => null)
            }

            try {
              if (chatMode === 'portable') {
                const runId = crypto.randomUUID()
                const portableSessionKey = sessionKey

                // Ensure session exists (user message appended after building history)
                ensureLocalSession(portableSessionKey, typeof body.model === 'string' ? body.model : undefined)
                const portableFriendlyId =
                  resolvedFriendlyId ||
                  requestedFriendlyId ||
                  rawSessionKey ||
                  portableSessionKey
                let accumulated = ''

                activeRunId = runId
                registerActiveSendRun(runId)
                persistRunStarted(runId, portableSessionKey, portableFriendlyId)
                unregisterTimer = setTimeout(() => {
                  if (activeRunId) {
                    unregisterActiveSendRun(activeRunId)
                    activeRunId = null
                  }
                }, SEND_STREAM_RUN_TIMEOUT_MS)

                sendEvent('started', {
                  runId,
                  sessionKey: portableSessionKey,
                  friendlyId: portableFriendlyId,
                })

                try {
                  const userContent = buildMultimodalContent(
                    message,
                    attachments,
                  )
                  // Inject locale preference so the agent responds in the user's language
                  const locale = typeof body.locale === 'string' ? body.locale.trim() : ''
                  const localeSystemMsg: Array<OpenAICompatMessage> = locale && locale !== 'en'
                    ? [{ role: 'system', content: `Respond in ${locale === 'es' ? 'Spanish' : locale === 'fr' ? 'French' : locale === 'zh' ? 'Chinese' : locale === 'de' ? 'German' : locale === 'ja' ? 'Japanese' : locale === 'ko' ? 'Korean' : locale === 'pt' ? 'Portuguese' : locale === 'ru' ? 'Russian' : locale === 'ar' ? 'Arabic' : 'English'}. The user's interface is set to this language.` }]
                    : []
                  // Load persisted history for this session, then append user message
                  const persistedMessages = getLocalMessages(portableSessionKey)
                  const persistedHistory = persistedMessages.map(m => ({
                    role: m.role as 'user' | 'assistant' | 'system',
                    content: m.content,
                  }))
                  // Persist user message AFTER reading history to avoid duplication
                  appendLocalMessage(portableSessionKey, {
                    id: crypto.randomUUID(),
                    role: 'user',
                    content: typeof body.message === 'string' ? body.message : '',
                    timestamp: Date.now(),
                  })
                  // Use persisted history if available, otherwise fall back to client-sent history
                  const effectiveHistory = persistedHistory.length > 0 ? persistedHistory : history
                  const portableMessages: Array<OpenAICompatMessage> = [
                    ...localeSystemMsg,
                    ...effectiveHistory,
                    {
                      role: 'user',
                      content: userContent,
                    },
                  ]
                  // Vanilla Hermes Agent (>=v0.12.x) ships a structured
                  // Responses-API streaming surface at POST /v1/responses
                  // that carries full tool args + results, unlike the
                  // /v1/chat/completions surface which only emits a thin
                  // hermes.tool.progress lifecycle event. When the user
                  // opts into the Responses path AND we're talking to the
                  // local Hermes gateway (no localBaseUrl override), use
                  // it so the TUI tool card can render INPUT JSON and
                  // tool output text live during the run. Falls back
                  // automatically on any error to the existing
                  // openaiChat path.
                  const useResponsesApi =
                    process.env.HERMES_USE_RESPONSES === '1' && !localBaseUrl
                  if (useResponsesApi) {
                    const responseThinking = ''
                    // Track tool calls by callId so a `tool.completed`
                    // followed by `tool.output` can carry the full
                    // arguments forward without losing them.
                    const toolStateByCallId = new Map<
                      string,
                      {
                        name: string
                        args: Record<string, unknown> | string | null
                      }
                    >()
                    // Track callIds that have received `tool.completed` but
                    // not yet `tool.output`. On stream end we sweep any
                    // remaining IDs to 'complete' so no spinner is orphaned.
                    const awaitingOutput = new Set<string>()
                    try {
                      const responsesStream = streamResponses({
                        input: typeof message === 'string' ? message : '',
                        conversationHistory: effectiveHistory,
                        model:
                          typeof body.model === 'string' ? body.model : undefined,
                        sessionId: portableSessionKey,
                        stableSessionKey,
                        signal: abortController.signal,
                      })
                      for await (const ev of responsesStream) {
                        if (ev.kind === 'text.delta') {
                          accumulated += ev.delta
                          persistActiveRun((runSessionKey, activeId) =>
                            appendRunText(
                              runSessionKey,
                              activeId,
                              accumulated,
                              { replace: true },
                            ),
                          )
                          sendEvent('chunk', {
                            text: accumulated,
                            fullReplace: true,
                            sessionKey: portableSessionKey,
                            runId,
                          })
                          continue
                        }
                        if (ev.kind === 'tool.started') {
                          toolStateByCallId.set(ev.callId, {
                            name: ev.name,
                            args: ev.args,
                          })
                          const argsForCard =
                            ev.args && typeof ev.args === 'object'
                              ? (ev.args)
                              : undefined
                          persistActiveRun((runSessionKey, activeId) =>
                            upsertRunToolCall(runSessionKey, activeId, {
                              id: ev.callId,
                              name: ev.name,
                              phase: 'calling',
                              args: argsForCard,
                            }),
                          )
                          sendEvent('tool', {
                            phase: 'calling',
                            name: ev.name,
                            toolCallId: ev.callId,
                            args: argsForCard,
                            sessionKey: portableSessionKey,
                            runId,
                          })
                          continue
                        }
                        if (ev.kind === 'tool.completed') {
                          // Mark as complete but keep the args+result we
                          // accumulated so the card stays expandable.
                          // Vanilla emits tool.completed BEFORE the
                          // matching function_call_output, so we
                          // intentionally do not flip phase to 'complete'
                          // until the output arrives. Otherwise the card
                          // briefly flashes "done" with no result text.
                          // Track this callId so the stream-end sweep can
                          // resolve it if tool.output never arrives.
                          awaitingOutput.add(ev.callId)
                          continue
                        }
                        if (ev.kind === 'tool.output') {
                          const state = toolStateByCallId.get(ev.callId)
                          const argsForCard =
                            state?.args && typeof state.args === 'object'
                              ? (state.args)
                              : undefined
                          const name = state?.name || 'tool'
                          // Happy path: output arrived — no sweep needed.
                          awaitingOutput.delete(ev.callId)
                          persistActiveRun((runSessionKey, activeId) =>
                            upsertRunToolCall(runSessionKey, activeId, {
                              id: ev.callId,
                              name,
                              phase: 'complete',
                              args: argsForCard,
                              result: ev.output,
                            }),
                          )
                          sendEvent('tool', {
                            phase: 'complete',
                            name,
                            toolCallId: ev.callId,
                            args: argsForCard,
                            result: ev.output,
                            sessionKey: portableSessionKey,
                            runId,
                          })
                          continue
                        }
                        if (ev.kind === 'completed') {
                          // Final terminal event — fall through to the
                          // shared 'done' emit below.
                          break
                        }
                        throw new Error(ev.error)
                      }
                      // Stream-end sweep: resolve any tool cards that
                      // received tool.completed but never got tool.output.
                      // Happy path: awaitingOutput is empty (no-op).
                      for (const orphanEvent of resolveOrphanedToolCards({
                        awaitingOutput,
                        toolStateByCallId,
                        sessionKey: portableSessionKey,
                        runId,
                      })) {
                        persistActiveRun((runSessionKey, activeId) =>
                          upsertRunToolCall(runSessionKey, activeId, {
                            id: orphanEvent.toolCallId,
                            name: orphanEvent.name,
                            phase: 'complete',
                            args: orphanEvent.args,
                            result: undefined,
                          }),
                        )
                        sendEvent('tool', orphanEvent)
                      }
                      awaitingOutput.clear()
                      appendLocalMessage(portableSessionKey, {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: accumulated,
                        timestamp: Date.now(),
                      })
                      touchLocalSession(portableSessionKey)
                      persistActiveRun((runSessionKey, activeId) =>
                        markRunStatus(runSessionKey, activeId, 'complete'),
                      )
                      sendEvent('done', {
                        state: 'complete',
                        sessionKey: portableSessionKey,
                        runId,
                        message: {
                          role: 'assistant',
                          content: [
                            ...(responseThinking.length > 0
                              ? [{ type: 'thinking', thinking: responseThinking }]
                              : []),
                            { type: 'text', text: accumulated },
                          ],
                        },
                      })
                      closeStream()
                      return
                    } catch (err) {
                      // Log and fall through to the openaiChat path so a
                      // misconfigured /v1/responses surface (older agent,
                      // CORS issue, network blip) doesn't break the chat.
                      console.warn(
                        '[send-stream] /v1/responses path failed, falling back to /v1/chat/completions:',
                        err,
                      )
                      // Reset accumulated so the fallback starts clean.
                      accumulated = ''
                    }
                  }

                  const chatStream = await openaiChat(portableMessages, {
                    model: localBaseUrl ? bareModel : (typeof body.model === 'string' ? body.model : undefined),
                    temperature:
                      typeof body.temperature === 'number'
                        ? body.temperature
                        : undefined,
                    signal: abortController.signal,
                    stream: true,
                    sessionId: portableSessionKey,
                    stableSessionKey,
                    baseUrl: localBaseUrl,
                  })

                  let chatThinking = ''
                  let toolEventCount = 0
                  for await (const chunk of chatStream) {
                    if (chunk.type === 'reasoning') {
                      chatThinking += chunk.text
                      persistActiveRun((runSessionKey, activeId) =>
                        setRunThinking(runSessionKey, activeId, chatThinking),
                      )
                      sendEvent('thinking', {
                        text: thinking,
                        sessionKey: portableSessionKey,
                        runId,
                      })
                    } else if (chunk.type === 'tool') {
                      // Prefer the gateway's stable tool_call_id so 'running'
                      // and 'completed' events for the same call collapse to
                      // one card row. Fall back to a synthetic id only when
                      // the upstream payload lacks one (older Hermes builds).
                      toolEventCount += 1
                      const toolCallId =
                        chunk.toolCallId ||
                        `${runId}:${chunk.name}:${toolEventCount}`
                      // Map upstream status -> internal phase. 'running'
                      // arrives at tool start; 'completed' at finish.
                      // Missing status (back-compat path) is treated as a
                      // one-shot 'calling' to mirror the previous behavior.
                      const phase =
                        chunk.status === 'completed'
                          ? 'complete'
                          : chunk.status === 'running'
                            ? 'calling'
                            : 'start'
                      persistActiveRun((runSessionKey, activeId) =>
                        upsertRunToolCall(runSessionKey, activeId, {
                          id: toolCallId,
                          name: chunk.name || 'tool',
                          phase,
                          preview: chunk.label,
                        }),
                      )
                      sendEvent('tool', {
                        phase,
                        name: chunk.name,
                        toolCallId,
                        preview: chunk.label,
                        sessionKey: portableSessionKey,
                        runId,
                      })
                    } else {
                      accumulated += chunk.text
                      persistActiveRun((runSessionKey, activeId) =>
                        appendRunText(runSessionKey, activeId, accumulated, {
                          replace: true,
                        }),
                      )
                      sendEvent('chunk', {
                        text: accumulated,
                        fullReplace: true,
                        sessionKey: portableSessionKey,
                        runId,
                      })
                    }
                  }

                  // Persist assistant response to local session store
                  appendLocalMessage(portableSessionKey, {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: accumulated,
                    timestamp: Date.now(),
                  })
                  touchLocalSession(portableSessionKey)

                  persistActiveRun((runSessionKey, activeId) =>
                    markRunStatus(runSessionKey, activeId, 'complete'),
                  )
                  sendEvent('done', {
                    state: 'complete',
                    sessionKey: portableSessionKey,
                    runId,
                    message: {
                      role: 'assistant',
                      content: [
                        ...(thinking ? [{ type: 'thinking', thinking }] : []),
                        { type: 'text', text: accumulated },
                      ],
                    },
                  })
                  closeStream()
                } catch (err) {
                  if (!streamClosed) {
                    // Persist any partial text accumulated before the error so a
                    // long response that fails near the end is not silently lost
                    // from the local session store. Mirrors the success-path
                    // append above. See #128.
                    if (accumulated) {
                      appendLocalMessage(portableSessionKey, {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: accumulated,
                        timestamp: Date.now(),
                      })
                      touchLocalSession(portableSessionKey)
                    }
                    const errorMessage = normalizeClaudeErrorMessage(err)
                    persistActiveRun((runSessionKey, activeId) =>
                      markRunStatus(runSessionKey, activeId, 'error', errorMessage),
                    )
                    sendEvent('error', {
                      message: errorMessage,
                      sessionKey: portableSessionKey,
                      runId,
                    })
                    closeStream()
                  }
                }
                return
              }

              if (!getGatewayCapabilities().sessions) {
                throw new Error(SESSIONS_API_UNAVAILABLE_MESSAGE)
              }

              if (SESSION_BOOTSTRAP_KEYS.has(sessionKey)) {
                // 'main' should land in the user's existing main chat,
                // not spin up a brand new session every time. Skip cron
                // and Operations per-agent sessions so the orchestrator
                // chat doesn't latch onto them.
                let reused: string | null = null
                if (sessionKey === 'main') {
                  try {
                    reused = await resolveMainSessionId({ listSessions })
                  } catch {
                    // fall through to createSession()
                  }
                }
                if (reused) {
                  sessionKey = reused
                  resolvedFriendlyId = reused
                } else {
                  const session = await createSession()
                  sessionKey = session.id
                  resolvedFriendlyId = session.id
                }
                if (stableSessionKey === 'new') {
                  stableSessionKey = sessionKey
                }
              }

              let startedSent = false
              // In enhanced mode, the HTTP stream response delivers all events
              // directly to useStreamingMessage. Skip publishChatEvent to prevent
              // useRealtimeChatHistory from creating duplicate message bubbles.
              const skipPublish = true

              // Mid-run tool polling: vanilla Hermes Agent currently does not
              // emit tool.* SSE events live (callback signature drift). Until
              // upstream fixes that, we synthesize live tool events by polling
              // the agent's session messages every ~1.5s during the run and
              // emitting any new tool calls as event: tool with phase complete
              // as soon as their tool_result message lands. The Workspace
              // chat-store dedupes by tool_call_id so this is safe alongside
              // any real live events that might arrive.
              const syntheticLiveToolTracker = createSyntheticLiveToolTracker()
              let liveRunActive = true
              // Each tick refetches the ENTIRE session transcript (the gateway
              // exposes no since/offset param yet — #216). Widened from 800ms
              // to 1500ms to roughly halve that full-history fetch volume
              // during a run; the streamClosed guard below also short-circuits
              // the loop the moment the stream ends.
              const livePollIntervalMs = 1500
              // Snapshot the session message count at run-start so the poller
              // and the post-run backfill only consider messages persisted by
              // THIS run. Without this, "the most recent assistant with
              // tool_calls" can resolve to the previous turn, surfacing stale
              // tool cards (off-by-one-turn bug).
              let liveBaselineCount = 0
              const LIVE_POLL_MAX_CONSECUTIVE_FAILURES = 5
              const livePollerPromise = (async () => {
                // Snapshot the baseline message count INSIDE the poller rather
                // than awaiting it before streamChat(). The old pre-await added
                // a full gateway round-trip to first-token latency on every
                // send. The fetch still runs first (before the 600ms delay) so
                // the baseline is captured at run-start and the off-by-one
                // tool-card guard still holds.
                try {
                  const baseline = (await getSessionMessagesFromAgent(
                    sessionKey,
                  )) as unknown as Array<Record<string, unknown>>
                  if (Array.isArray(baseline))
                    liveBaselineCount = baseline.length
                } catch {
                  liveBaselineCount = 0
                }
                // Initial small delay so the agent has time to ingest the
                // user message before we start asking for session state.
                await new Promise((r) => setTimeout(r, 600))
                let livePollConsecutiveFailures = 0
                const shouldStopLivePoll = () => !liveRunActive || streamClosed
                for (;;) {
                  if (shouldStopLivePoll()) break
                  try {
                    const allMsgs = (await getSessionMessagesFromAgent(
                      sessionKey,
                    )) as unknown as Array<Record<string, unknown>>
                    livePollConsecutiveFailures = 0
                    if (!Array.isArray(allMsgs) || allMsgs.length === 0) {
                      await new Promise((r) =>
                        setTimeout(r, livePollIntervalMs),
                      )
                      continue
                    }
                    // Only inspect messages added on or after this run started.
                    const msgs = allMsgs.slice(liveBaselineCount)
                    if (msgs.length === 0) {
                      await new Promise((r) =>
                        setTimeout(r, livePollIntervalMs),
                      )
                      continue
                    }
                    const syntheticEvents = collectSyntheticLiveToolEvents({
                      messages: msgs,
                      tracker: syntheticLiveToolTracker,
                      sessionKey,
                      runId: activeRunId ?? undefined,
                    })
                    if (syntheticEvents.length === 0) {
                      await new Promise((r) =>
                        setTimeout(r, livePollIntervalMs),
                      )
                      continue
                    }
                    for (const synthetic of syntheticEvents) {
                      sendEvent('tool', synthetic)
                    }
                  } catch {
                    // Best-effort polling; tolerate transient errors but stop
                    // after too many consecutive failures to avoid silent loops.
                    livePollConsecutiveFailures++
                    if (
                      livePollConsecutiveFailures >=
                      LIVE_POLL_MAX_CONSECUTIVE_FAILURES
                    ) {
                      console.warn(
                        `[send-stream] live tool poller: ${livePollConsecutiveFailures} consecutive failures for session ${sessionKey}; stopping poller`,
                      )
                      break
                    }
                  }
                  await new Promise((r) =>
                    setTimeout(r, livePollIntervalMs),
                  )
                }
              })()

              try {
                await streamChat(
                sessionKey,
                {
                  message: getChatMessage(message, attachments),
                  model:
                    typeof body.model === 'string' ? body.model : undefined,
                  system_message: thinking,
                  attachments: attachments || undefined,
                },
                {
                  signal: abortController.signal,
                  stableSessionKey,
                  async onEvent({ event, data }) {
                    const sessionKeyFromEvent =
                      typeof data.session_id === 'string' &&
                      data.session_id.trim()
                        ? data.session_id
                        : sessionKey
                    const runId =
                      typeof data.run_id === 'string' && data.run_id.trim()
                        ? data.run_id
                        : (activeRunId ?? undefined)

                    if (runId && !activeRunId) {
                      activeRunId = runId
                      registerActiveSendRun(runId)
                      persistRunStarted(
                        runId,
                        sessionKeyFromEvent,
                        sessionKeyFromEvent,
                      )
                      unregisterTimer = setTimeout(() => {
                        if (activeRunId) {
                          unregisterActiveSendRun(activeRunId)
                          activeRunId = null
                        }
                      }, SEND_STREAM_RUN_TIMEOUT_MS)
                    }

                    if (!startedSent && runId) {
                      startedSent = true
                      sendEvent('started', {
                        runId,
                        sessionKey: sessionKeyFromEvent,
                        friendlyId: sessionKeyFromEvent,
                      })
                    }

                    if (event === 'run.started') {
                      const userMessage =
                        data.user_message &&
                        typeof data.user_message === 'object'
                          ? (data.user_message as Record<string, unknown>)
                          : null
                      if (userMessage) {
                        void userMessage
                      }
                      return
                    }

                    if (event === 'message.started') {
                      const eventMessage =
                        data.message && typeof data.message === 'object'
                          ? (data.message as Record<string, unknown>)
                          : {}
                      const translated = {
                        message: {
                          id: eventMessage.id,
                          role: 'assistant',
                          content: [],
                        },
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('message', translated)
                      return
                    }

                    if (event === 'assistant.completed') {
                      // Send full content as a chunk — covers cases where
                      // deltas were missed or response was too short for streaming
                      const content =
                        typeof data.content === 'string' ? data.content : ''
                      if (content) {
                        persistActiveRun((runSessionKey, activeId) =>
                          appendRunText(runSessionKey, activeId, content, {
                            replace: true,
                          }),
                        )
                        const translated = {
                          text: content,
                          fullReplace: true,
                          sessionKey: sessionKeyFromEvent,
                          runId,
                        }
                        sendEvent('chunk', translated)
                      }
                      return
                    }

                    if (event === 'assistant.delta') {
                      const delta =
                        typeof data.delta === 'string' ? data.delta : ''
                      if (!delta) return
                      persistActiveRun((runSessionKey, activeId) =>
                        appendRunText(runSessionKey, activeId, delta),
                      )
                      const translated = {
                        text: delta,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('chunk', translated)
                      return
                    }

                    if (event.startsWith('subagent.')) {
                      const subagentId = readString(data.subagent_id)
                      if (!subagentId) return
                      const kind = event.slice('subagent.'.length)
                      const inputTokens = Number(data.input_tokens) || 0
                      const outputTokens = Number(data.output_tokens) || 0
                      const reasoningTokens = Number(data.reasoning_tokens) || 0
                      sendEvent('delegation', {
                        kind,
                        subagentId,
                        parentId: readString(data.parent_id) || undefined,
                        childSessionId: readString(data.child_session_id) || undefined,
                        depth: Number.isFinite(Number(data.depth)) ? Number(data.depth) : undefined,
                        goal: readString(data.goal) || undefined,
                        model: readString(data.model) || undefined,
                        status: readString(data.status) || (kind === 'complete' ? 'completed' : 'running'),
                        toolName: readString(data.tool_name) || undefined,
                        text: readString(data.text) || readString(data.tool_preview) || undefined,
                        summary: readString(data.summary) || readString(data.output_tail) || undefined,
                        toolCount: Number.isFinite(Number(data.tool_count)) ? Number(data.tool_count) : undefined,
                        tokenCount: inputTokens + outputTokens + reasoningTokens || undefined,
                        durationMs: Number.isFinite(Number(data.duration_seconds)) ? Number(data.duration_seconds) * 1000 : undefined,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      })
                      return
                    }

                    if (
                      event === 'tool.pending' ||
                      event === 'tool.started' ||
                      event === 'tool.calling' ||
                      event === 'tool.running'
                    ) {
                      const toolName = getToolName(data)
                      const preview =
                        typeof data.preview === 'string'
                          ? data.preview
                          : undefined
                      const translated = {
                        phase:
                          event === 'tool.pending' || event === 'tool.started'
                            ? 'start'
                            : 'calling',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        args: getToolArgs(data),
                        preview,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      persistActiveRun((runSessionKey, activeId) =>
                        upsertRunToolCall(runSessionKey, activeId, {
                          id: translated.toolCallId,
                          name: toolName,
                          phase: translated.phase,
                          args: translated.args,
                          preview,
                        }),
                      )
                      sendEvent('tool', translated)
                      return
                    }

                    if (event === 'tool.progress') {
                      const delta = readString(data.delta)
                      const toolName = getToolName(data)
                      if (toolName === '_thinking' || toolName === 'tool') {
                        if (!delta) return
                        persistActiveRun((runSessionKey, activeId) =>
                          setRunThinking(runSessionKey, activeId, delta),
                        )
                        const translated = {
                          text: delta,
                          sessionKey: sessionKeyFromEvent,
                          runId,
                        }
                        sendEvent('thinking', translated)
                        return
                      }
                      const translated = {
                        phase: 'calling',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        args: getToolArgs(data),
                        result: delta || undefined,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      persistActiveRun((runSessionKey, activeId) =>
                        upsertRunToolCall(runSessionKey, activeId, {
                          id: translated.toolCallId,
                          name: toolName,
                          phase: 'calling',
                          args: translated.args,
                          result: translated.result,
                        }),
                      )
                      sendEvent('tool', translated)
                      return
                    }

                    if (event === 'tool.completed') {
                      const toolName = getToolName(data)
                      const resultPreview = getToolResultPreview(data)
                      const translated = {
                        phase: 'complete',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        args: getToolArgs(data),
                        result: resultPreview.slice(0, 4000),
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      persistActiveRun((runSessionKey, activeId) =>
                        upsertRunToolCall(runSessionKey, activeId, {
                          id: translated.toolCallId,
                          name: toolName,
                          phase: 'complete',
                          args: translated.args,
                          result: translated.result,
                        }),
                      )
                      sendEvent('tool', translated)
                      return
                    }

                    if (event === 'artifact.created') {
                      const artifact =
                        data.artifact && typeof data.artifact === 'object'
                          ? (data.artifact as Record<string, unknown>)
                          : {}
                      const translated = {
                        name: readString(data.tool_name) || 'artifact',
                        title:
                          readString(artifact.title) ||
                          readString(data.title) ||
                          'Artifact created',
                        kind:
                          readString(artifact.kind) ||
                          readString(data.kind) ||
                          'artifact',
                        path:
                          readString(artifact.path) || readString(data.path) || '',
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('artifact', translated)
                      return
                    }

                    if (event === 'memory.updated') {
                      const translated = {
                        phase: 'complete',
                        name: 'memory',
                        toolCallId: readString(data.tool_call_id) || undefined,
                        result:
                          readString(data.message) ||
                          `Updated ${readString(data.target) || 'memory'}`,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      persistActiveRun((runSessionKey, activeId) =>
                        upsertRunToolCall(runSessionKey, activeId, {
                          id: translated.toolCallId || `${runId || 'run'}:memory`,
                          name: 'memory',
                          phase: 'complete',
                          result: translated.result,
                        }),
                      )
                      sendEvent('tool', translated)
                      return
                    }

                    if (event === 'skill.loaded') {
                      const skill =
                        data.skill && typeof data.skill === 'object'
                          ? (data.skill as Record<string, unknown>)
                          : {}
                      const translated = {
                        phase: 'complete',
                        name: 'skill',
                        toolCallId: readString(data.tool_call_id) || undefined,
                        result:
                          readString(skill.name) ||
                          readString(data.skill_name) ||
                          'Skill loaded',
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      persistActiveRun((runSessionKey, activeId) =>
                        upsertRunToolCall(runSessionKey, activeId, {
                          id: translated.toolCallId || `${runId || 'run'}:skill`,
                          name: 'skill',
                          phase: 'complete',
                          result: translated.result,
                        }),
                      )
                      sendEvent('tool', translated)
                      return
                    }

                    if (event === 'tool.failed') {
                      const errorMessage =
                        readString(
                          (data.error as Record<string, unknown> | undefined)
                            ?.message,
                        ) || readString(data.message)
                      const toolName = getToolName(data)
                      const translated = {
                        phase: 'error',
                        name: toolName,
                        toolCallId: getToolCallId(data, runId, toolName),
                        result: errorMessage,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      persistActiveRun((runSessionKey, activeId) =>
                        upsertRunToolCall(runSessionKey, activeId, {
                          id: translated.toolCallId,
                          name: toolName,
                          phase: 'error',
                          result: translated.result,
                        }),
                      )
                      sendEvent('tool', translated)
                      return
                    }

                    if (event === 'clarify.request' || event === 'interaction.request') {
                      const d = data
                      const clarifyPayload = {
                        type: event === 'interaction.request' ? ('interaction' as const) : ('clarify' as const),
                        clarifyId:
                          readString(d.clarify_id) ||
                          readString(d.interaction_id) ||
                          '',
                        interactionId:
                          readString(d.interaction_id) ||
                          readString(d.clarify_id) ||
                          undefined,
                        kind: readString(d.kind) || undefined,
                        toolName: readString(d.tool_name) || undefined,
                        messageId: readString(d.message_id) || undefined,
                        question: readString(d.question) || '',
                        choices: normalizeClarifyChoices(d.choices),
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('clarify', clarifyPayload)
                      return
                    }

                    if (event === 'clarify.responded' || event === 'interaction.responded') {
                      const d = data
                      const resolvedPayload = {
                        type: event === 'interaction.responded' ? ('interaction_resolved' as const) : ('clarify_resolved' as const),
                        clarifyId:
                          readString(d.clarify_id) ||
                          readString(d.interaction_id) ||
                          '',
                        interactionId:
                          readString(d.interaction_id) ||
                          readString(d.clarify_id) ||
                          undefined,
                        kind: readString(d.kind) || undefined,
                        toolName: readString(d.tool_name) || undefined,
                        answer: readString(d.answer) || undefined,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      sendEvent('clarify_resolved', resolvedPayload)
                      return
                    }

                    if (event === 'error') {
                      const errorMessage =
                        readString(
                          (data.error as Record<string, unknown> | undefined)
                            ?.message,
                        ) ||
                        readString(data.message) ||
                        'Hermes stream error'
                      persistActiveRun((runSessionKey, activeId) =>
                        markRunStatus(
                          runSessionKey,
                          activeId,
                          'error',
                          errorMessage,
                        ),
                      )
                      sendEvent('error', {
                        message: errorMessage,
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      })
                      closeStream()
                      return
                    }

                    if (event === 'usage.update') {
                      const contextPercent =
                        typeof data.context_percent === 'number'
                          ? data.context_percent
                          : undefined
                      if (contextPercent !== undefined) {
                        const usagePayload = {
                          contextPercent,
                          compacted: data.compacted === true,
                          messagesBefore:
                            typeof data.messages_before === 'number'
                              ? data.messages_before
                              : undefined,
                          messagesAfter:
                            typeof data.messages_after === 'number'
                              ? data.messages_after
                              : undefined,
                          sessionKey: sessionKeyFromEvent,
                          runId,
                        }
                        sendEvent('usage_update', usagePayload)
                      }
                      return
                    }

                    if (event === 'run.completed') {
                      // Backfill tool calls from session history.
                      // Hermes Agent currently does not stream tool.* events
                      // reliably, but it persists tool calls on the assistant
                      // message. Fetch the latest assistant message and emit
                      // synthetic 'tool' events for each tool call so the
                      // Workspace UI can render the Activity card.
                      try {
                        const sid =
                          readString(data.session_id) ||
                          sessionKeyFromEvent ||
                          ''
                        if (sid) {
                          let persistedMessages: Array<
                            Record<string, unknown>
                          > = []
                          try {
                            persistedMessages =
                              await getSessionMessagesFromAgent(
                                sid,
                              )
                          } catch {
                            persistedMessages = []
                          }
                          // Walk back to the most recent assistant message in
                          // this run; tool_calls are siblings on it. Also
                          // collect tool_result entries that immediately
                          // follow it so we can pair input/output.
                          // Use the per-run baseline so we never read tool
                          // calls from a previous turn.
                          const sliceFrom = Math.max(
                            0,
                            Math.min(
                              liveBaselineCount,
                              Math.max(0, persistedMessages.length - 1),
                            ),
                          )
                          const recent = persistedMessages.slice(
                            sliceFrom,
                          )
                          let lastAssistantIndex = -1
                          for (let i = recent.length - 1; i >= 0; i--) {
                            const m = recent[i]
                            if (m.role === 'assistant') {
                              lastAssistantIndex = i
                              break
                            }
                          }
                          if (lastAssistantIndex >= 0) {
                            const lastAssistant = recent[
                              lastAssistantIndex
                            ]
                            const rawToolCalls = (lastAssistant.tool_calls ??
                              (lastAssistant as any).toolCalls) as
                              | Array<Record<string, unknown>>
                              | undefined
                            const toolCalls =
                              Array.isArray(rawToolCalls) && rawToolCalls.length
                                ? rawToolCalls
                                : []

                            const syntheticEvents = collectSyntheticLiveToolEvents({
                              messages: recent,
                              tracker: syntheticLiveToolTracker,
                              sessionKey: sessionKeyFromEvent,
                              runId,
                            })
                            for (const synthetic of syntheticEvents) {
                              persistActiveRun(
                                (runSessionKey, activeId) =>
                                  upsertRunToolCall(
                                    runSessionKey,
                                    activeId,
                                    {
                                      id: synthetic.toolCallId,
                                      name: synthetic.name,
                                      phase: synthetic.phase,
                                      args: synthetic.args,
                                      result: synthetic.result,
                                    },
                                  ),
                              )
                              sendEvent('tool', synthetic)
                            }
                          }
                        }
                      } catch (err) {
                        // Backfill is best-effort; don't fail the run.
                        console.warn(
                          '[send-stream] tool backfill failed:',
                          err,
                        )
                      }

                      const translated = {
                        state: 'complete',
                        sessionKey: sessionKeyFromEvent,
                        runId,
                      }
                      persistActiveRun((runSessionKey, activeId) =>
                        markRunStatus(runSessionKey, activeId, 'complete'),
                      )
                      sendEvent('done', translated)
                      closeStream()
                    }
                  },
                },
                )
              } finally {
                // Stop the mid-run tool poller and let it drain.
                liveRunActive = false
                try {
                  await livePollerPromise
                } catch {
                  // ignore
                }
              }

              // Set a timeout to close the stream if no completion event
              streamTimeoutTimer = setTimeout(() => {
                if (!streamClosed) {
                  sendEvent('error', { message: 'Stream timeout' })
                  closeStream()
                }
              }, SEND_STREAM_RUN_TIMEOUT_MS)
            } catch (err) {
              // Only send error if stream hasn't already completed successfully
              if (!streamClosed) {
                const errorMsg = normalizeClaudeErrorMessage(err)
                sendEvent('error', {
                  message: errorMsg,
                  sessionKey,
                })
                closeStream()
              }
            }
          },
          cancel() {
            // Browser navigation/unmount cancels the response reader. That
            // must not cancel the Hermes run itself: the chat/conductor should
            // keep thinking server-side so the user can return and recover the
            // answer from session history. Mark this client stream closed so we
            // stop enqueueing SSE chunks, but deliberately leave the upstream
            // abortController alone.
            streamClosed = true
            if (unregisterTimer) {
              clearTimeout(unregisterTimer)
              unregisterTimer = null
            }
            if (streamTimeoutTimer) {
              clearTimeout(streamTimeoutTimer)
              streamTimeoutTimer = null
            }
            if (activeRunId) {
              if (activeRunSessionKey) {
                const _runId = activeRunId
                const _sessionKey = activeRunSessionKey
                void (persistedRunReady ?? Promise.resolve())
                  .then(() => markRunStatus(_sessionKey, _runId, 'handoff'))
                  .catch(() => null)
              }
              unregisterActiveSendRun(activeRunId)
              activeRunId = null
            }
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            ...buildResolvedSessionHeaders({
              sessionKey,
              friendlyId: resolvedFriendlyId,
            }),
          },
        })
      },
    },
  },
})
