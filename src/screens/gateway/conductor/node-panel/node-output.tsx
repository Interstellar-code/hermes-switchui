import { exitCode, lastErrorLine, stderrTail } from './node-panel-model'
import type { NodePanelData } from './node-panel'
import { Markdown } from '@/components/prompt-kit/markdown'
import {
  LLM_TYPES,
  attemptText,
  fmtDuration,
  fmtTime,
} from '@/screens/workflows/run-inspector/inspector-model'

// clipboard is undefined on insecure (http) origins
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const copy = (text: string) => void navigator.clipboard?.writeText(text)

/** JSON reads better pretty-printed; LLM text is markdown; the rest is a log. */
function Body({ text, type }: { text: string; type: string }) {
  try {
    const v = JSON.parse(text) as unknown
    if (v && typeof v === 'object')
      return <pre className="cnp-pre">{JSON.stringify(v, null, 2)}</pre>
  } catch {
    /* plain text */
  }
  return LLM_TYPES.has(type) ? (
    <Markdown className="cnp-md">{text}</Markdown>
  ) : (
    <pre className="cnp-pre">{text}</pre>
  )
}

export function NodeOutput({
  d,
  onAllNodeRuns,
  onResume,
  resuming = false,
}: {
  d: NodePanelData
  onAllNodeRuns: () => void
  onResume?: (runId: string, fromNodeId?: string) => void
  resuming?: boolean
}) {
  const nr = d.sel.nodeRun
  const summary = (nr?.summary ?? '').trim()
  const failed = nr?.status === 'failed'
  const tail = failed ? stderrTail(nr.error, 12) : ''
  const canResume =
    d.features.includes('retry_run') && d.run?.status === 'failed' && !!onResume
  const code = failed ? exitCode(nr.error) : null
  const took = failed && d.durationMs != null ? fmtDuration(d.durationMs) : null

  const empty = !nr
    ? 'This node has not been reached yet.'
    : failed
      ? 'No output — the step exited before writing a summary.'
      : nr.status === 'running' || nr.status === 'pending'
        ? 'Still running — output appears when the step completes.'
        : nr.status === 'paused'
          ? 'Waiting — no output yet.'
          : 'No output recorded.'

  return (
    <>
      {failed && (
        <>
          <div className="cnp-errb" role="alert">
            <span className="cnp-errb-t">
              ✗ node failed
              {code != null && ` · exit status ${code}`}
              {took && ` · after ${took}`}
            </span>
            <span>{lastErrorLine(nr.error)}</span>
          </div>
          <div className="cnp-box">
            <div className="cnp-boxh">
              <span className="cnp-lbl">STDERR TAIL · LAST 12 LINES</span>
              <button
                type="button"
                className="cnp-btn cnp-btn--sm"
                disabled={!tail}
                onClick={() => copy(tail)}
              >
                COPY
              </button>
            </div>
            {tail ? (
              <pre className="cnp-pre cnp-pre--err">{tail}</pre>
            ) : (
              <div className="cnp-empty">No error text recorded.</div>
            )}
            <span className="cnp-meta">
              from node_runs.error · captured when the step exited (no live log
              stream)
            </span>
          </div>
        </>
      )}

      <div className="cnp-box">
        <div className="cnp-boxh">
          <span className="cnp-lbl">OUTPUT</span>
          {summary && (
            <button
              type="button"
              className="cnp-btn cnp-btn--sm"
              onClick={() => copy(summary)}
            >
              COPY
            </button>
          )}
        </div>
        {summary ? (
          <Body text={summary} type={d.type} />
        ) : (
          <div className="cnp-empty">{empty}</div>
        )}
        {summary && (
          <span className="cnp-meta">
            final summary · live output is not streamed yet
          </span>
        )}
      </div>

      {failed && (
        <>
          <dl className="cnp-kv">
            {d.inputReply && (
              <>
                <dt>input reply</dt>
                <dd>&ldquo;{d.inputReply}&rdquo;</dd>
              </>
            )}
            <dt>started</dt>
            <dd>{fmtTime(nr.started_at)}</dd>
            <dt>finished</dt>
            <dd>{fmtTime(nr.completed_at)}</dd>
            <dt>attempt</dt>
            <dd>{attemptText(nr, d.features).replace(/^attempt /, '')}</dd>
          </dl>
          <div className="cnp-actions">
            {d.run?.status === 'failed' && (
              <button
                type="button"
                className="cnp-btn"
                disabled={!canResume || resuming}
                title={
                  canResume
                    ? `Re-run ${d.nodeId} and what follows; completed nodes are kept`
                    : 'available after backend update'
                }
                onClick={() => onResume?.(d.runId, d.nodeId)}
              >
                {resuming ? 'RESUMING…' : 'RESUME RUN'}
              </button>
            )}
            <button type="button" className="cnp-btn" onClick={onAllNodeRuns}>
              ALL NODE RUNS
            </button>
          </div>
        </>
      )}
    </>
  )
}
