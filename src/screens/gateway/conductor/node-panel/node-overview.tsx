import {
  approvalInfo,
  artifactLabels,
  configText,
  durationMs,
  fmtWait,
  isAwaitingApproval,
  lastErrorLine,
  timeoutText,
  usageNote,
} from './node-panel-model'
import type { NodePanelData } from './node-panel'
import { ApprovalCard } from '@/screens/workflows/approval-card'
import {
  attemptText,
  fmtDuration,
  fmtTime,
} from '@/screens/workflows/run-inspector/inspector-model'
import { compactTokens } from '@/lib/format-usage'

const SUMMARY_MAX = 400

function Link({
  id,
  onSelect,
}: {
  id: string
  onSelect: (id: string) => void
}) {
  return (
    <button type="button" className="cnp-dep" onClick={() => onSelect(id)}>
      {id}
    </button>
  )
}

function LinkList({
  ids,
  onSelect,
}: {
  ids: Array<string>
  onSelect: (id: string) => void
}) {
  if (ids.length === 0) return <span className="cnp-na">none</span>
  return (
    <span className="cnp-links">
      {ids.map((id) => (
        <Link key={id} id={id} onSelect={onSelect} />
      ))}
    </span>
  )
}

export function NodeOverview({
  d,
  onSelectNode,
  onOpenOutput,
}: {
  d: NodePanelData
  onSelectNode: (id: string) => void
  onOpenOutput: () => void
}) {
  const { sel, run, features, now, type, stage, nodeId } = d
  const nr = sel.nodeRun
  const awaiting = isAwaitingApproval(nr, run)
  const approval = approvalInfo(nr, run, sel.def)
  const waited = durationMs(nr, now)
  const config = configText(sel.def)
  const summary = (nr?.summary ?? '').trim()
  const usage = usageNote(type, nr)
  const session = nr?.session_id
  const refs = artifactLabels(nr)

  return (
    <>
      {awaiting && nr && (
        <ApprovalCard
          runId={d.runId}
          nodeRun={nr}
          captureResponse={approval?.captureResponse}
          compact
        />
      )}
      {nr?.status === 'failed' && nr.error && (
        <div className="cnp-errb" role="alert">
          <span className="cnp-errb-t">✗ node failed</span>
          <span>{lastErrorLine(nr.error)}</span>
        </div>
      )}
      <dl className="cnp-kv">
        <dt>status</dt>
        <dd className={`cnp-st cnp-st--${d.tone}`}>
          {awaiting
            ? `⏸ waiting for you · ${fmtWait(waited)}`
            : (nr?.status ?? 'not reached')}
        </dd>
        <dt>stage</dt>
        <dd>{stage}</dd>
        <dt>started</dt>
        <dd className={nr?.started_at ? undefined : 'cnp-na'}>
          {nr?.started_at ? fmtTime(nr.started_at) : 'not started'}
        </dd>
        {nr?.completed_at && (
          <>
            <dt>finished</dt>
            <dd>{fmtTime(nr.completed_at)}</dd>
            <dt>duration</dt>
            <dd>{fmtDuration(waited)}</dd>
          </>
        )}
        <dt>attempt</dt>
        <dd
          className={features.includes('node_attempts') ? undefined : 'cnp-na'}
        >
          {nr ? attemptText(nr, features).replace(/^attempt /, '') : '—'}
        </dd>
        {sel.iterations.length > 0 && (
          <>
            <dt>iterations</dt>
            <dd>{sel.iterations.length}</dd>
          </>
        )}
        <dt>timeout</dt>
        <dd>{timeoutText(nr)}</dd>
        <dt>depends on</dt>
        <dd>
          <LinkList ids={sel.dependsOn} onSelect={onSelectNode} />
        </dd>
        <dt>{type === 'approval' ? 'on approve' : 'feeds'}</dt>
        <dd>
          <LinkList ids={sel.feeds} onSelect={onSelectNode} />
        </dd>
        {approval?.response && (
          <>
            <dt>reply</dt>
            <dd>&ldquo;{approval.response}&rdquo;</dd>
          </>
        )}
        {approval?.actor && (
          <>
            <dt>approver</dt>
            <dd>{approval.actor} · self-reported</dd>
          </>
        )}
      </dl>

      {config && (
        <div className="cnp-box">
          <span className="cnp-lbl">
            CONFIG · {type.toUpperCase()} · FROM DEFINITION
          </span>
          <pre>
            {config.length > 1200 ? `${config.slice(0, 1200)}…` : config}
          </pre>
        </div>
      )}

      {summary && (
        <div className="cnp-box">
          <span className="cnp-lbl">OUTPUT SUMMARY</span>
          <pre>
            {summary.length > SUMMARY_MAX
              ? `${summary.slice(0, SUMMARY_MAX)}…`
              : summary}
          </pre>
          <button type="button" className="cnp-link" onClick={onOpenOutput}>
            open full output in OUTPUT tab ▸
          </button>
        </div>
      )}

      <div className="cnp-box">
        <span className="cnp-lbl">MODEL · TOKENS · COST</span>
        {usage ? (
          <div className="cnp-empty">{usage}</div>
        ) : (
          <dl className="cnp-kv">
            <dt>model</dt>
            <dd>{nr?.model ?? 'not reported'}</dd>
            <dt>tokens</dt>
            <dd>
              {nr?.total_tokens != null
                ? compactTokens(nr.total_tokens)
                : 'not reported'}
            </dd>
            <dt>cost</dt>
            <dd>
              {nr?.cost_usd != null
                ? `$${nr.cost_usd.toFixed(4)}`
                : 'not reported'}
            </dd>
          </dl>
        )}
      </div>

      <dl className="cnp-kv">
        <dt>agent session</dt>
        <dd className={session ? undefined : 'cnp-na'}>
          {session ? (
            <a href={`/chat/${encodeURIComponent(session)}`}>
              {session.slice(0, 8)}
            </a>
          ) : (
            'not linked'
          )}
        </dd>
        <dt>artifacts</dt>
        <dd className={refs.length ? undefined : 'cnp-na'}>
          {refs.length ? refs.join(', ') : 'none'}
        </dd>
      </dl>
    </>
  )
}
