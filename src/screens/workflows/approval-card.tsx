/** Shared approval card: used by the /workflows run panel and the Conductor inspector. */
import { useState } from 'react'
import './approval-card.css'
import { useApproveRun } from './use-workflows'
import type { NodeRunRow } from './api-client'

type Props = {
  runId: string
  nodeRun: NodeRunRow
  /** When the node captures the reply as its output (`<node>.output`). */
  captureResponse?: boolean
  compact?: boolean
}

export function ApprovalCard({
  runId,
  nodeRun,
  captureResponse,
  compact,
}: Props) {
  const approve = useApproveRun(runId)
  const [reply, setReply] = useState('')
  const decide = (decision: 'approved' | 'rejected') =>
    // Approver is stamped server-side ("switchui"); UI-side it is self-reported.
    approve.mutate(
      { node_run_id: nodeRun.id, decision, response: reply },
      { onSuccess: () => setReply('') },
    )
  const label = captureResponse
    ? `Reply · captured as ${nodeRun.dag_node_id}.output`
    : 'Reply'
  return (
    <section className={compact ? 'wfac wfac--compact' : 'wfac'}>
      <div className="wfac-title">
        Approval Required · {nodeRun.dag_node_id}
      </div>
      <div className="wfac-msg">
        {nodeRun.approval_message || 'Approval required'}
      </div>
      <label htmlFor={`wfac-reply-${nodeRun.id}`} className="wfac-label">
        {label}
      </label>
      <textarea
        id={`wfac-reply-${nodeRun.id}`}
        className="wfac-reply"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="Reply to the prompt above, e.g. skip or 1,3,7"
        rows={compact ? 2 : 3}
        disabled={approve.isPending}
      />
      {approve.isError && (
        <div className="wfac-error">{approve.error.message}</div>
      )}
      <div className="wfac-actions">
        <button
          className="wfrd-btn wfac-approve"
          disabled={approve.isPending}
          onClick={() => decide('approved')}
        >
          {approve.isPending ? 'Sending…' : 'Approve'}
        </button>
        <button
          className="wfrd-btn wfrd-btn--danger"
          disabled={approve.isPending}
          onClick={() => decide('rejected')}
        >
          {approve.isPending ? 'Sending…' : 'Reject'}
        </button>
        <span className="wfac-hint">
          reply is optional · approver self-reported
        </span>
      </div>
    </section>
  )
}
