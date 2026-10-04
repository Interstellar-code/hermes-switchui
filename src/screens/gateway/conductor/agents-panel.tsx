import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useConductorScheduled, useRunSessions } from './use-conductor-queries'
import { agentCount } from './dag-model'
import type {
  RunSessionNode,
  SessionChild,
  SessionDelegation,
  SessionInfo,
} from '@/server/workflow-engine/interface'
import { compactTokens } from '@/lib/format-usage'

function SessionLink({
  s,
  profile,
}: {
  s: SessionInfo
  profile?: string | null
}) {
  const label = s.title || s.id.slice(0, 8)
  return (
    <Link
      className="ag-title"
      to="/chat/$sessionKey"
      params={{ sessionKey: s.id }}
      search={{ profile: profile || undefined }}
    >
      {label}
    </Link>
  )
}

function costLabel(cost: number | null, source?: string | null): string {
  if (cost == null) return '—'
  return `${source === 'estimated' ? '~' : ''}$${cost.toFixed(2)}`
}

function sessionMeta(s: SessionInfo): string {
  const tok = (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
  return [
    s.model,
    tok > 0 ? `${compactTokens(tok)} tok` : null,
    costLabel(s.cost, s.cost_source),
    s.ended_at != null
      ? `ended${s.end_reason ? ` · ${s.end_reason}` : ''}`
      : 'running',
  ]
    .filter(Boolean)
    .join(' · ')
}

function Delegations({ items }: { items: Array<SessionDelegation> }) {
  return (
    <>
      {items.map((d) => (
        <li key={d.id} className="ag-deleg">
          <span className="ag-state">{d.state}</span> {d.goal || d.id}
        </li>
      ))}
    </>
  )
}

// ponytail: depth cap so a pathological tree can't blow the render; raise if real nesting exceeds 8.
const MAX_DEPTH = 8

function ChildTree({
  items,
  profile,
  depth = 0,
}: {
  items: Array<SessionChild>
  profile?: string | null
  depth?: number
}) {
  if (depth >= MAX_DEPTH) return <div className="ag-meta">…</div>
  return (
    <ul className="ag-tree">
      {items.map((c) => (
        <li key={c.id}>
          <span className="ag-kind">{c.kind}</span>{' '}
          <SessionLink s={c} profile={profile} />
          <div className="ag-meta">{sessionMeta(c)}</div>
          {(c.children.length > 0 || c.delegations.length > 0) && (
            <ul className="ag-tree">
              <Delegations items={c.delegations} />
              {c.children.length > 0 && (
                <li>
                  <ChildTree
                    items={c.children}
                    profile={profile}
                    depth={depth + 1}
                  />
                </li>
              )}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

function NodeBlock({ n }: { n: RunSessionNode }) {
  return (
    <li className="ag-node">
      <div className="ag-node-head">
        {n.dag_node_id}
        {n.profile && <span className="ag-meta"> · {n.profile}</span>}
      </div>
      {n.session ? (
        <>
          <SessionLink s={n.session} profile={n.profile} />
          <div className="ag-meta">{sessionMeta(n.session)}</div>
        </>
      ) : (
        <div className="ag-meta">session not found</div>
      )}
      {(n.children.length > 0 || n.delegations.length > 0) && (
        <ul className="ag-tree">
          <Delegations items={n.delegations} />
          {n.children.length > 0 && (
            <li>
              <ChildTree items={n.children} profile={n.profile} />
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

/** Collapsible "Agents" section: owner session, then per-node session → sub-agent tree. */
export function AgentsPanel({ runId }: { runId: string }) {
  const q = useRunSessions(runId)
  const dashProfile = useConductorScheduled().data?.profile
  const [open, setOpen] = useState(true)
  const available = q.data?.available ?? true
  const data = q.data?.data ?? null
  const nodes = (data?.nodes ?? []).filter(
    (n) => n.session || n.children.length || n.delegations.length,
  )
  const total = agentCount(nodes) + (data?.owner ? 1 : 0)
  const t = data?.totals
  const totals = t
    ? [
        `${t.sessions} sessions`,
        `${t.subagents} subagents`,
        `${compactTokens(t.tokens)} tok`,
        t.cost_usd != null
          ? costLabel(t.cost_usd)
          : t.tokens > 0
            ? 'cost partial'
            : '—',
      ].join(' · ')
    : null
  return (
    <section className="ag-panel" aria-label="Agents">
      <button
        type="button"
        className="ag-toggle"
        aria-expanded={open}
        aria-controls={`ag-body-${runId}`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Agents{total > 0 ? ` · ${total}` : ''}
        {data?.totals.truncated && ' (truncated)'}
      </button>
      {open && (
        <div className="ag-body" id={`ag-body-${runId}`}>
          {q.isError && (
            <div className="ag-empty" role="alert">
              Failed to load agent sessions
            </div>
          )}
          {totals && <div className="ag-meta">{totals}</div>}
          {data?.owner && (
            <div className="ag-owner">
              <span className="ag-kind">started from</span>{' '}
              <SessionLink s={data.owner} profile={dashProfile} />
              {data.owner.source && (
                <span className="ag-meta"> · {data.owner.source}</span>
              )}
            </div>
          )}
          {nodes.length > 0 && (
            <ul className="ag-tree">
              {nodes.map((n) => (
                <NodeBlock key={n.node_run_id} n={n} />
              ))}
            </ul>
          )}
          {!data?.owner && nodes.length === 0 && !q.isLoading && !q.isError && (
            <div className="ag-empty" role="status">
              No linked agent sessions for this run
              {!available && (
                <div className="ag-meta">
                  Needs the workflow-engine run-sessions patch
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
