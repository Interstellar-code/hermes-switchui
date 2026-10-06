import { ApprovalCard } from '../approval-card'
import { runDurationMs } from '../run-status'
import { useChildRuns } from '../use-workflows'
import {
  fmtClockDuration,
  fmtDateTime,
  fmtDuration,
  fmtTime,
  phaseSegments,
  runtimeLimitText,
  triggerText,
  usageCoverage,
} from './inspector-model'
import type { ReactNode } from 'react'
import type { InspectorCtx } from './inspector-model'

function Row({
  k,
  children,
  na,
  tone,
}: {
  k: string
  children: ReactNode
  na?: boolean
  tone?: 'err' | 'ok'
}) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={na ? 'na' : tone ? `t-${tone}` : undefined}>{children}</dd>
    </>
  )
}

const dash = (v: string | null | undefined, empty: string) =>
  v ? { v, na: false } : { v: empty, na: true }

export function OverviewTab({
  ctx,
  extra,
}: {
  ctx: InspectorCtx
  extra?: ReactNode
}) {
  const {
    run,
    nodeRuns,
    phaseTransitions,
    onOpenNode,
    onOpenRun,
    runId,
    features,
  } = ctx
  const children = useChildRuns(runId, features.includes('parent_run')).data
  const meta = run.metadata ?? {}
  const trigger = (meta.trigger ?? {}) as Record<string, unknown>
  const pause = meta.pause as { captureResponse?: boolean } | undefined
  const inputs = Object.entries((meta.inputs ?? {}) as Record<string, unknown>)
  const failedNode = nodeRuns.find(
    (n) => n.status === 'failed' && n.loop_iteration == null,
  )
  const approvalNode =
    run.status === 'paused'
      ? nodeRuns.find(
          (nr) =>
            nr.status === 'paused' &&
            nr.loop_iteration == null &&
            (nr.approval_message || nr.node_type === 'approval'),
        )
      : undefined
  const segments = phaseSegments(phaseTransitions, run.status)
  const totalMs = segments.reduce((s, p) => s + (p.durationMs ?? 0), 0)
  const cov = usageCoverage(nodeRuns)
  const usage = run.usage
  const duration = runDurationMs(run)
  const cron = (trigger.cron_job_id ??
    trigger.job_id ??
    trigger.schedule_id) as string | undefined
  // clipboard is undefined on insecure (http) origins
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const copy = (text: string) => void navigator.clipboard?.writeText(text)
  const parent = dash(run.parent_conversation_id, 'none')
  const codebase = dash(run.codebase_id, 'not set')
  const owner = dash(run.owner_session, 'not recorded')

  return (
    <div className="wfri-stack">
      {approvalNode && (
        <ApprovalCard
          runId={runId}
          nodeRun={approvalNode}
          captureResponse={!!pause?.captureResponse}
        />
      )}

      {run.status === 'failed' && (run.error || failedNode?.error) && (
        <div className="wfri-errb" role="alert">
          <div className="wfri-errb-h">
            <span>
              Run failed
              {failedNode ? ` at node ${failedNode.dag_node_id}` : ''}
            </span>
            {failedNode && onOpenNode && (
              <button
                type="button"
                className="wfri-btn wfri-btn--err"
                onClick={() => onOpenNode(failedNode.dag_node_id)}
              >
                OPEN NODE
              </button>
            )}
          </div>
          <pre>{failedNode?.error ?? run.error}</pre>
        </div>
      )}

      <section>
        <div className="wfri-sec">PHASES · from phase-transitions</div>
        {segments.length === 0 ? (
          <div className="wfri-empty">No phase transitions recorded.</div>
        ) : (
          <>
            <div
              className="wfri-phases"
              role="img"
              aria-label="Phase durations"
            >
              {segments.map((p) => (
                <div
                  key={`${p.phase}-${p.startMs}`}
                  className={`wfri-phase t-${p.tone}`}
                  style={{
                    flexGrow: Math.max(
                      totalMs > 0 ? (p.durationMs ?? 0) / totalMs : 1,
                      0.12,
                    ),
                  }}
                >
                  {p.phase.toUpperCase()}
                  {p.tone === 'err' ? ' · failed' : ''}
                </div>
              ))}
            </div>
            <ul className="wfri-phase-rows">
              {segments.map((p) => (
                <li key={`${p.phase}-${p.startMs}`}>
                  <b className={`t-${p.tone}`}>{p.phase.toUpperCase()}</b>{' '}
                  {fmtTime(p.startMs)}
                  {p.endMs != null
                    ? ` → ${fmtTime(p.endMs)} · ${fmtClockDuration(p.durationMs)}`
                    : ' → now'}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="wfri-cols">
        <section className="wfri-card">
          <div className="wfri-sec">RUN</div>
          <dl className="wfri-kv">
            <Row
              k="status"
              tone={
                run.status === 'failed'
                  ? 'err'
                  : run.status === 'completed'
                    ? 'ok'
                    : undefined
              }
            >
              {run.status}
            </Row>
            <Row k="started">{fmtDateTime(run.started_at)}</Row>
            <Row k="finished" na={run.completed_at == null}>
              {run.completed_at == null
                ? 'not finished'
                : fmtDateTime(run.completed_at)}
            </Row>
            <Row k="last heartbeat" na={run.last_heartbeat == null}>
              {run.last_heartbeat == null
                ? 'none'
                : fmtTime(run.last_heartbeat)}
            </Row>
            <Row k="duration" na={duration == null}>
              {fmtDuration(duration)}
            </Row>
            <Row k="current phase">{run.current_phase}</Row>
            {run.retry_epoch != null && (
              <Row k="retries" na={run.retry_epoch === 0}>
                {run.retry_epoch > 0
                  ? `retry #${run.retry_epoch} (resumed in place)`
                  : 'none'}
              </Row>
            )}
            <Row k="re-run of" na={!run.parent_run_id}>
              {!run.parent_run_id ? (
                'none'
              ) : onOpenRun ? (
                <button
                  type="button"
                  className="wfri-link"
                  onClick={() => onOpenRun(run.parent_run_id!)}
                >
                  run {run.parent_run_id.slice(0, 8)}
                </button>
              ) : (
                `run ${run.parent_run_id.slice(0, 8)}`
              )}
            </Row>
            {children && (
              <Row k="re-runs" na={children.length === 0}>
                {children.length === 0
                  ? 'none'
                  : children.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ', '}
                        {onOpenRun ? (
                          <button
                            type="button"
                            className="wfri-link"
                            onClick={() => onOpenRun(c.id)}
                          >
                            run {c.id.slice(0, 8)}
                          </button>
                        ) : (
                          `run ${c.id.slice(0, 8)}`
                        )}
                      </span>
                    ))}
              </Row>
            )}
            <Row k="definition" na={!run.definition_checksum}>
              {run.definition_checksum
                ? `pinned${run.definition_version != null ? ` v${run.definition_version}` : ''} · ${run.definition_checksum.slice(0, 12)}`
                : 'not pinned (current)'}
            </Row>
          </dl>
        </section>
        <section className="wfri-card">
          <div className="wfri-sec">TRIGGER &amp; LIMITS</div>
          <dl className="wfri-kv">
            <Row k="trigger">{triggerText(run)}</Row>
            <Row k="cron job" na={!cron}>
              {cron ??
                (triggerText(run) === 'manual'
                  ? 'none (manual run)'
                  : 'not recorded')}
            </Row>
            <Row k="scheduled for" na={run.scheduled_for == null}>
              {run.scheduled_for == null
                ? 'not scheduled'
                : fmtDateTime(run.scheduled_for)}
            </Row>
            <Row k="priority" na={run.priority == null}>
              {run.priority ?? 'not recorded'}
            </Row>
            <Row k="runtime limit" na={!run.max_runtime_s}>
              {runtimeLimitText(run.max_runtime_s)}
            </Row>
            <Row k="owner session" na={owner.na}>
              {owner.v}
            </Row>
          </dl>
        </section>
      </div>

      <div className="wfri-cols">
        <section className="wfri-card">
          <div className="wfri-sec">INPUTS · metadata.inputs</div>
          {inputs.length === 0 ? (
            <div className="wfri-empty">No inputs.</div>
          ) : (
            <table className="wfri-mini">
              <thead>
                <tr>
                  <th scope="col">KEY</th>
                  <th scope="col">VALUE</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map(([k, v]) => (
                  <tr key={k}>
                    <td className="k">{k}</td>
                    <td>{typeof v === 'string' ? v : JSON.stringify(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="wfri-card">
          <div className="wfri-sec">USAGE · run.usage</div>
          <dl className="wfri-kv">
            <Row k="total tokens" na={!usage}>
              {usage ? usage.total_tokens.toLocaleString() : 'not reported'}
            </Row>
            <Row k="input / output" na={!usage}>
              {usage
                ? `${usage.input_tokens.toLocaleString()} / ${usage.output_tokens.toLocaleString()}`
                : 'not reported'}
            </Row>
            <Row k="cost" na={usage?.cost_usd == null}>
              {usage?.cost_usd == null
                ? 'not reported'
                : `$${usage.cost_usd.toFixed(4)}`}
            </Row>
            <Row k="coverage" na>
              {`${cov.reporting.length} of ${cov.total} nodes${cov.reporting.length ? ` (${cov.reporting.join(', ')})` : ''}`}
            </Row>
          </dl>
          <div className="wfri-note">
            Only prompt, loop and command nodes write tokens. bash, script,
            approval and cancel nodes report none.
          </div>
        </section>
      </div>

      <section className="wfri-card">
        <div className="wfri-sec">CONTEXT</div>
        <div className="wfri-msg">
          {run.user_message || 'No message recorded.'}
        </div>
        <dl className="wfri-kv wfri-kv--wide">
          <Row k="working path" na={!run.working_path}>
            {run.working_path || 'not set'}
          </Row>
          <Row k="conversation id">
            {run.conversation_id}
            <button
              type="button"
              className="wfri-cp"
              aria-label="Copy conversation id"
              onClick={() => copy(run.conversation_id)}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a1 1 0 0 1 1-1h9" />
              </svg>
            </button>
          </Row>
          <Row k="parent conversation" na={parent.na}>
            {parent.v}
          </Row>
          <Row k="codebase" na={codebase.na}>
            {codebase.v}
          </Row>
        </dl>
      </section>

      {extra}
    </div>
  )
}
