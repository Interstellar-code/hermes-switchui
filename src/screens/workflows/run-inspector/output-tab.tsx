import { useState } from 'react'
import { nodeColor } from '../node-colors'
import { finalReport, latestOutput } from './events-model'
import { nodeTableRows } from './inspector-model'
import type { CSSProperties } from 'react'
import type { InspectorCtx } from './inspector-model'
import { Markdown } from '@/components/prompt-kit/markdown'

/** JSON output reads better pretty-printed; anything else is markdown. */
function OutputBody({ text }: { text: string }) {
  try {
    const v = JSON.parse(text) as unknown
    if (v && typeof v === 'object')
      return <pre className="wfri-code">{JSON.stringify(v, null, 2)}</pre>
  } catch {
    /* plain text / markdown */
  }
  return <Markdown className="wfri-md">{text}</Markdown>
}

export function OutputTab({ ctx }: { ctx: InspectorCtx }) {
  const { run, nodeRuns, parsed } = ctx
  const [open, setOpen] = useState<Set<string>>(new Set())
  const report = finalReport(parsed, nodeRuns, run.error)
  const latest = latestOutput(nodeRuns)
  const rows = nodeTableRows(parsed, nodeRuns)
  const reached = rows.filter((r) => r.nodeRun)
  const unreached = rows.filter((r) => !r.nodeRun)
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="wfri-stack">
      <section>
        <div className="wfri-sec">FINAL REPORT</div>
        {report.sinks.length > 0 ? (
          report.sinks.map((s) => (
            <div key={s.id} className="wfri-rep">
              <div className="wfri-meta">{s.id}</div>
              <OutputBody text={s.text} />
            </div>
          ))
        ) : (
          <div className="wfri-emptybox">
            <b>No final report for this run.</b>{' '}
            {report.missing.length > 0
              ? `The report comes from ${report.missing.map((m) => m.id).join(' and ')}: ${report.missing.map((m) => m.reason).join('; ')}.`
              : 'The definition has no sink nodes.'}{' '}
            Per-node outputs below are what the run produced.
          </div>
        )}
      </section>

      {latest && (
        <section>
          <div className="wfri-sec">
            LATEST OUTPUT · {latest.nodeId} · rendered
          </div>
          <div className="wfri-rep">
            <OutputBody text={latest.text} />
          </div>
        </section>
      )}

      <section>
        <div className="wfri-sec">PER-NODE OUTPUTS · node_runs.summary</div>
        <div className="wfri-ol">
          {reached.map((r) => {
            const nr = r.nodeRun!
            const body = [nr.summary, nr.error].filter(Boolean).join('\n\n')
            const isOpen = open.has(r.id)
            const lines = nr.summary ? nr.summary.split('\n').length : 0
            const suffix =
              r.status === 'failed'
                ? 'failed · error output'
                : body
                  ? `${r.status} · ${lines} line${lines === 1 ? '' : 's'}`
                  : `${r.status} · no output`
            return (
              <div key={r.id} className="wfri-oi">
                <button
                  type="button"
                  className="wfri-oh"
                  aria-expanded={isOpen}
                  disabled={!body}
                  onClick={() => toggle(r.id)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d={isOpen ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
                  </svg>
                  <i
                    className="wfri-dot"
                    style={{ '--node-c': nodeColor(r.type) } as CSSProperties}
                  />
                  {r.id}
                  <span className="m">{suffix}</span>
                </button>
                {isOpen && (
                  <pre
                    className={`wfri-code${r.status === 'failed' ? ' wfri-code--err' : ''}`}
                  >
                    {body}
                  </pre>
                )}
              </div>
            )
          })}
          {unreached.length > 0 && (
            <div className="wfri-oi">
              <span className="wfri-oh wfri-oh--static wfri-na">
                + {unreached.map((r) => r.id).join(', ')} · not reached
              </span>
            </div>
          )}
          {rows.length === 0 && (
            <div className="wfri-empty">No node outputs yet.</div>
          )}
        </div>
      </section>
    </div>
  )
}
