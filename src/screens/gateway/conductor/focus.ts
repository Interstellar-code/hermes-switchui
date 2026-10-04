/**
 * focus.ts — what the Conductor canvas shows (D2):
 * explicit selection > newest live > newest waiting > idle preview.
 */
import type { Mission } from '@/server/conductor-store'

export type CanvasFocus =
  | { kind: 'run'; runId: string; reason: 'selected' | 'live' | 'waiting' }
  | { kind: 'preview'; workflowId: string }
  | { kind: 'empty' }

function newest(
  missions: Array<Mission>,
  status: Mission['status'],
): Mission | undefined {
  return missions
    .filter((m) => m.status === status)
    .reduce<
      Mission | undefined
    >((best, m) => (!best || m.createdAt > best.createdAt ? m : best), undefined)
}

export function selectFocus({
  selectedRunId,
  missions,
  nextScheduled,
}: {
  selectedRunId: string | null
  missions: Array<Mission>
  /** Next scheduled workflow for the idle preview; null when none. */
  nextScheduled: { workflowId: string } | null
}): CanvasFocus {
  // A just-launched run is selected before the next poll lists it — honour it anyway.
  if (selectedRunId)
    return { kind: 'run', runId: selectedRunId, reason: 'selected' }
  const live = newest(missions, 'live')
  if (live) return { kind: 'run', runId: live.id, reason: 'live' }
  const waiting = newest(missions, 'waiting')
  if (waiting) return { kind: 'run', runId: waiting.id, reason: 'waiting' }
  if (nextScheduled)
    return { kind: 'preview', workflowId: nextScheduled.workflowId }
  return { kind: 'empty' }
}
