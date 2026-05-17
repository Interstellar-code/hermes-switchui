/**
 * RunDetailPanel — shows status, phase timeline, node runs, and live SSE events
 * for a single workflow run. Opened by the LaunchWizard after a successful launch.
 */
import { useState } from 'react'
import { useApproveRun, useCancelRun, useWorkflowRun } from './use-workflows'
import { useWorkflowEvents } from './use-workflow-events'
import type { NodeRunRow, WorkflowArtifactRef } from './api-client'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function relTime(ts: number | string | Date | null | undefined): string {
  if (ts == null) return '—'
  const ms =
    typeof ts === 'number'
      ? ts * (ts < 1e12 ? 1000 : 1)
      : new Date(ts).getTime()
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  return `${Math.round(diff / 3600)}h ago`
}

function shortId(id: string | null | undefined): string {
  if (!id) return '—'
  return id.slice(0, 8)
}

function parseArtifactRefs(
  raw: NodeRunRow['artifact_refs'],
): Array<WorkflowArtifactRef> {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is WorkflowArtifactRef =>
            !!item && typeof item === 'object',
        )
      : []
  } catch {
    return []
  }
}

function TaskCell({ nodeRun }: { nodeRun: NodeRunRow }) {
  if (nodeRun.kanban_task_id) {
    return (
      <span className="wfrd-task-pill" title={nodeRun.kanban_task_id}>
        KANBAN · {shortId(nodeRun.kanban_task_id)}
      </span>
    )
  }
  const label =
    nodeRun.status === 'pending'
      ? 'not dispatched'
      : ['bash', 'script', 'loop', 'approval', 'cancel'].includes(
            nodeRun.node_type,
          )
        ? 'local/control'
        : 'no task link'
  return <span className="wfrd-task-empty">{label}</span>
}

function ArtifactRefs({ nodeRun }: { nodeRun: NodeRunRow }) {
  const refs = parseArtifactRefs(nodeRun.artifact_refs)
  if (refs.length === 0) return <span style={{ opacity: 0.4 }}>—</span>
  return (
    <div className="wfrd-artifacts">
      {refs.slice(0, 3).map((ref, index) => {
        const label =
          ref.label ??
          ref.path ??
          ref.url ??
          ref.type ??
          `artifact ${index + 1}`
        const href = ref.url ?? (ref.path ? `file://${ref.path}` : undefined)
        return href ? (
          <a
            key={`${label}-${index}`}
            href={href}
            className="wfrd-artifact"
            title={href}
          >
            {label}
          </a>
        ) : (
          <span
            key={`${label}-${index}`}
            className="wfrd-artifact"
            title={ref.path}
          >
            {label}
          </span>
        )
      })}
      {refs.length > 3 && (
        <span className="wfrd-artifact-more">+{refs.length - 3}</span>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    pending: '#ffb454',
    running: '#00ff41',
    paused: '#5ad3ff',
    completed: '#4caf82',
    failed: '#ff6b6b',
    cancelled: '#888',
    ready: '#00ff41',
    skipped: '#888',
  }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        border: `1px solid ${color[status] ?? '#888'}`,
        color: color[status] ?? '#888',
        background: 'transparent',
      }}
    >
      {status}
    </span>
  )
}

interface Props {
  runId: string
  onClose: () => void
}

