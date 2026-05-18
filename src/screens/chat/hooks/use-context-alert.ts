import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useContextUsageStore } from '@/stores/context-usage-store'

const POLL_MS = 15_000
const STORAGE_KEY_PREFIX = 'claude-ctx-alert'
const THRESHOLDS = [90, 75] as const

type StoredState = {
  date: string
  sent: Record<'75' | '90', boolean>
}

function getTodayKeyLocal(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function emptySent(): StoredState['sent'] {
  return { '75': false, '90': false }
}

function storageKey(sessionKey: string): string {
  return sessionKey ? `${STORAGE_KEY_PREFIX}:${sessionKey}` : STORAGE_KEY_PREFIX
}

function loadStoredState(sessionKey: string): StoredState {
  const today = getTodayKeyLocal()
  if (typeof window === 'undefined') return { date: today, sent: emptySent() }
  try {
    const raw = window.sessionStorage.getItem(storageKey(sessionKey))
    if (!raw) return { date: today, sent: emptySent() }
    const parsed = JSON.parse(raw) as Partial<StoredState> | null
    if (!parsed || parsed.date !== today)
      return { date: today, sent: emptySent() }
    return {
      date: today,
      sent: {
        '75': Boolean(parsed.sent?.['75']),
        '90': Boolean(parsed.sent?.['90']),
      },
    }
  } catch {
    return { date: today, sent: emptySent() }
  }
}

function saveStoredState(state: StoredState, sessionKey: string) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(storageKey(sessionKey), JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

function readPercent(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function useContextAlert(sessionKey = ''): {
  alertOpen: boolean
  alertThreshold: number
  alertPercent: number
  dismissAlert: () => void
} {
  const storedRef = useRef<StoredState | null>(null)
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertThreshold, setAlertThreshold] = useState<number>(0)
  const [alertPercent, setAlertPercent] = useState<number>(0)

  const lastCompactionAt = useContextUsageStore((s) => s.lastCompactionAt)
  const storeContextPercent = useContextUsageStore((s) => s.contextPercent)
  const storeSessionKey = useContextUsageStore((s) => s.sessionKey)

  const dismissAlert = useCallback(() => {
    setAlertOpen(false)
  }, [])

  // Synchronously reset per-session state before any effects run for the new key.
  useLayoutEffect(() => {
    storedRef.current = null
    setAlertOpen(false)
    setAlertThreshold(0)
    setAlertPercent(0)
    if (sessionKey) {
      storedRef.current = loadStoredState(sessionKey)
    }
  }, [sessionKey])

  const checkThresholds = useCallback(
    (currentPercent: number, currentSessionKey: string) => {
      if (typeof window === 'undefined') return
      const today = getTodayKeyLocal()
      const stored = storedRef.current ?? loadStoredState(currentSessionKey)
      if (stored.date !== today) {
        stored.date = today
        stored.sent = emptySent()
        saveStoredState(stored, currentSessionKey)
      }
      storedRef.current = stored

      const candidate = THRESHOLDS.find((threshold) => {
        if (currentPercent < threshold) return false
        return !stored.sent[String(threshold) as keyof StoredState['sent']]
      })
      if (!candidate) return

      stored.sent[String(candidate) as keyof StoredState['sent']] = true
      saveStoredState(stored, currentSessionKey)

      setAlertThreshold(candidate)
      setAlertOpen(true)
    },
    [],
  )

  const refresh = useCallback(async () => {
    if (!sessionKey || sessionKey === 'new' || sessionKey === 'main') return
    try {
      const res = await fetch(
        `/api/context-usage?sessionId=${encodeURIComponent(sessionKey)}`,
      )
      if (!res.ok) return
      const data = (await res.json()) as {
        ok?: boolean
        contextPercent?: unknown
      }
      if (!data?.ok) return

      const currentPercent = readPercent(data.contextPercent)
      setAlertPercent(currentPercent)

      if (alertOpen) return
      checkThresholds(currentPercent, sessionKey)
    } catch {
      /* ignore */
    }
  }, [sessionKey, alertOpen, checkThresholds])

  useEffect(() => {
    if (typeof window === 'undefined') return
    storedRef.current = loadStoredState(sessionKey)
    if (!sessionKey || sessionKey === 'new' || sessionKey === 'main') return
    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [sessionKey, refresh])

  // React immediately when context is compressed: reset fired thresholds so
  // they can fire again on the next build-up, and update the displayed percent.
  useEffect(() => {
    if (lastCompactionAt === null) return
    const today = getTodayKeyLocal()
    const stored = storedRef.current ?? loadStoredState(sessionKey)
    stored.date = today
    stored.sent = emptySent()
    storedRef.current = stored
    saveStoredState(stored, sessionKey)
    setAlertPercent(storeContextPercent)
    setAlertOpen(false)
  }, [lastCompactionAt, storeContextPercent, sessionKey])

  // React in real-time to SSE-driven store updates (no 15s poll lag).
  // Guard: only apply when the store is keyed to this session — prevents
  // a stale session's SSE updates from polluting a freshly-switched session.
  useEffect(() => {
    if (storeSessionKey !== sessionKey) return
    if (storeContextPercent <= 0) return
    setAlertPercent((prev) => Math.max(prev, storeContextPercent))
    if (alertOpen) return
    checkThresholds(storeContextPercent, sessionKey)
  }, [storeContextPercent, storeSessionKey, sessionKey, alertOpen, checkThresholds])

  return { alertOpen, alertThreshold, alertPercent, dismissAlert }
}
