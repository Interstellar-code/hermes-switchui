import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAttachment, ChatMessage } from '../types'
import type { ChatStreamEvent } from '@/stores/chat-store'
import { readResolvedSessionHeaders } from '@/lib/send-stream-session-headers'
import { detectModelRejection, useChatStore } from '@/stores/chat-store'
import { useContextUsageStore } from '@/stores/context-usage-store'
import { pushActivity } from '@/components/inspector/activity-store'
import { parseApprovalDetail } from '@/lib/approvals'
import {
  activeScopeKey,
  profileBody,
  readSendFailure,
} from '@/lib/session-scope'

/**
 * Determine whether a stream-resolved session key change should trigger
 * onSessionResolved (which navigates the route). Only bootstrap keys
 * ("new", "main") should promote a backend-returned session ID to the
 * Workspace route identity. Concrete sessions must never be overridden
 * by a backend-derived api-* ID — that causes session splits (#297).
 */
export function shouldResolveStreamSession({
  requestedSessionKey,
  currentSessionKey,
  resolvedSessionKey,
}: {
  requestedSessionKey: string
  currentSessionKey: string
  resolvedSessionKey: string
}): boolean {
  // No change → nothing to resolve
  if (resolvedSessionKey === currentSessionKey) return false
  // Bootstrap keys (new, main) should resolve once to a concrete session
  if (requestedSessionKey === 'new' || requestedSessionKey === 'main') return true
  // Concrete session → never promote a different backend ID
  return false
}

/**
 * `POST /api/sessions/{id}/chat/stream` answers a bad `model` with a plain
 * JSON 400 BEFORE the SSE stream opens, so a stream client that assumes a 200
 * `text/event-stream` body silently drops the reason. Both this response shape
 * and the SSE `error` event our own route re-emits it as (see
 * routes/api/send-stream.ts) carry the same OpenAI-style envelope:
 *
 *   {"error":{"message":"…","type":"invalid_request_error",
 *             "param":"model","code":"model_not_available"}}
 *
 * `invalid_model` = non-string/empty value; `model_not_available` = the
 * provider chain refused the name at resolution time.
 */
const MODEL_ERROR_CODES = new Set(['invalid_model', 'model_not_available'])

export type ModelErrorEnvelope = {
  message: string
  code: string | null
  param: string | null
}

export function parseModelErrorEnvelope(
  raw: string,
): ModelErrorEnvelope | null {
  const start = raw.indexOf('{')
  if (start < 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start)) as unknown
  } catch {
    return null
  }
  const error = (parsed as { error?: unknown } | null)?.error
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const message =
    typeof record.message === 'string' ? record.message.trim() : ''
  if (!message) return null
  const code = typeof record.code === 'string' ? record.code.trim() : ''
  const param = typeof record.param === 'string' ? record.param.trim() : ''
  if (param !== 'model' && !MODEL_ERROR_CODES.has(code)) return null
  return { message, code: code || null, param: param || null }
}

/**
 * Whether this response body can be fed to the SSE parser.
 *
 * A `Content-Type` that positively names another type (the JSON error
 * envelope) proves it cannot. An ABSENT header is inconclusive rather than a
 * refusal — proxies drop it, and refusing to parse a stream we could have read
 * would be a worse failure than the one we are guarding against.
 */
export function isEventStreamResponse(response: {
  headers: { get: (name: string) => string | null }
}): boolean {
  const contentType = (response.headers.get('content-type') ?? '')
    .trim()
    .toLowerCase()
  if (!contentType) return true
  return contentType.includes('text/event-stream')
}

type StreamingState = {
  isStreaming: boolean
  streamingMessageId: string | null
  streamingText: string
  error: string | null
}

type StreamLifecyclePhase =
  | 'idle'
  | 'requesting'
  | 'accepted'
  | 'active'
  | 'handoff'
  | 'complete'
  | 'error'

type StreamChunk = {
  text?: string
  delta?: string
  content?: string
  chunk?: string
}

type StepUsagePayload = {
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
  contextPercent?: number
  model?: string
}

type PortableHistoryMessage = {
  role: string
  content: string
}

type UseStreamingMessageOptions = {
  onStarted?: (payload: { runId: string | null }) => void
  onChunk?: (text: string, fullText: string) => void
  onComplete?: (message: ChatMessage) => void
  onError?: (error: string) => void
  onThinking?: (thinking: string) => void
  onTool?: (tool: unknown) => void
  onMessageAccepted?: (
    sessionKey: string,
    friendlyId: string,
    clientId: string,
  ) => void
  onAbort?: () => void
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
  acceptedTimeoutMs?: number
  handoffTimeoutMs?: number
}

