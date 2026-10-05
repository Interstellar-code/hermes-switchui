/**
 * ConductorLiveContext — the layout opens ONE per-run EventSource and shares
 * its events with the node panel and the run inspector drawer.
 */
import { createContext, useContext } from 'react'
import type { WorkflowSseEvent } from '@/screens/workflows/use-workflow-events'

export interface ConductorLive {
  /** Run the stream belongs to (null when no run is focused). */
  runId: string | null
  events: Array<WorkflowSseEvent>
  status: 'idle' | 'connecting' | 'open' | 'error' | 'closed'
}

export const ConductorLiveContext = createContext<ConductorLive>({
  runId: null,
  events: [],
  status: 'idle',
})

export const useConductorLiveContext = () => useContext(ConductorLiveContext)
