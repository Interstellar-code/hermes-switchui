import type { OfficeAgent } from '@/features/retro-office/core/types'

export function toLiveOfficeStatus(status: string): OfficeAgent['status'] {
  if (status === 'running' || status === 'thinking' || status === 'online')
    return 'working'
  if (status === 'paused' || status === 'idle' || status === 'away')
    return 'idle'
  return 'error'
}

export function resolveCrewEffectiveStatus({
  liveStatus,
  rosterStatus,
  activityBoost,
  processAlive,
  gatewayState,
  assignedTaskCount,
}: {
  liveStatus: string | null
  rosterStatus: 'online' | 'away' | 'offline' | 'unknown'
  activityBoost: number
  processAlive: boolean
  gatewayState: string
  assignedTaskCount: number
}): OfficeAgent['status'] {
  if (liveStatus) return toLiveOfficeStatus(liveStatus)
  if (rosterStatus === 'offline') return 'error'

  const hasRunnableProcess = processAlive || gatewayState === 'running'
  if (hasRunnableProcess && activityBoost >= 3) return 'working'
  if (assignedTaskCount > 0 && activityBoost >= 2) return 'working'

  return 'idle'
}
