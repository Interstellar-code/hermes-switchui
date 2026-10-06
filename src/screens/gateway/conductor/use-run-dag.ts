import { useMemo } from 'react'
import { buildDag } from './dag-model'
import { useRunSessions } from './use-conductor-queries'
import { useRunDefinition } from '@/screens/workflows/run-definition-client'
import {
  useWorkflowFeatures,
  useWorkflowParsed,
  useWorkflowRun,
} from '@/screens/workflows/use-workflows'

/**
 * Definition skeleton + node_run overlay for one run (canvas, strip and node
 * panel share it). A pinned run (feature `definition_pin`) is drawn from the
 * definition it started with, so later YAML edits never reshape it; RESUME
 * node ids come from this DAG. Falls back to the current definition when the
 * pin is unavailable or its YAML does not parse.
 */
export function useRunDag(runId: string | null) {
  const runQ = useWorkflowRun(runId)
  const run = runQ.data?.run ?? null
  const workflowId = run?.workflow_id ?? null
  const features = useWorkflowFeatures().data?.features
  const pinOn =
    !!run?.definition_checksum && !!features?.includes('definition_pin')
  const pinQ = useRunDefinition(runId, pinOn)
  const pinned = pinQ.data?.available ? pinQ.data.parsed : null
  const parsedQ = useWorkflowParsed(workflowId)
  const pinPending = pinOn && pinQ.isLoading
  const parsed = pinPending ? undefined : (pinned ?? parsedQ.data?.parsed)
  const nodeRuns = runQ.data?.nodeRuns
  const sessionsQ = useRunSessions(runId)
  const runSessions = sessionsQ.data?.data ?? null
  const dag = useMemo(
    () => (parsed ? buildDag(parsed, nodeRuns, runSessions) : null),
    [parsed, nodeRuns, runSessions],
  )
  return {
    run,
    workflowId,
    parsed: parsed ?? null,
    dag,
    isLoading:
      runQ.isLoading ||
      pinPending ||
      (workflowId != null && !pinned && parsedQ.isLoading),
    isError: runQ.isError || (!pinned && parsedQ.isError),
  }
}