export function RunDetailPanel({ runId, onClose }: Props) {
  const { data, isLoading, isError, refetch } = useWorkflowRun(runId)
  const cancelMutation = useCancelRun(runId)
  const approveMutation = useApproveRun(runId)
  const [approvalText, setApprovalText] = useState('')

  // SSE feed — conversation_id comes from the run once loaded
  const conversationId = data?.run.conversation_id ?? null
  const { events: sseEvents } = useWorkflowEvents(conversationId)

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="wfrd-panel">
        <div className="wfrd-skeleton">
          <span
            style={{
              opacity: 0.4,
              fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
              fontSize: 12,
            }}
          >
            Loading run…
          </span>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="wfrd-panel">
        <div className="wfrd-error-pane">
          <span style={{ color: '#ff6b6b', fontSize: 13 }}>
            Failed to load run {shortId(runId)}
          </span>
          <button
            className="wfrd-btn"
            onClick={() => void refetch()}
            style={{ marginLeft: 12 }}
          >
            Retry
          </button>
          <button
            className="wfrd-btn wfrd-btn--ghost"
            onClick={onClose}
            style={{ marginLeft: 8 }}
          >
            ← Back
          </button>
        </div>
      </div>
    )
  }

  const { run, nodeRuns, phaseTransitions } = data
  const isTerminal = TERMINAL_STATUSES.has(run.status)
  const last20Events = sseEvents.slice(-20)
  const pendingApprovalNode =
    run.status === 'paused'
      ? nodeRuns.find((nr) => nr.status === 'paused' && nr.approval_message)
      : undefined

  return (
    <div className="wfrd-panel">
      {/* ── Header ── */}
      <div className="wfrd-header">
        <div className="wfrd-header-left">
          <span className="wfrd-run-id">run:{shortId(run.id)}</span>
          <StatusBadge status={run.status} />
          <span className="wfrd-phase-pill">{run.current_phase}</span>
        </div>
        <div className="wfrd-header-right">
          {!isTerminal && (
            <button
              className="wfrd-btn wfrd-btn--danger"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel run'}
            </button>
          )}
          <button
            className="wfrd-btn wfrd-btn--ghost"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="wfrd-body">
        {/* ── Approval card ── */}
        {pendingApprovalNode && (
          <section
            className="wfrd-section"
            style={{
              border: '1px solid #ffb454',
              borderRadius: 4,
              padding: 12,
              background: 'rgba(255, 180, 84, 0.06)',
            }}
          >
            <div className="wfrd-section-title" style={{ color: '#ffb454' }}>
              Approval Required · {pendingApprovalNode.dag_node_id}
            </div>
            <div
              style={{
                fontSize: 13,
                margin: '8px 0 12px',
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
              }}
            >
              {pendingApprovalNode.approval_message}
            </div>
            <textarea
              value={approvalText}
              onChange={(e) => setApprovalText(e.target.value)}
              placeholder="Optional response / reason…"
              rows={2}
              disabled={approveMutation.isPending}
              style={{
                width: '100%',
                fontSize: 12,
                fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
                background: 'transparent',
                color: 'inherit',
                border: '1px solid #444',
                borderRadius: 3,
                padding: 6,
                marginBottom: 8,
                resize: 'vertical',
              }}
            />
            {approveMutation.isError && (
              <div style={{ color: '#ff6b6b', fontSize: 12, marginBottom: 8 }}>
                {approveMutation.error.message}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="wfrd-btn"
                disabled={approveMutation.isPending}
                onClick={() =>
                  approveMutation.mutate(
                    {
                      node_run_id: pendingApprovalNode.id,
                      decision: 'approved',
                      response: approvalText,
                    },
                    { onSuccess: () => setApprovalText('') },
                  )
                }
                style={{ borderColor: '#4caf82', color: '#4caf82' }}
              >
                {approveMutation.isPending ? 'Sending…' : 'Approve'}
              </button>
              <button
                className="wfrd-btn wfrd-btn--danger"
                disabled={approveMutation.isPending}
                onClick={() =>
                  approveMutation.mutate(
                    {
                      node_run_id: pendingApprovalNode.id,
                      decision: 'rejected',
                      response: approvalText,
                    },
                    { onSuccess: () => setApprovalText('') },
                  )
                }
              >
                {approveMutation.isPending ? 'Sending…' : 'Reject'}
              </button>
            </div>
          </section>
        )}

        {/* ── Phase timeline ── */}
        <section className="wfrd-section">
          <div className="wfrd-section-title">Phase Timeline</div>
          {phaseTransitions.length === 0 ? (
            <div className="wfrd-empty">No phase transitions yet.</div>
          ) : (
            <ol className="wfrd-phase-list">
              {phaseTransitions.map((pt) => (
                <li key={pt.id} className="wfrd-phase-item">
                  <span className="wfrd-phase-arrow">
                    {pt.from_phase ? `${pt.from_phase} → ` : ''}
                    <strong>{pt.to_phase}</strong>
                  </span>
                  <span className="wfrd-phase-meta">
                    via <em>{pt.decided_by}</em> · {relTime(pt.at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ── Node runs table ── */}
        <section className="wfrd-section">
          <div className="wfrd-section-title">Node Runs</div>
          {nodeRuns.length === 0 ? (
            <div className="wfrd-empty">
              No nodes yet — execute phase hasn't materialised any nodes.
            </div>
          ) : (
            <div className="wfrd-table-wrap">
              <table className="wfrd-table">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Status</th>
                    <th>Hermes Task</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Artifacts</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {nodeRuns.map((nr) => (
                    <tr key={nr.id}>
                      <td className="wfrd-mono">{nr.dag_node_id}</td>
                      <td>
                        <StatusBadge status={nr.status} />
                      </td>
                      <td>
                        <TaskCell nodeRun={nr} />
                      </td>
                      <td>{relTime(nr.started_at)}</td>
                      <td>{relTime(nr.completed_at)}</td>
                      <td>
                        <ArtifactRefs nodeRun={nr} />
                      </td>
                      <td className="wfrd-summary">
                        {nr.summary ? (
                          nr.summary.length > 80 ? (
                            <details style={{ cursor: 'pointer' }}>
                              <summary
                                style={{ listStyle: 'none', outline: 'none' }}
                              >
                                {nr.summary.slice(0, 80)}&hellip;
                              </summary>
                              <pre
                                style={{
                                  margin: '4px 0 0',
                                  whiteSpace: 'pre-wrap',
                                  fontSize: 11,
                                  opacity: 0.85,
                                }}
                              >
                                {nr.summary}
                              </pre>
                            </details>
                          ) : (
                            nr.summary
                          )
                        ) : (
                          <span style={{ opacity: 0.4 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Live events feed ── */}
        <section className="wfrd-section">
          <div className="wfrd-section-title">
            Live Events{' '}
            {conversationId && <span className="wfrd-phase-pill">SSE</span>}
          </div>
          {last20Events.length === 0 ? (
            <div className="wfrd-empty">
              {conversationId
                ? 'Waiting for events…'
                : 'No conversation ID yet.'}
            </div>
          ) : (
            <ol className="wfrd-events-list">
              {last20Events.map((ev, i) => (
                <li key={i} className="wfrd-event-item">
                  <span className="wfrd-event-type">{ev.type}</span>
                  <span className="wfrd-event-time">
                    {relTime(ev.receivedAt)}
                  </span>
                  <span className="wfrd-event-data">
                    {JSON.stringify(ev.data).slice(0, 120)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
