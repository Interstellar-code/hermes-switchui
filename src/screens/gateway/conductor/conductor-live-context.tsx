/**
 * ConductorLiveContext — the layout opens ONE per-run EventSource and shares
 * its events with the node panel and the run inspector drawer.
 */
import { createContext, useContext } from 'react'
import type {
  SubscribeNodeLog,
  WorkflowSseEvent,
} from '@/screens/workflows/use-workflow-events'

export interface ConductorLive {
  /** Run the stream belongs to (null when no run is focused). */
  runId: string | null
  events: Array<WorkflowSseEvent>
  status: 'idle' | 'connecting' | 'open' | 'error' | 'closed'
  /** Live `node_log` chunks on the same stream (kept out of `events`). */
  subscribeNodeLog: SubscribeNodeLog
}

export const ConductorLiveContext = createContext<ConductorLive>({
  runId: null,
  events: [],
  status: 'idle',
  subscribeNodeLog: () => () => {},
})

export const useConductorLiveContext = () => useContext(ConductorLiveContext)
