import type { OfficeAgent } from '@/features/retro-office/core/types'

export function toLiveOfficeStatus(status: string): OfficeAgent['status'] {
  if (status === 'running' || status === 'thinking' || status === 'online')
    return 'working'
  if (status === 'paused' || status === 'idle' || status === 'away')
    return 'idle'
  return 'error'
}

/**
 * Status for a crew profile with no own-db / delegated signal: a live gateway
 * session decides; otherwise idle (or error when the profile is missing).
 * Log-substring and counter-delta scoring were removed — they flagged agents
 * as working because their name appeared in a log line.
 */
export function resolveCrewEffectiveStatus({
  liveStatus,
  rosterStatus,
}: {
  liveStatus: string | null
  rosterStatus: 'online' | 'away' | 'offline' | 'unknown'
}): OfficeAgent['status'] {
  if (liveStatus) return toLiveOfficeStatus(liveStatus)
  if (rosterStatus === 'offline') return 'error'
  return 'idle'
}
