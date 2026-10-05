/**
 * use-conductor-live.ts — SSE for the selected run only (D9: no global SSE).
 *
 * Live node/workflow events invalidate the run detail and the missions
 * snapshot, throttled to at most one invalidation per second.
 */
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WorkflowSseEvent } from '@/screens/workflows/use-workflow-events'
import { useWorkflowEvents } from '@/screens/workflows/use-workflow-events'

export const LIVE_INVALIDATE_MS = 1000

const RELEVANT = /^(node_|workflow_|loop_iteration_|approval_|subgraph_)/

export function useConductorLive(selectedRunId: string | null) {
  const { events, status, subscribeNodeLog } = useWorkflowEvents(
    selectedRunId,
    {
      skipReplayed: true,
    },
  )
  const queryClient = useQueryClient()
  const lastSeen = useRef<WorkflowSseEvent | null>(null)
  const lastFired = useRef(0)
  const seenRun = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [selectedRunId])

  useEffect(() => {
    if (seenRun.current !== selectedRunId) {
      // Run switched: `events` is still the previous run's buffer for this
      // render. Mark its tail as seen so it is never rescanned.
      seenRun.current = selectedRunId
      lastFired.current = 0
      lastSeen.current = events.at(-1) ?? null
      return
    }
    if (!selectedRunId || events.length === 0) return
    const from = lastSeen.current ? events.indexOf(lastSeen.current) + 1 : 0
    lastSeen.current = events[events.length - 1]
    if (!events.slice(from).some((e) => RELEVANT.test(e.type))) return

    const fire = () => {
      timer.current = null
      lastFired.current = Date.now()
      void queryClient.invalidateQueries({
        queryKey: ['workflow-runs', selectedRunId],
      })
      void queryClient.invalidateQueries({
        queryKey: ['conductor', 'missions'],
      })
    }
    const wait = lastFired.current + LIVE_INVALIDATE_MS - Date.now()
    if (wait <= 0) fire()
    else timer.current ??= setTimeout(fire, wait)
  }, [events, selectedRunId, queryClient])

  return { events, status, subscribeNodeLog }
}
