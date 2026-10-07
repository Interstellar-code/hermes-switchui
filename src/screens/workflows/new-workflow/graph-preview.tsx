/**
 * Read-only graph previews for the create wizard. Reuses the Conductor
 * FlowCanvas in `preview` mode (pattern: conductor-idle.tsx). The wrapper
 * carries data-screen="conductor" because the canvas styles are scoped to it.
 */
import { Suspense, useMemo } from 'react'
import { useWorkflowParsed } from '../use-workflows'
import { yamlToParsedWorkflow } from './yaml-lint'
import type { ParsedWorkflow } from '../types'
import { buildDag } from '@/screens/gateway/conductor/dag-model'
import {
  FlowCanvas,
  graphLoading,
} from '@/screens/gateway/conductor/mission-canvas'

interface GraphProps {
  parsed: ParsedWorkflow | null
  label: string
  loading?: boolean
  failed?: boolean
}

export function GraphPreview({ parsed, label, loading, failed }: GraphProps) {
  const dag = useMemo(() => (parsed ? buildDag(parsed) : null), [parsed])
  return (
    <div
      className="wz2-graph"
      data-screen="conductor"
      role="region"
      aria-label={`Graph preview, read-only: ${label}`}
    >
      {dag && dag.nodes.length > 0 ? (
        <Suspense fallback={graphLoading}>
          <FlowCanvas key={label} dag={dag} workflowId={null} preview />
        </Suspense>
      ) : loading ? (
        <div className="wfl-skeletons" aria-label="Loading graph">
          <div className="wfl-skeleton" style={{ width: '60%' }} />
          <div className="wfl-skeleton" style={{ width: '40%' }} />
          <div className="wfl-skeleton" style={{ width: '75%' }} />
        </div>
      ) : (
        <div className="wz2-graph-empty">
          {failed ? 'Couldn’t load this graph.' : 'No graph to show yet.'}
        </div>
      )}
    </div>
  )
}

/** Graph of an already-saved workflow (template / duplicate pickers). */
export function SavedGraphPreview({ id }: { id: string }) {
  const q = useWorkflowParsed(id)
  return (
    <GraphPreview
      parsed={q.data?.parsed ?? null}
      label={id}
      loading={q.isLoading}
      failed={q.isError}
    />
  )
}

/** Graph of the in-progress draft YAML. */
export function DraftGraphPreview({
  yaml,
  label,
}: {
  yaml: string
  label: string
}) {
  const parsed = useMemo(() => yamlToParsedWorkflow(yaml), [yaml])
  return <GraphPreview parsed={parsed} label={label} />
}
