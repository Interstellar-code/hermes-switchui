import { Fragment, useMemo, useState } from 'react'
import { nodeColor } from '../node-colors'
import {
  LLM_TYPES,
  asList,
  attemptShort,
  attemptText,
  fmtDuration,
  fmtTime,
  lastLines,
  nodeTableRows,
  summaryCounts,
} from './inspector-model'
import type { CSSProperties } from 'react'
import type { InspectorCtx, NodeTableRow } from './inspector-model'
import type { NodeRunRow, WorkflowArtifactRef } from '../api-client'
import { compactTokens } from '@/lib/format-usage'

const LEGEND: Array<[string, string]> = [
  ['prompt', 'prompt'],
  ['bash', 'bash/script'],
  ['command', 'command'],
  ['approval', 'approval'],
  ['cancel', 'cancel'],
  ['loop', 'loop'],
]

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

function ArtifactRefs({ nodeRun }: { nodeRun: NodeRunRow }) {
  const refs = parseArtifactRefs(nodeRun.artifact_refs)
  if (refs.length === 0) return <div className="wfri-na">none</div>
  return (
    <div className="wfri-artifacts">
      {refs.map((ref, index) => {
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
            className="wfri-art"
            title={href}
          >
            {label}
          </a>
        ) : (
          <span key={`${label}-${index}`} className="wfri-art" title={ref.path}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function metaOf(nr: NodeRunRow): Record<string, unknown> {
  if (!nr.metadata) return {}
  if (typeof nr.metadata === 'object') return nr.metadata
  try {
    return JSON.parse(nr.metadata) as Record<string, unknown>
  } catch {
    return {}
  }
}

function Details({
  row,
  ctx,
  onViewEvents,
}: {
  row: NodeTableRow
  ctx: InspectorCtx
  onViewEvents: (id: string) => void
}) {
  const nr = row.nodeRun
  if (!nr) return null
  const deps =
    asList(nr.depends_on).length > 0
      ? asList(nr.depends_on)
      : asList(ctx.parsed?.nodes.find((n) => n.id === row.id)?.depends_on)
  const approver = metaOf(nr).approved_by
  const stderr = lastLines(nr.summary)
  return (
    <div className="wfri-xg">
      <div>
        {nr.error && (
          <>
            <div className="wfri-xl">ERROR · node_runs.error</div>
            <pre className="wfri-code wfri-code--err">{nr.error}</pre>
          </>
        )}
        {stderr && (
          <>
            <div className="wfri-xl">
              {nr.status === 'failed'
                ? 'OUTPUT · last 6 lines of summary'
                : 'SUMMARY · last 6 lines'}
            </div>
            <pre className="wfri-code">{stderr}</pre>
          </>
        )}
        {!nr.error && !stderr && (
          <div className="wfri-na">No output recorded.</div>
        )}
      </div>
      <div>
        <div className="wfri-xl">ARTIFACTS · artifact_refs</div>
        <ArtifactRefs nodeRun={nr} />
        <div className="wfri-xl">RUN DETAILS</div>
        <dl className="wfri-kv wfri-kv--x">
          <dt>retries</dt>
          <dd
            className={
              ctx.features.includes('node_attempts') ? undefined : 'na'
            }
          >
            {attemptText(nr, ctx.features)}
          </dd>
          <dt>runtime limit</dt>
          <dd className={nr.max_runtime_seconds ? undefined : 'na'}>
            {nr.max_runtime_seconds ? `${nr.max_runtime_seconds}s` : 'none'}
          </dd>
          <dt>depends on</dt>
          <dd className={deps.length ? undefined : 'na'}>
            {deps.length ? deps.join(', ') : 'none'}
          </dd>
          <dt>agent session</dt>
          <dd className={nr.session_id ? undefined : 'na'}>
            {nr.session_id ? (
              <a href={`/chat/${encodeURIComponent(nr.session_id)}`}>
                {nr.session_id.slice(0, 8)}
              </a>
            ) : (
              'not linked'
            )}
          </dd>
          {nr.kanban_task_id && (
            <>
              <dt>kanban task</dt>
              <dd>{nr.kanban_task_id.slice(0, 8)}</dd>
            </>
          )}
          {typeof approver === 'string' && (
            <>
              <dt>approver</dt>
              <dd>{approver} · self-reported</dd>
            </>
          )}
        </dl>
        <div className="wfri-btns">
          {ctx.onOpenNode && (
            <button
              type="button"
              className="wfri-btn"
              onClick={() => ctx.onOpenNode?.(row.id, 'output')}
            >
              OPEN LOG
            </button>
          )}
          <button
            type="button"
            className="wfri-btn"
            onClick={() => onViewEvents(row.id)}
          >
            VIEW IN EVENTS
          </button>
        </div>
      </div>
    </div>
  )
}

export function NodeRunsTab({
  ctx,
  skipReasons,
  expandedId,
  onExpand,
  onViewEvents,
}: {
  ctx: InspectorCtx
  skipReasons: Map<string, string>
  expandedId: string | null
  onExpand: (id: string | null) => void
  onViewEvents: (id: string) => void
}) {
  const { nodeRuns, features, parsed } = ctx
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const rows = useMemo(
    () => nodeTableRows(parsed, nodeRuns, skipReasons),
    [parsed, nodeRuns, skipReasons],
  )
  const counts = summaryCounts(rows)
  const children = useMemo(() => {
    const m = new Map<string, Array<NodeRunRow>>()
    for (const nr of nodeRuns) {
      if (!nr.parent_subgraph_node_run_id) continue
      const arr = m.get(nr.parent_subgraph_node_run_id) ?? []
      arr.push(nr)
      m.set(nr.parent_subgraph_node_run_id, arr)
    }
    return m
  }, [nodeRuns])

  if (rows.length === 0)
    return (
      <div className="wfri-empty">
        No nodes yet — execute phase hasn't materialised any nodes.
      </div>
    )

  const aggregate = (id: string) => {
    const kids = children.get(id) ?? []
    const n = (s: string) => kids.filter((k) => k.status === s).length
    if (n('running')) return `${n('running')}/${kids.length} running`
    if (n('failed')) return `${n('failed')}/${kids.length} failed`
    if (n('pending'))
      return `${kids.length - n('completed')}/${kids.length} pending`
    return `${n('completed')}/${kids.length} completed`
  }

  const cell = (r: NodeTableRow) => {
    const tokens =
      r.tokens && r.tokens > 0
        ? compactTokens(r.tokens)
        : LLM_TYPES.has(r.type) && r.nodeRun
          ? '—'
          : 'none'
    return {
      tokens,
      model: r.model ?? (LLM_TYPES.has(r.type) ? '—' : 'n/a'),
    }
  }

  return (
    <div className="wfri-stack">
      <div className="wfri-bar">
        <span className="wfri-sum">
          {counts.done > 0 && <b className="t-ok">{counts.done} done</b>}
          {counts.running > 0 && (
            <b className="t-live"> · {counts.running} running</b>
          )}
          {counts.paused > 0 && (
            <b className="t-hold"> · {counts.paused} paused</b>
          )}
          {counts.failed > 0 && (
            <b className="t-err"> · {counts.failed} failed</b>
          )}
          {counts.skipped > 0 && ` · ${counts.skipped} skipped`}
          {counts.notReached > 0 && ` · ${counts.notReached} not reached`}
        </span>
        <div className="wfri-legend" aria-label="Node type legend">
          {LEGEND.map(([type, label]) => (
            <span key={type}>
              <i
                className="wfri-dot"
                style={{ '--node-c': nodeColor(type) } as CSSProperties}
              />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="wfri-tablewrap">
        <table className="wfri-nt">
          <thead>
            <tr>
              <th scope="col">NODE</th>
              <th scope="col">STAGE</th>
              <th scope="col">STATUS</th>
              <th scope="col">STARTED</th>
              <th scope="col">TOOK</th>
              <th scope="col">ATTEMPT</th>
              <th scope="col">TOKENS</th>
              <th scope="col">MODEL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const kids = r.nodeRun ? children.get(r.nodeRun.id) : undefined
              const isGroup = !!kids && kids.length > 0
              const open = expandedId === r.id
              const grpOpen = r.nodeRun ? openGroups.has(r.nodeRun.id) : false
              const c = cell(r)
              const pend = !r.nodeRun
              return (
                <Fragment key={r.id}>
                  <tr
                    className={`wfri-row${pend ? ' pend' : ''}${open ? ' sel' : ''}${r.status === 'skipped' ? ' skip' : ''}`}
                  >
                    <td>
                      <span className="wfri-nm">
                        {r.nodeRun ? (
                          <button
                            type="button"
                            className="wfri-chev"
                            aria-expanded={open}
                            aria-label={`${open ? 'Collapse' : 'Expand'} ${r.id} details`}
                            onClick={() => onExpand(open ? null : r.id)}
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
                              <path
                                d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'}
                              />
                            </svg>
                          </button>
                        ) : (
                          <span className="wfri-chev-sp" />
                        )}
                        <i
                          className="wfri-dot"
                          style={
                            { '--node-c': nodeColor(r.type) } as CSSProperties
                          }
                        />
                        {r.id} <span className="wfri-ty">{r.type}</span>
                        {isGroup && r.nodeRun && (
                          <button
                            type="button"
                            className="wfri-sg"
                            aria-expanded={grpOpen}
                            onClick={() =>
                              setOpenGroups((prev) => {
                                const next = new Set(prev)
                                if (next.has(r.nodeRun!.id))
                                  next.delete(r.nodeRun!.id)
                                else next.add(r.nodeRun!.id)
                                return next
                              })
                            }
                          >
                            {grpOpen ? '▾' : '▸'} {aggregate(r.nodeRun.id)}
                          </button>
                        )}
                      </span>
                      {r.status === 'skipped' && r.skipReason && (
                        <span className="wfri-skr" title={r.skipReason}>
                          {r.skipReason}
                        </span>
                      )}
                    </td>
                    <td>{r.stage}</td>
                    <td className={`t-${r.tone}`}>{r.status}</td>
                    <td className={r.startedMs == null ? 'na' : undefined}>
                      {r.startedMs == null ? 'never' : fmtTime(r.startedMs)}
                    </td>
                    <td className={r.tookMs == null ? 'na' : undefined}>
                      {fmtDuration(r.tookMs)}
                    </td>
                    <td className={r.nodeRun ? undefined : 'na'}>
                      {r.nodeRun ? attemptShort(r.nodeRun, features) : 'n/a'}
                    </td>
                    <td
                      className={
                        c.tokens === 'none' || c.tokens === '—'
                          ? 'na'
                          : undefined
                      }
                    >
                      {c.tokens}
                    </td>
                    <td
                      className={
                        r.status === 'skipped' ||
                        c.model === 'n/a' ||
                        c.model === '—'
                          ? 'na wfri-model'
                          : 'wfri-model'
                      }
                    >
                      {c.model}
                    </td>
                  </tr>
                  {open && (
                    <tr className="wfri-exp">
                      <td colSpan={8}>
                        <Details
                          row={r}
                          ctx={ctx}
                          onViewEvents={onViewEvents}
                        />
                      </td>
                    </tr>
                  )}
                  {grpOpen &&
                    kids?.map((k) => (
                      <tr key={k.id} className="wfri-row wfri-row--child">
                        <td>
                          <span className="wfri-nm wfri-nm--child">
                            <i
                              className="wfri-dot"
                              style={
                                {
                                  '--node-c': nodeColor(k.node_type),
                                } as CSSProperties
                              }
                            />
                            {k.dag_node_id}{' '}
                            <span className="wfri-ty">{k.node_type}</span>
                          </span>
                        </td>
                        <td>—</td>
                        <td
                          className={`t-${k.status === 'completed' ? 'ok' : k.status === 'failed' ? 'err' : 'muted'}`}
                        >
                          {k.status === 'completed' ? 'done' : k.status}
                        </td>
                        <td>
                          {k.started_at ? fmtTime(k.started_at) : 'never'}
                        </td>
                        <td>—</td>
                        <td>{attemptShort(k, features)}</td>
                        <td>
                          {k.total_tokens
                            ? compactTokens(k.total_tokens)
                            : 'none'}
                        </td>
                        <td className="wfri-model">{k.model ?? 'n/a'}</td>
                      </tr>
                    ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
