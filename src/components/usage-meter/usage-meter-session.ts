'use client'

const STORAGE_KEY = 'clawsuite-usage-meter-session-alerts'

type UsageMeterSessionAlertState = Record<string, Record<string, boolean>>

function readState(): UsageMeterSessionAlertState {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as UsageMeterSessionAlertState | null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveState(state: UsageMeterSessionAlertState): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // noop
  }
}

function routeFallbackKey(): string {
  if (typeof window === 'undefined') return 'global'
  const path = window.location.pathname || '/'
  const match = path.match(/^\/chat\/([^/?#]+)/)
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  return path
}

export function usageMeterAlertSessionKey(
  sessionKey: string | null | undefined,
): string {
  if (typeof sessionKey === 'string' && sessionKey.trim()) {
    return sessionKey.trim()
  }
  return routeFallbackKey()
}

export function registerUsageMeterSessionAlert(
  sessionKey: string | null | undefined,
  threshold: number,
): boolean {
  const key = usageMeterAlertSessionKey(sessionKey)
  const state = readState()
  const thresholdKey = String(threshold)
  const sessionState = state[key] ?? {}
  if (sessionState[thresholdKey]) {
    return false
  }
  state[key] = { ...sessionState, [thresholdKey]: true }
  saveState(state)
  return true
}
