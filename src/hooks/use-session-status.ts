import { useCallback, useEffect, useRef, useState } from 'react'

export type SessionStatusPayload = {
  contextPercent: number
  model: string
  maxTokens: number
  usedTokens: number
  status: string
  sessionKey: string
  sessionLabel: string
  modelProvider: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

const EMPTY_PAYLOAD: SessionStatusPayload = {
  contextPercent: 0,
  model: '',
  maxTokens: 0,
  usedTokens: 0,
  status: 'idle',
  sessionKey: 'new',
  sessionLabel: '',
  modelProvider: '',
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

const BACKOFF_INIT_MS = 5_000
const BACKOFF_MAX_MS = 60_000
const MAX_FAILURES = 5
const POLL_MS = 15_000

/**
 * Polls /api/session-status for a given sessionKey.
 * - Exponential backoff on 5xx (5s → 60s, capped).
 * - Stops polling after MAX_FAILURES consecutive failures.
 * - Logs errors once per fail-cluster (not on every retry).
 * - Falls back to /api/context-usage if session-status returns no useful data.
 */
export function useSessionStatus(sessionKey: string | null | undefined): SessionStatusPayload {
  const [payload, setPayload] = useState<SessionStatusPayload>(EMPTY_PAYLOAD)
  const consecutiveFailures = useRef(0)
  const lastErrorLogged = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pollRef = useRef<(() => Promise<void>) | null>(null)

  const scheduleNext = useCallback((delayMs: number) => {
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void pollRef.current?.()
    }, delayMs)
  }, [])

  const poll = useCallback(async () => {
    if (consecutiveFailures.current >= MAX_FAILURES) return

    try {
      const params = sessionKey ? `?sessionKey=${encodeURIComponent(sessionKey)}` : ''
      const res = await fetch(`/api/session-status${params}`)

      if (res.ok) {
        const data = await res.json()
        const p = data?.payload ?? {}
        if (data?.ok) {
          consecutiveFailures.current = 0
          lastErrorLogged.current = ''
          setPayload({
            contextPercent: Number(p.contextPercent ?? 0),
            model: String(p.model ?? ''),
            maxTokens: Number(p.maxTokens ?? 0),
            usedTokens: Number(p.usedTokens ?? 0),
            status: String(p.status ?? 'idle'),
            sessionKey: String(p.sessionKey ?? 'new'),
            sessionLabel: String(p.sessionLabel ?? ''),
            modelProvider: String(p.modelProvider ?? ''),
            inputTokens: Number(p.inputTokens ?? 0),
            outputTokens: Number(p.outputTokens ?? 0),
            totalTokens: Number(p.totalTokens ?? 0),
          })
          scheduleNext(POLL_MS)
          return
        }
      }

      // 5xx or ok:false — apply backoff
      if (!res.ok && res.status >= 500) {
        consecutiveFailures.current += 1
        const errKey = `${res.status}`
        if (lastErrorLogged.current !== errKey) {
          console.warn(
            `[session-status] ${res.status} for session ${sessionKey ?? '—'} ` +
            `(failure ${consecutiveFailures.current}/${MAX_FAILURES})`,
          )
          lastErrorLogged.current = errKey
        }
        if (consecutiveFailures.current >= MAX_FAILURES) {
          console.warn(
            `[session-status] stopping poll for ${sessionKey ?? '—'} after ${MAX_FAILURES} failures`,
          )
          return
        }
        const backoff = Math.min(BACKOFF_INIT_MS * 2 ** (consecutiveFailures.current - 1), BACKOFF_MAX_MS)
        scheduleNext(backoff)
        return
      }

      // Non-5xx failure (e.g. 401/403) — try context-usage fallback then resume normal polling
      const fbParams = sessionKey ? `?sessionId=${encodeURIComponent(sessionKey)}` : ''
      const fbRes = await fetch(`/api/context-usage${fbParams}`)
      if (fbRes.ok) {
        const fbData = await fbRes.json()
        if (fbData.ok) {
          consecutiveFailures.current = 0
          lastErrorLogged.current = ''
          setPayload((prev) => ({
            ...prev,
            model: fbData.model ?? '',
            contextPercent: fbData.contextPercent ?? 0,
            usedTokens: fbData.usedTokens ?? 0,
            maxTokens: fbData.maxTokens ?? 0,
          }))
        }
      }
      scheduleNext(POLL_MS)
    } catch {
      consecutiveFailures.current += 1
      scheduleNext(
        Math.min(BACKOFF_INIT_MS * 2 ** (consecutiveFailures.current - 1), BACKOFF_MAX_MS),
      )
    }
  }, [sessionKey, scheduleNext])

  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  useEffect(() => {
    consecutiveFailures.current = 0
    lastErrorLogged.current = ''
    void poll()
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [poll])

  return payload
}
