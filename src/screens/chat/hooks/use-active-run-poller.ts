import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

import { isRecoverableActiveRun } from './use-active-run-check'
import { verbForTool } from '../chat-screen-utils'
import type { ActiveSendRecord } from './use-send-message-state'

/**
 * Two pollers that run while the chat is waiting for a response. Both hit
 * `/api/sessions/:key/active-run` on an interval and were extracted verbatim
 * from chat-screen.tsx (Seam #2, PR #298). Pure move — no behavior change.
 *
 *  1. Active-run completion poller (5s): clears stale waiting state when the
 *     server confirms no recoverable run and this tab has no local activity.
 *  2. Live-progress display poller (3s): derives a short human label describing
 *     what the agent is currently doing. DISPLAY ONLY.
 */
export function useActiveRunPoller(params: {
  waitingForResponse: boolean
  resolvedSessionKey: string
  activeSendRef: RefObject<ActiveSendRecord | null>
  activeRealtimeStreamingRef: RefObject<boolean>
  streamFinish: () => void
  refreshHistoryRef: RefObject<() => void>
}): {
  liveProgressLabel: string
} {
  const {
    waitingForResponse,
    resolvedSessionKey,
    activeSendRef,
    activeRealtimeStreamingRef,
    streamFinish,
    refreshHistoryRef,
  } = params

  // Issue #43 polling fallback: when waiting but SSE hasn't reconnected,
  // poll the active-run endpoint every 5s to detect completion.
  useEffect(() => {
    if (!waitingForResponse || !resolvedSessionKey) return
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(resolvedSessionKey)}/active-run`,
        )
        if (!res.ok) return
        const data = await res.json()
        if (!data.ok) return
        const hasLocalRuntimeActivity =
          Boolean(activeSendRef.current) || activeRealtimeStreamingRef.current
        // A persisted waiting flag can survive refresh/gateway restart after the
        // actual run has disappeared. Once the server confirms there is no
        // recoverable run and this tab has no local send/stream, clear the stale
        // waiting state instead of letting the thinking bubble self-perpetuate.
        if (!isRecoverableActiveRun(data.run) && !hasLocalRuntimeActivity) {
          streamFinish()
          refreshHistoryRef.current()
        }
      } catch {
        // ignore network errors
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [waitingForResponse, resolvedSessionKey, streamFinish])

  // Live progress: while waiting, poll the gateway run and surface a short
  // human summary of what the agent is doing (a tool in flight, tools done, or
  // an assistant-text tail) in the thinking bubble. DISPLAY ONLY — never clears
  // the waiting state. Skips updates while live text is already streaming in.
  const [liveProgressLabel, setLiveProgressLabel] = useState('')
  useEffect(() => {
    if (!waitingForResponse || !resolvedSessionKey) {
      setLiveProgressLabel('')
      return
    }
    const ac = new AbortController()
    const poll = async () => {
      // Always poll while waiting. The thinking bubble that shows this label is
      // already hidden once real assistant text streams in (showTypingIndicator
      // goes false), so we don't need to gate on streaming state here — gating
      // on it made the label go stale during the silent tool phase while the
      // bubble was still visible.
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(resolvedSessionKey)}/active-run`,
          { signal: ac.signal },
        )
        if (!res.ok) return
        const data = await res.json()
        if (ac.signal.aborted || !data.ok || !data.run) return
        const run = data.run
        const tools: Array<{
          name?: string
          phase?: string
          preview?: string
        }> = Array.isArray(run.toolCalls) ? run.toolCalls : []
        const inFlight = [...tools]
          .reverse()
          .find((t) => t.phase === 'calling' || t.phase === 'running')
        let label = ''
        if (inFlight) {
          label = verbForTool(inFlight.name ?? '')
          // Gateway previews can lead with an emoji/symbol (e.g. "🔎 *");
          // strip leading non-word chars and cap length for a tidy label.
          const preview = (inFlight.preview ?? '')
            .replace(/^[^\p{L}\p{N}/.~_-]+/u, '')
            .replace(/\s+/g, ' ')
            .trim()
          if (preview && preview !== inFlight.name) {
            label = `${label}: ${preview.length > 48 ? `${preview.slice(0, 48)}…` : preview}`
          }
        } else {
          const done = tools.filter(
            (t) =>
              t.phase === 'complete' ||
              t.phase === 'done' ||
              t.phase === 'result',
          ).length
          if (done > 0) {
            label = `Ran ${done} ${done === 1 ? 'tool' : 'tools'}…`
          } else if (
            typeof run.assistantText === 'string' &&
            run.assistantText.trim()
          ) {
            const tail = run.assistantText.trim().replace(/\s+/g, ' ')
            label = tail.length > 80 ? `…${tail.slice(-80)}` : tail
          }
        }
        // Already returned above if aborted; no await since, so safe to set.
        setLiveProgressLabel(label)
      } catch {
        // ignore network/abort errors
      }
    }
    void poll()
    const interval = window.setInterval(poll, 3000)
    return () => {
      ac.abort()
      window.clearInterval(interval)
    }
  }, [waitingForResponse, resolvedSessionKey])

  return { liveProgressLabel }
}
