import { useMemo } from 'react'
import { buildDag } from './dag-model'
import { useRunSessions } from './use-conductor-queries'
import {
  useWorkflowParsed,
  useWorkflowRun,
} from '@/screens/workflows/use-workflows'

/** Definition skeleton + node_run overlay for one run (canvas and strip share it). */
export function useRunDag(runId: string | null) {
  const runQ = useWorkflowRun(runId)
  const workflowId = runQ.data?.run.workflow_id ?? null
  const parsedQ = useWorkflowParsed(workflowId)
  const parsed = parsedQ.data?.parsed
  const nodeRuns = runQ.data?.nodeRuns
  const sessionsQ = useRunSessions(runId)
  const runSessions = sessionsQ.data?.data ?? null
  const dag = useMemo(
    () => (parsed ? buildDag(parsed, nodeRuns, runSessions) : null),
    [parsed, nodeRuns, runSessions],
  )
  return {
    run: runQ.data?.run ?? null,
    workflowId,
    dag,
    isLoading: runQ.isLoading || (workflowId != null && parsedQ.isLoading),
    isError: runQ.isError || parsedQ.isError,
  }
}