export function useStreamingMessage(options: UseStreamingMessageOptions = {}) {
  const {
    onStarted,
    onChunk,
    onComplete,
    onError,
    onThinking,
    onTool,
    onMessageAccepted,
    onAbort,
    onSessionResolved,
    acceptedTimeoutMs,
    handoffTimeoutMs,
  } = options

  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    streamingMessageId: null,
    streamingText: '',
    error: null,
  })

  const eventSourceRef = useRef<AbortController | null>(null)
  const fullTextRef = useRef<string>('')
  const renderedTextRef = useRef<string>('')
  const targetTextRef = useRef<string>('')
  const frameRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const thinkingRef = useRef<string>('')
  const activeRunIdRef = useRef<string | null>(null)
  const delayedUnregisterTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const activeSessionKeyRef = useRef<string>('main')
  // Monotonically increasing token. Each call to startStreaming bumps this so
  // any in-flight fetch-reader loop, or pending microtask processing chunks it
  // already read into the SSE buffer, can detect that it is stale and refuse to
  // dispatch events into the newly active session. See #297.
  const streamGenerationRef = useRef<number>(0)
  const lifecyclePhaseRef = useRef<StreamLifecyclePhase>('idle')
  const acceptedAtRef = useRef<number | null>(null)
  const lastActivityAtRef = useRef<number | null>(null)
  const handoffTimerRef = useRef<number | null>(null)
  const stepUsageRef = useRef<StepUsagePayload>({})
  // Captures the sessionKey the caller requested at stream-start time so
  // SSE `started` events can decide whether a backend-returned session ID
  // should be promoted to the route identity. Prevents concrete sessions
  // from being overridden by api-* derivations (#297).
  const requestedSessionKeyRef = useRef<string>('')
  // Whether THIS turn ran any tool. A provider's canned model refusal is
  // emitted before the agent does any work, so a turn that called a tool is
  // never one (see detectModelRejection).
  const toolCallSeenRef = useRef(false)

  const registerSendStreamRun = useChatStore((s) => s.registerSendStreamRun)
  const unregisterSendStreamRun = useChatStore((s) => s.unregisterSendStreamRun)
  const processStoreEvent = useChatStore((s) => s.processEvent)
  const clearStreamingSession = useChatStore((s) => s.clearStreamingSession)
  const clearPendingClarify = useChatStore((s) => s.clearPendingClarify)
  const dismissUnresolvedClarify = useChatStore(
    (s) => s.dismissUnresolvedClarify,
  )
  const finishClarifyRun = useCallback((sessionKey: string) => {
    // Hermes can emit `done` while it is blocked waiting for a clarify answer.
    // Keep that unanswered card mounted; `started` clears it when the answer
    // resumes the run.
    if (useChatStore.getState().getPendingClarify(sessionKey)) return
    dismissUnresolvedClarify(sessionKey)
  }, [dismissUnresolvedClarify])
  // An approval clarify blocks the run server-side (the gateway is still
  // waiting on `POST /v1/runs/{runId}/approval`), and it has its own ~180s
  // gateway-side timeout. A dead client stream — a `started` on resume, a
  // `done` with state:'error', or a bare `error` event (e.g. the server's
  // SEND_STREAM_RUN_TIMEOUT_MS firing after 600s, see send-stream.ts) — does
  // NOT mean the approval decision is no longer needed. Dropping the card
  // here would just orphan it client-side while the gateway keeps waiting,
  // so approval-kind entries are exempt from these run-boundary clears.
  // Every other clarify kind keeps today's behavior.
  const clearClarifyUnlessApproval = useCallback(
    (sessionKey: string, clear: (sessionKey: string) => void) => {
      const pending = useChatStore.getState().getPendingClarify(sessionKey)
      if (pending?.kind === 'approval') return
      clear(sessionKey)
    },
    [],
  )
  /**
   * End-of-turn check for FAILURE SHAPE 2: an HTTP 200 whose assistant message
   * IS the provider's rejection. The configured provider is a permissive
   * aggregator — it accepts nearly any model id at resolution time and only
   * refuses at inference — so "the request succeeded" says nothing about
   * whether the switch worked. And because the switch is sticky, a missed
   * rejection wedges every later turn on the session, not just this one.
   *
   * Gated on `changed`: only the single turn that installs a NEW model is
   * inspected. Repeat sends of an already-installed model are server no-ops
   * and are skipped, which is what keeps ordinary conversation (including
   * conversation *about* model availability) out of the detector's reach.
   */
  const checkForModelRejection = useCallback((finalText: string) => {
    const store = useChatStore.getState()
    const sessionKey = activeSessionKeyRef.current
    const switchState = store.getModelSwitch(sessionKey)
    if (!switchState.changed) return
    if (
      !detectModelRejection({
        text: finalText,
        requestedModel: switchState.requested,
        hadToolCalls: toolCallSeenRef.current,
      })
    ) {
      return
    }
    store.failModelSwitch(sessionKey, {
      message: finalText.trim(),
      code: 'provider_rejected_model',
      shape: 'provider-rejection',
    })
  }, [])

  const recordCompaction = useContextUsageStore((s) => s.recordCompaction)
  const updateContextPercent = useContextUsageStore((s) => s.updateContextPercent)

  const ACCEPTED_NO_ACTIVITY_TIMEOUT_MS = acceptedTimeoutMs ?? 120_000
  const HANDOFF_NO_ACTIVITY_TIMEOUT_MS = handoffTimeoutMs ?? 300_000

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const clearHandoffTimer = useCallback(() => {
    if (handoffTimerRef.current !== null) {
      window.clearTimeout(handoffTimerRef.current)
      handoffTimerRef.current = null
    }
  }, [])

  const clearSendStreamRun = useCallback(() => {
    if (activeRunIdRef.current) {
      unregisterSendStreamRun(activeRunIdRef.current)
      activeRunIdRef.current = null
    }
  }, [unregisterSendStreamRun])

  const resetActiveStreamState = useCallback(
    (nextSessionKey?: string) => {
      stopFrame()
      clearHandoffTimer()
      clearSendStreamRun()
      // Cancel any delayed unregister from a previous run
      if (delayedUnregisterTimerRef.current) {
        clearTimeout(delayedUnregisterTimerRef.current)
        delayedUnregisterTimerRef.current = null
      }
      clearStreamingSession(activeSessionKeyRef.current)
      // An aborted/superseded turn leaves no verdict on its model switch.
      useChatStore.getState().settleModelSwitch(activeSessionKeyRef.current)
      if (nextSessionKey) {
        activeSessionKeyRef.current = nextSessionKey
      }
      fullTextRef.current = ''
      renderedTextRef.current = ''
      targetTextRef.current = ''
      thinkingRef.current = ''
      toolCallSeenRef.current = false
      stepUsageRef.current = {}
      lifecyclePhaseRef.current = 'idle'
      acceptedAtRef.current = null
      lastActivityAtRef.current = null
      setState({
        isStreaming: false,
        streamingMessageId: null,
        streamingText: '',
        error: null,
      })
    },
    [clearHandoffTimer, clearSendStreamRun, clearStreamingSession, stopFrame],
  )

  const markActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now()
    if (
      lifecyclePhaseRef.current === 'accepted' ||
      lifecyclePhaseRef.current === 'requesting' ||
      lifecyclePhaseRef.current === 'handoff'
    ) {
      lifecyclePhaseRef.current = 'active'
    }
  }, [])

  const markAccepted = useCallback(() => {
    const now = Date.now()
    acceptedAtRef.current = now
    lastActivityAtRef.current = now
    lifecyclePhaseRef.current = 'accepted'
  }, [])

  const markFailed = useCallback(
    (message: string) => {
      if (finishedRef.current) return
      finishedRef.current = true
      eventSourceRef.current = null
      stopFrame()
      lifecyclePhaseRef.current = 'error'
      clearHandoffTimer()
      clearSendStreamRun()
      // Drop the "switching model…" spinner; any recorded failure survives so
      // the picker can still surface it.
      useChatStore.getState().settleModelSwitch(activeSessionKeyRef.current)
      clearStreamingSession(activeSessionKeyRef.current)
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        error: message,
      }))
      onError?.(message)
    },
    [
      clearHandoffTimer,
      clearSendStreamRun,
      clearStreamingSession,
      onError,
      stopFrame,
    ],
  )

  const schedulePostAcceptanceTimeout = useCallback(
    (reason: 'accepted' | 'handoff') => {
      clearHandoffTimer()
      const timeoutMs =
        reason === 'handoff'
          ? HANDOFF_NO_ACTIVITY_TIMEOUT_MS
          : ACCEPTED_NO_ACTIVITY_TIMEOUT_MS
      handoffTimerRef.current = window.setTimeout(() => {
        if (finishedRef.current) return
        if (
          lifecyclePhaseRef.current !== 'accepted' &&
          lifecyclePhaseRef.current !== 'handoff'
        ) {
          return
        }
        if (reason === 'handoff') {
          const store = useChatStore.getState()
          const streamingState =
            store.streamingState.get(
              activeScopeKey(activeSessionKeyRef.current),
            ) ?? null
          const lastEventTimestamp = store.lastEventAt
          if (
            streamingState !== null ||
            (lastEventTimestamp > 0 &&
              Date.now() - lastEventTimestamp < timeoutMs)
          ) {
            schedulePostAcceptanceTimeout(reason)
            return
          }
        }
        const lastActivityAt =
          lastActivityAtRef.current ?? acceptedAtRef.current
        if (lastActivityAt && Date.now() - lastActivityAt < timeoutMs - 250) {
          schedulePostAcceptanceTimeout(reason)
          return
        }
        markFailed(
          reason === 'handoff'
            ? 'Run stalled after handoff'
            : 'No activity received after message was accepted',
        )
      }, timeoutMs)
    },
    [clearHandoffTimer, markFailed],
  )

  const transitionToHandoff = useCallback(() => {
    if (finishedRef.current) return
    lifecyclePhaseRef.current = 'handoff'
    clearSendStreamRun()
    clearHandoffTimer()
    stopFrame()
    setState((prev) => ({
      ...prev,
      isStreaming: false,
    }))
    schedulePostAcceptanceTimeout('handoff')
  }, [
    clearHandoffTimer,
    clearSendStreamRun,
    schedulePostAcceptanceTimeout,
    stopFrame,
  ])

  useEffect(
    function keepAcceptedRunAliveOnUnmount() {
      return function cleanup() {
        if (!eventSourceRef.current || finishedRef.current) return

        // Navigating away from Chat unmounts this hook. Previously this cleanup
        // aborted /api/send-stream and reset the local stream state, which made
        // the UI look like Hermes stopped thinking. Leave the accepted request
        // alive instead: the server-side route deliberately keeps the upstream
        // Hermes run alive after the browser reader is cancelled, and the
        // persisted waiting/session state lets the screen recover from history
        // or active-run polling when the user comes back.
        lifecyclePhaseRef.current = 'handoff'
        clearSendStreamRun()
        clearHandoffTimer()
        stopFrame()
      }
    },
    [clearHandoffTimer, clearSendStreamRun, stopFrame],
  )

  const pushTargetText = useCallback(
    (target: string) => {
      // #212: this hook no longer runs its own requestAnimationFrame typewriter.
      // The single, path-agnostic reveal animation lives in useSmoothStreamingText
      // (consumed in chat-screen.tsx). Running a second rAF loop here was
      // redundant — on the realtime path its output (state.streamingText) was
      // unused, and on the portable path it caused double-smoothing. We now push
      // the full accumulated text synchronously so the store/state holds the raw
      // target and useSmoothStreamingText performs the one-and-only reveal.
      const previous = fullTextRef.current
      fullTextRef.current = target
      targetTextRef.current = target
      renderedTextRef.current = target

      if (target === previous) return

      setState((prev) =>
        prev.streamingText === target
          ? prev
          : { ...prev, streamingText: target },
      )

      const delta =
        target.length > previous.length && target.startsWith(previous)
          ? target.slice(previous.length)
          : target
      if (delta) {
        onChunk?.(delta, target)
      }
    },
    [onChunk],
  )

  const finishStream = useCallback(
    (payload?: unknown) => {
      if (finishedRef.current) return
      finishedRef.current = true
      eventSourceRef.current = null
      stopFrame()
      lifecyclePhaseRef.current = 'complete'
      clearHandoffTimer()
      // Delay runId unregistration so chat-events dedup continues filtering
      // for a few seconds after completion — prevents late duplicate messages
      if (delayedUnregisterTimerRef.current) {
        clearTimeout(delayedUnregisterTimerRef.current)
        delayedUnregisterTimerRef.current = null
      }
      const completedRunId = activeRunIdRef.current
      if (completedRunId) {
        activeRunIdRef.current = null
        delayedUnregisterTimerRef.current = setTimeout(() => {
          delayedUnregisterTimerRef.current = null
          unregisterSendStreamRun(completedRunId)
        }, 5000)
      }

      const finalText = fullTextRef.current
      const thinking = thinkingRef.current
      renderedTextRef.current = finalText
      targetTextRef.current = finalText

      // Must run BEFORE settling: the detector reads the `changed` flag that
      // settling clears.
      checkForModelRejection(finalText)
      useChatStore.getState().settleModelSwitch(activeSessionKeyRef.current)

      setState((prev) => ({
        ...prev,
        isStreaming: false,
        streamingText: finalText,
      }))

      const message: ChatMessage = {
        role: 'assistant',
        content: [
          ...(thinking ? [{ type: 'thinking' as const, thinking }] : []),
          { type: 'text' as const, text: finalText },
        ],
        timestamp: Date.now(),
        __streamingStatus: 'complete',
        ...stepUsageRef.current,
        ...(payload as Record<string, unknown>),
      }

      onComplete?.(message)
    },
    [
      checkForModelRejection,
      clearHandoffTimer,
      onComplete,
      stopFrame,
      unregisterSendStreamRun,
    ],
  )

  const processEvent = useCallback(
    (event: string, data: unknown) => {
      const payload = data as Record<string, unknown>

      // [DEBUG TUI] Log every SSE event so we can see whether tool.* events arrive
      // from Hermes Agent through Workspace. Toggle off by setting
      // localStorage.removeItem('hermes:debug:sse')
      if (
        typeof window !== 'undefined' &&
        window.localStorage.getItem('hermes:debug:sse') === '1'
      ) {
        console.log(
          '[hermes-sse]',
          event,
          (payload.name as string) || '',
          (payload.phase as string) || '',
          payload,
        )
      }

      // hb_signal/keepalive events from server: just mark activity, never let them
      // surface as user-visible thinking or tool rows.
      if (event === 'hb_signal' || event === 'heartbeat' || event === 'keepalive' || event === 'ping') {
        markActivity()
        return
      }

      switch (event) {
        case 'started': {
          // A resumed run may emit `started` after the user answers a clarify.
          // Keep answered cards visible as a transcript record; only drop stale
          // unanswered questions before processing the next run lifecycle.
          // Approvals are exempt — see clearClarifyUnlessApproval.
          clearClarifyUnlessApproval(
            activeSessionKeyRef.current,
            dismissUnresolvedClarify,
          )
          const resolvedSessionKey =
            typeof payload.sessionKey === 'string' && payload.sessionKey.trim()
              ? payload.sessionKey.trim()
              : activeSessionKeyRef.current
          const resolvedFriendlyId =
            typeof payload.friendlyId === 'string' && payload.friendlyId.trim()
              ? payload.friendlyId.trim()
              : resolvedSessionKey
          if (resolvedSessionKey !== activeSessionKeyRef.current) {
            // Guard: only promote backend session IDs for bootstrap keys.
            // Concrete Workspace sessions must never be overridden (#297).
            if (
              shouldResolveStreamSession({
                requestedSessionKey: requestedSessionKeyRef.current,
                currentSessionKey: activeSessionKeyRef.current,
                resolvedSessionKey,
              })
            ) {
              activeSessionKeyRef.current = resolvedSessionKey
              onSessionResolved?.({
                sessionKey: resolvedSessionKey,
                friendlyId: resolvedFriendlyId,
              })
            }
          }
          // Register runId so chat-events skips duplicate chunks for this run
          const runId = payload.runId as string | undefined
          if (runId) {
            activeRunIdRef.current = runId
            registerSendStreamRun(runId)
          }
          markActivity()
          pushActivity({
            type: 'assistant_start',
            time: new Date().toLocaleTimeString(),
            text: 'Assistant started',
          })
          processStoreEvent({
            type: 'chunk',
            text: '',
            runId: runId ?? undefined,
            sessionKey: activeSessionKeyRef.current,
            transport: 'send-stream',
          })
          onStarted?.({ runId: runId ?? null })
          break
        }
        case 'assistant': {
          const text = (payload as { text?: string }).text ?? ''
          if (text) {
            markActivity()
            processStoreEvent({
              type: 'chunk',
              text,
              runId: activeRunIdRef.current ?? undefined,
              sessionKey: activeSessionKeyRef.current,
              transport: 'send-stream',
            })
            pushTargetText(text)
          }
          break
        }
        case 'chunk': {
          const chunk = payload as StreamChunk
          const fullReplace =
            (chunk as Record<string, unknown>).fullReplace === true
          const newText =
            chunk.delta ?? chunk.text ?? chunk.content ?? chunk.chunk ?? ''
          if (newText) {
            markActivity()
            const accumulated = fullReplace
              ? newText
              : fullTextRef.current + newText
            pushTargetText(accumulated)
            processStoreEvent({
              type: 'chunk',
              text: accumulated,
              fullReplace: true,
              runId: activeRunIdRef.current ?? undefined,
              sessionKey: activeSessionKeyRef.current,
              transport: 'send-stream',
            })
          }
          break
        }
        case 'thinking': {
          const thinking =
            (payload as { text?: string; thinking?: string }).text ??
            (payload as { thinking?: string }).thinking ??
            ''
          // Drop server-side keepalive placeholders that came in as 'thinking'
          // before the dedicated hb_signal event existed. These are not real
          // model thinking and would otherwise pollute the TUI activity card.
          const isKeepalivePlaceholder =
            typeof thinking === 'string' &&
            /^still\s+working[.\u2026]*\s*$/i.test(thinking.trim())
          if (isKeepalivePlaceholder) break
          if (thinking) {
            markActivity()
            thinkingRef.current = thinking
            processStoreEvent({
              type: 'thinking',
              text: thinking,
              runId: activeRunIdRef.current ?? undefined,
              sessionKey: activeSessionKeyRef.current,
              transport: 'send-stream',
            })
            onThinking?.(thinking)
          }
          break
        }
        case 'model_effective': {
          // Confirmation comes from the SERVER (`run.started`.model), never
          // from what we sent — that is what makes a silent server-side
          // fallback visible in the composer chip.
          const effectiveModel =
            typeof payload.model === 'string' ? payload.model.trim() : ''
          if (effectiveModel) {
            useChatStore
              .getState()
              .setEffectiveModel(activeSessionKeyRef.current, effectiveModel)
          }
          break
        }
        case 'tool': {
          markActivity()
          toolCallSeenRef.current = true
          {
            const toolName =
              typeof payload.name === 'string' ? payload.name : 'tool'
            const phase =
              typeof payload.phase === 'string' ? payload.phase : 'calling'
            const isMemory = /memory|remember|recall|save_memory/i.test(
              toolName,
            )
            const isFileWrite = /^(write_file|write|edit|Edit|Write)$/i.test(
              toolName,
            )
            const isFileRead = /^(read_file|read|Read|search_files)$/i.test(
              toolName,
            )
            const eventType = isMemory
              ? 'memory_write'
              : isFileWrite
                ? 'file_write'
                : isFileRead
                  ? 'file_read'
                  : 'tool_call'
            pushActivity({
              type: eventType,
              time: new Date().toLocaleTimeString(),
              text: `${toolName} (${phase})`,
            })
          }
          processStoreEvent({
            type: 'tool',
            phase:
              typeof payload.phase === 'string' ? payload.phase : 'calling',
            name: typeof payload.name === 'string' ? payload.name : 'tool',
            toolCallId:
              typeof payload.toolCallId === 'string'
                ? payload.toolCallId
                : undefined,
            args: payload.args,
            preview:
              typeof payload.preview === 'string' ? payload.preview : undefined,
            result:
              typeof payload.result === 'string' ? payload.result : undefined,
            runId: activeRunIdRef.current ?? undefined,
            sessionKey: activeSessionKeyRef.current,
            transport: 'send-stream',
          })
          onTool?.(payload)
          break
        }
        case 'delegation': {
          markActivity()
          processStoreEvent({
            type: 'delegation',
            kind: typeof payload.kind === 'string' ? payload.kind : 'progress',
            subagentId:
              typeof payload.subagentId === 'string' ? payload.subagentId : '',
            parentId: typeof payload.parentId === 'string' ? payload.parentId : undefined,
            childSessionId:
              typeof payload.childSessionId === 'string' ? payload.childSessionId : undefined,
            agentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
            depth: typeof payload.depth === 'number' ? payload.depth : undefined,
            goal: typeof payload.goal === 'string' ? payload.goal : undefined,
            model: typeof payload.model === 'string' ? payload.model : undefined,
            status: typeof payload.status === 'string' ? payload.status : undefined,
            toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
            text: typeof payload.text === 'string' ? payload.text : undefined,
            summary: typeof payload.summary === 'string' ? payload.summary : undefined,
            toolCount: typeof payload.toolCount === 'number' ? payload.toolCount : undefined,
            tokenCount: typeof payload.tokenCount === 'number' ? payload.tokenCount : undefined,
            durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
            runId: activeRunIdRef.current ?? undefined,
            sessionKey: activeSessionKeyRef.current,
            transport: 'send-stream',
          })
          break
        }
        case 'artifact': {
          markActivity()
          const title =
            typeof payload.title === 'string' && payload.title.trim()
              ? payload.title.trim()
              : 'Artifact created'
          const kind =
            typeof payload.kind === 'string' && payload.kind.trim()
              ? payload.kind.trim()
              : 'artifact'
          const path =
            typeof payload.path === 'string' && payload.path.trim()
              ? payload.path.trim()
              : ''
          pushActivity({
            type: 'artifact',
            time: new Date().toLocaleTimeString(),
            text: path ? `${title} — ${path}` : title,
          })
          processStoreEvent({
            type: 'tool',
            phase: 'complete',
            name: `artifact:${kind}`,
            result: path ? `${title} — ${path}` : title,
            runId: activeRunIdRef.current ?? undefined,
            sessionKey: activeSessionKeyRef.current,
            transport: 'send-stream',
          })
          break
        }
        case 'step': {
          const nextUsage: StepUsagePayload = {
            inputTokens:
              typeof payload.inputTokens === 'number'
                ? payload.inputTokens
                : stepUsageRef.current.inputTokens,
            outputTokens:
              typeof payload.outputTokens === 'number'
                ? payload.outputTokens
                : stepUsageRef.current.outputTokens,
            cacheRead:
              typeof payload.cacheRead === 'number'
                ? payload.cacheRead
                : stepUsageRef.current.cacheRead,
            cacheWrite:
              typeof payload.cacheWrite === 'number'
                ? payload.cacheWrite
                : stepUsageRef.current.cacheWrite,
            contextPercent:
              typeof payload.contextPercent === 'number'
                ? payload.contextPercent
                : stepUsageRef.current.contextPercent,
            model:
              typeof payload.model === 'string'
                ? payload.model
                : stepUsageRef.current.model,
          }
          stepUsageRef.current = nextUsage
          if (typeof payload.contextPercent === 'number') {
            updateContextPercent(activeSessionKeyRef.current, payload.contextPercent)
          }
          break
        }
        case 'usage_update': {
          const pct =
            typeof payload.contextPercent === 'number'
              ? payload.contextPercent
              : null
          if (pct !== null) {
            if (payload.compacted === true) {
              recordCompaction({
                sessionKey: activeSessionKeyRef.current,
                contextPercent: pct,
                messagesBefore:
                  typeof payload.messagesBefore === 'number'
                    ? payload.messagesBefore
                    : undefined,
                messagesAfter:
                  typeof payload.messagesAfter === 'number'
                    ? payload.messagesAfter
                    : undefined,
              })
            } else {
              updateContextPercent(activeSessionKeyRef.current, pct)
            }
          }
          break
        }
        case 'done': {
          const doneState = (payload as { state?: string }).state
          const errorMessage = (payload as { errorMessage?: string })
            .errorMessage
          pushActivity({
            type: 'assistant_complete',
            time: new Date().toLocaleTimeString(),
            text: doneState === 'error' ? `Error: ${errorMessage}` : 'Complete',
          })
          processStoreEvent({
            type: 'done',
            state: doneState ?? 'final',
            errorMessage,
            message: payload.message as Record<string, unknown> | undefined,
            runId: activeRunIdRef.current ?? undefined,
            sessionKey: activeSessionKeyRef.current,
            transport: 'send-stream',
          })
          if (doneState === 'error' && errorMessage) {
            // Approvals are exempt — see clearClarifyUnlessApproval.
            clearClarifyUnlessApproval(
              activeSessionKeyRef.current,
              dismissUnresolvedClarify,
            )
            markFailed(errorMessage)
            break
          }
          finishClarifyRun(activeSessionKeyRef.current)
          finishStream(payload)
          break
        }
        case 'complete': {
          finishClarifyRun(activeSessionKeyRef.current)
          finishStream(payload)
          break
        }
        case 'error': {
          // Ignore late error events after stream already completed or finished
          if (
            finishedRef.current ||
            lifecyclePhaseRef.current === 'complete' ||
            lifecyclePhaseRef.current === 'idle' ||
            lifecyclePhaseRef.current === 'error'
          ) {
            break
          }
          const errorMessage =
            (payload as { message?: string }).message ?? 'Stream error'
          // FAILURE SHAPE 1 relayed through our own route: the gateway's
          // pre-stream JSON 400 on `model`. The session's model is unchanged,
          // so record the failure (which rolls the selection back) as well as
          // surfacing the gateway's own message.
          const modelError = payload.modelError as
            | { message?: unknown; code?: unknown }
            | undefined
          if (modelError && typeof modelError.message === 'string') {
            useChatStore
              .getState()
              .failModelSwitch(activeSessionKeyRef.current, {
                message: modelError.message,
                code:
                  typeof modelError.code === 'string' ? modelError.code : null,
                shape: 'http-400',
              })
          }
          // Approvals are exempt — see clearClarifyUnlessApproval. This is
          // the path the server's SEND_STREAM_RUN_TIMEOUT_MS (600s) hits: the
          // gateway is still waiting on the approval decision when this
          // fires, so the card must survive it.
          clearClarifyUnlessApproval(
            activeSessionKeyRef.current,
            clearPendingClarify,
          )
          markFailed(errorMessage)
          break
        }
        case 'timeout': {
          if (
            lifecyclePhaseRef.current === 'accepted' ||
            lifecyclePhaseRef.current === 'active' ||
            lifecyclePhaseRef.current === 'handoff'
          ) {
            transitionToHandoff()
          } else {
            markFailed('Request timed out')
          }
          break
        }
        case 'heartbeat': {
          markActivity()
          break
        }
        case 'close': {
          if (fullTextRef.current) {
            finishStream()
          } else if (
            lifecyclePhaseRef.current === 'accepted' ||
            lifecyclePhaseRef.current === 'active' ||
            lifecyclePhaseRef.current === 'handoff'
          ) {
            transitionToHandoff()
          } else {
            markFailed('Hermes Agent connection closed')
          }
          break
        }
        case 'clarify': {
          processStoreEvent({
            type: 'clarify',
            // Mark as the authoritative send-stream transport so the store's
            // dedup guard (skip non-send-stream events for an active
            // send-stream run) does NOT drop it. Without this the clarify
            // event is silently discarded and the inline card never renders.
            transport: 'send-stream',
            clarifyId: (payload.clarifyId as string) || '',
            interactionId:
              (payload.interactionId as string | undefined) || undefined,
            messageId: (payload.messageId as string | undefined) || undefined,
            // `kind` and `toolName` were dropped here while the sibling
            // resolved-case forwarded them, so a `kind: 'approval'` request
            // arrived at the store as a generic clarify and nothing
            // downstream could tell it was an approval. Issue #353.
            kind: (payload.kind as string | undefined) || undefined,
            toolName: (payload.toolName as string | undefined) || undefined,
            question: (payload.question as string) || '',
            choices: Array.isArray(payload.choices)
              ? (payload.choices as Array<string>)
              : null,
            approval: parseApprovalDetail(payload.approval) ?? undefined,
            sessionKey: activeSessionKeyRef.current,
            runId: activeRunIdRef.current ?? undefined,
          })
          break
        }
        case 'clarify_resolved':
        case 'interaction':
        case 'interaction_resolved': {
          const isResolved = event === 'clarify_resolved' || event === 'interaction_resolved'
          processStoreEvent({
            type: isResolved ? 'interaction_resolved' : 'interaction',
            // Same dedup-guard reason as the clarify case above.
            transport: 'send-stream',
            clarifyId:
              (payload.clarifyId as string) ||
              (payload.clarify_id as string) ||
              (payload.interactionId as string) ||
              (payload.interaction_id as string) ||
              '',
            interactionId:
              (payload.interactionId as string) ||
              (payload.interaction_id as string) ||
              (payload.clarifyId as string) ||
              (payload.clarify_id as string) ||
              undefined,
            messageId:
              (payload.messageId as string | undefined) ||
              (payload.message_id as string | undefined) ||
              undefined,
            kind: (payload.kind as 'choice' | 'text' | 'approval' | undefined) || undefined,
            toolName:
              (payload.toolName as string | undefined) ||
              (payload.tool_name as string | undefined) ||
              undefined,
            question: (payload.question as string | undefined) || undefined,
            choices: Array.isArray(payload.choices)
              ? (payload.choices as Array<string>)
              : null,
            answer:
              (payload.answer as string | undefined) ||
              (payload.selectedAnswer as string | undefined) ||
              (payload.selected_answer as string | undefined) ||
              undefined,
            sessionKey: activeSessionKeyRef.current,
            runId: activeRunIdRef.current ?? undefined,
          } as ChatStreamEvent)
          break
        }
      }
    },
    [
      clearClarifyUnlessApproval,
      clearPendingClarify,
      dismissUnresolvedClarify,
      finishClarifyRun,
      finishStream,
      markFailed,
      onStarted,
      onSessionResolved,
      onThinking,
      onTool,
      markActivity,
      processStoreEvent,
      pushTargetText,
      recordCompaction,
      registerSendStreamRun,
      transitionToHandoff,
      updateContextPercent,
    ],
  )

  const startStreaming = useCallback(
    async (params: {
      sessionKey: string
      friendlyId: string
      message: string
      history?: Array<PortableHistoryMessage>
      thinking?: string
      fastMode?: boolean
      attachments?: Array<ChatAttachment>
      idempotencyKey?: string
      model?: string
    }) => {
      if (eventSourceRef.current) {
        // Preserve in-progress response as a partial message before aborting
        // so it doesn't vanish from the UI when the user interrupts
        if (fullTextRef.current && !finishedRef.current) {
          processStoreEvent({
            type: 'done',
            state: 'interrupted',
            sessionKey: activeSessionKeyRef.current,
            transport: 'send-stream',
            message: {
              role: 'assistant',
              content: [
                ...(thinkingRef.current
                  ? [
                      {
                        type: 'thinking' as const,
                        thinking: thinkingRef.current,
                      },
                    ]
                  : []),
                { type: 'text' as const, text: fullTextRef.current },
              ],
              __streamingStatus: 'interrupted',
            } as any,
          })
        }
        eventSourceRef.current.abort()
      }

      const abortController = new AbortController()
      eventSourceRef.current = abortController
      finishedRef.current = false
      resetActiveStreamState(params.sessionKey)
      lifecyclePhaseRef.current = 'requesting'
      requestedSessionKeyRef.current = params.sessionKey

      // Record the model this send carries BEFORE the request goes out. The
      // store marks it pending only when it differs from the last
      // server-confirmed model — a first switch to a model the session has
      // not used does credential resolution plus possibly a catalog fetch and
      // a live endpoint probe (seconds, worst case ~15s before the first
      // token), while a repeat send of the same model is a server-side no-op
      // and must not show a spinner.
      useChatStore.getState().beginModelSwitch(params.sessionKey, params.model)

      // Bump the generation token so any chunks the previous stream had
      // already buffered but not yet dispatched (after abort) get rejected
      // when they reach processEvent. The local capture is what this run
      // compares against. See #297.
      streamGenerationRef.current += 1
      const myGeneration = streamGenerationRef.current

      const messageId = `streaming-${Date.now()}`

      setState({
        isStreaming: true,
        streamingMessageId: messageId,
        streamingText: '',
        error: null,
      })

      try {
        const response = await fetch('/api/send-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionKey: params.sessionKey,
            friendlyId: params.friendlyId,
            message: params.message,
            history: params.history,
            thinking: params.thinking,
            fastMode: params.fastMode,
            attachments: params.attachments,
            idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
            model: params.model || undefined,
            locale:
              typeof window !== 'undefined'
                ? localStorage.getItem('hermes-switchui-locale') || 'en'
                : 'en',
            // The scoped profile, or nothing at all when unscoped. Without it
            // the server has no profile to fail closed on and the send lands
            // in whichever profile the gateway is running (P0A §1.1).
            ...profileBody(),
          }),
          signal: abortController.signal,
        })

        // Never assume a 200 SSE body. A model the gateway refuses comes back
        // as a plain JSON 400 *before* the SSE stream opens, and our own route
        // can answer with JSON too (auth, profile scope, empty message). Read
        // the envelope instead of feeding JSON to the SSE parser.
        //
        // The session's model is UNCHANGED on a 400, so a refusal must roll
        // the picker back to the selection that is actually installed and
        // surface the gateway's own `error.message` verbatim.
        const failModelSwitchFrom = (raw: string): boolean => {
          const modelError = parseModelErrorEnvelope(raw)
          if (!modelError) return false
          useChatStore.getState().failModelSwitch(params.sessionKey, {
            message: modelError.message,
            code: modelError.code,
            shape: 'http-400',
          })
          markFailed(modelError.message)
          return true
        }

        if (!response.ok) {
          // `readSendFailure` passes a non-string `error` body through as raw
          // text, which is exactly the envelope shape we need.
          const failure = await readSendFailure(response)
          if (failModelSwitchFrom(failure)) return
          throw new Error(failure)
        }
        if (!isEventStreamResponse(response)) {
          const raw = await response.text().catch(() => '')
          if (failModelSwitchFrom(raw)) return
          throw new Error(
            raw.trim() || 'Send endpoint returned a non-streaming response',
          )
        }

        const resolvedHeaders = readResolvedSessionHeaders(response.headers, {
          sessionKey: params.sessionKey,
          friendlyId: params.friendlyId || params.sessionKey,
        })
        const resolvedSessionKey = resolvedHeaders.sessionKey
        const resolvedFriendlyId = resolvedHeaders.friendlyId
        if (resolvedSessionKey !== activeSessionKeyRef.current) {
          // Only promote a backend-returned session ID when the original
          // request was a bootstrap key ("new"/"main"). Concrete Workspace
          // sessions must never be overridden — that causes splits (#297).
          if (
            shouldResolveStreamSession({
              requestedSessionKey: params.sessionKey,
              currentSessionKey: activeSessionKeyRef.current,
              resolvedSessionKey,
            })
          ) {
            activeSessionKeyRef.current = resolvedSessionKey
            onSessionResolved?.({
              sessionKey: resolvedSessionKey,
              friendlyId: resolvedFriendlyId,
            })
          }
        }

        markAccepted()
        schedulePostAcceptanceTimeout('accepted')

        // HTTP 200 — message accepted by Hermes Agent. Clear optimistic "sending"
        // status so the Retry timer never fires. Hermes Agent does NOT echo
        // user messages via SSE, so this is the only confirmation we get.
        if (params.idempotencyKey && onMessageAccepted) {
          onMessageAccepted(
            activeSessionKeyRef.current,
            resolvedFriendlyId,
            params.idempotencyKey,
          )
        }

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('No response body')
        }

        const decoder = new TextDecoder()
        let buffer = ''

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Guard against stale streams writing into a newer session.
          // If startStreaming was called again, streamGenerationRef has been
          // bumped; this loop is now for an aborted/superseded stream and
          // must not dispatch events. See #297.
          if (streamGenerationRef.current !== myGeneration) {
            try {
              await reader.cancel()
            } catch {
              // Reader may already be closed; safe to ignore.
            }
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''

          for (const eventBlock of events) {
            if (!eventBlock.trim()) continue

            // Re-check between events as well — a single read() can yield a
            // batch of buffered events; if a new stream started mid-batch,
            // the rest of this batch must be dropped.
            if (streamGenerationRef.current !== myGeneration) break

            const lines = eventBlock.split('\n')
            let currentEvent = ''
            let currentData = ''

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim()
              } else if (line.startsWith('data: ')) {
                currentData += line.slice(6)
              } else if (line.startsWith('data:')) {
                currentData += line.slice(5)
              }
            }

            if (!currentEvent || !currentData) continue
            try {
              processEvent(currentEvent, JSON.parse(currentData))
            } catch {
              // Ignore invalid SSE data.
            }
          }
        }

        const lifecyclePhase = lifecyclePhaseRef.current as StreamLifecyclePhase
        {
          // Natural HTTP stream close. If any assistant text already streamed,
          // finalize regardless of phase: a gateway that closes the connection
          // without an explicit `done`/`close` SSE event (e.g. upstream drop
          // after partial output) would otherwise strand the UI on "Thinking…"
          // until the 120s/300s no-activity timeout, forcing a manual refresh
          // (Bug 5 "no update until refresh" + Bug 6 lingering thinking bubble).
          if (fullTextRef.current || lifecyclePhase !== 'handoff') {
            finishStream()
          } else {
            // Server closed the stream (done=true) while in handoff with no
            // streamed text — the run finished on the server side. The answer
            // is already in session history. Do NOT call finishStream() (it
            // would commit an empty assistant message). Instead do a lightweight
            // clear so the thinking bubble and composer animation stop
            // immediately without waiting for the 300s handoff timeout.
            finishedRef.current = true
            eventSourceRef.current = null
            lifecyclePhaseRef.current = 'complete'
            clearHandoffTimer()
            clearSendStreamRun()
            stopFrame()
            setState((prev) => ({ ...prev, isStreaming: false }))
            // Notify the parent so waitingForResponse is cleared. The
            // message arg is unused by the chat-screen onComplete handler;
            // we pass a minimal placeholder to satisfy the type.
            onComplete?.({
              role: 'assistant',
              content: [{ type: 'text', text: '' }],
              timestamp: Date.now(),
              __streamingStatus: 'complete',
            })
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          eventSourceRef.current = null
          clearHandoffTimer()
          clearSendStreamRun()
          setState((prev) => ({
            ...prev,
            isStreaming: false,
          }))
          onAbort?.()
          return
        }
        const errorMessage = err instanceof Error ? err.message : String(err)
        markFailed(errorMessage)
      }
    },
    [
      clearHandoffTimer,
      clearSendStreamRun,
      finishStream,
      markAccepted,
      markFailed,
      onAbort,
      onComplete,
      onMessageAccepted,
      onSessionResolved,
      processEvent,
      resetActiveStreamState,
      schedulePostAcceptanceTimeout,
      stopFrame,
    ],
  )

  const cancelStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.abort()
      eventSourceRef.current = null
    }
    finishedRef.current = true
    resetActiveStreamState()
  }, [resetActiveStreamState])

  const resetStreaming = useCallback(() => {
    cancelStreaming()
    setState({
      isStreaming: false,
      streamingMessageId: null,
      streamingText: '',
      error: null,
    })
  }, [cancelStreaming])

  return {
    ...state,
    startStreaming,
    cancelStreaming,
    resetStreaming,
  }
}
