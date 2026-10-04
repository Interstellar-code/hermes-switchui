/**
 * MapInspector — detail panel for the selected Memory Map node: fetches the
 * full node (GET /api/memory/graph/node) and lists facts + neighbours by kind.
 *
 * Phase 0 split from memory-map.tsx; Lane D rebuilds it on `deriveInspector`.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cleanLabel, shortLabel } from '../memory-map-graph'
import { KIND_ORDER, KindGlyph } from './map-kinds'
import type {
  GraphNode,
  GraphNodeDetail,
  InspectorModel,
  Kind,
} from '../memory-map-graph'

// ponytail: expanded neighbour list is capped; paginate if hubs need more
const NEIGHBOUR_MAX = 200

export function dateRange(a?: string | null, b?: string | null): string {
  const d1 = a?.slice(0, 10)
  const d2 = b?.slice(0, 10)
  if (!d1 || !d2) return d1 ?? d2 ?? '—'
  return d1 === d2 ? d1 : `${d1} → ${d2}`
}

async function fetchNode(
  id: string,
  profile: string,
): Promise<GraphNodeDetail> {
  const res = await fetch(
    `/api/memory/graph/node?id=${encodeURIComponent(id)}&profile=${encodeURIComponent(profile)}`,
    {
      credentials: 'same-origin',
    },
  )
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<GraphNodeDetail>
}

export type MapInspectorProps = {
  profile: string
  selected: GraphNode
  model: InspectorModel
  onClose: () => void
  onFocusNode: (id: string) => void
  onOpenInWiki: (path: string) => void
}

export function MapInspector({
  profile,
  selected,
  model,
  onClose,
  onFocusNode,
  onOpenInWiki,
}: MapInspectorProps) {
  const selectedId = selected.id
  const [expandedKinds, setExpandedKinds] = useState<Set<Kind>>(new Set())
  // collapse "+N more" groups when the selection changes
  useEffect(() => {
    setExpandedKinds(new Set())
  }, [selectedId])

  const detailQuery = useQuery({
    queryKey: ['memory', 'map', 'node', profile, selectedId],
    queryFn: () => fetchNode(selectedId, profile),
    staleTime: 60_000,
  })
  const detail =
    detailQuery.data?.id === selectedId ? detailQuery.data : undefined
  const lastSeen = model.dates.get(selectedId)?.last
  const neighbourGroups = useMemo(() => {
    const groups = new Map<Kind, Array<GraphNode>>()
    for (const id of model.adj.get(selectedId) ?? []) {
      const n = model.byId.get(id)
      if (!n) continue
      const list = groups.get(n.kind)
      if (list) list.push(n)
      else groups.set(n.kind, [n])
    }
    return KIND_ORDER.filter((k) => groups.has(k)).map((k) => ({
      kind: k,
      nodes: groups
        .get(k)!
        .sort(
          (a, b) => (model.deg.get(b.id) ?? 0) - (model.deg.get(a.id) ?? 0),
        ),
    }))
  }, [selectedId, model])

  return (
    <aside className="mm-detail" aria-label="Selected node detail">
      <div className="mm-detail-head">
        <span className="mm-detail-kind">
          <KindGlyph kind={selected.kind} />
          {selected.kind}
        </span>
        <button
          type="button"
          className="mm-detail-close"
          onClick={onClose}
          aria-label="Close detail"
        >
          ✕
        </button>
      </div>
      <div className="mm-detail-label">
        {cleanLabel(detail?.label ?? selected.label) || selected.id}
        {(detail?.count ?? selected.count ?? 1) > 1 && (
          <span
            className="mm-count-badge"
            title={`${detail?.count ?? selected.count} identical facts`}
          >
            ×{detail?.count ?? selected.count}
          </span>
        )}
      </div>
      {detail && detail.text.trim() && detail.text.trim() !== detail.label && (
        <div className="mm-detail-text">{detail.text}</div>
      )}
      {detailQuery.isLoading && (
        <div className="mm-detail-note" role="status">
          Loading full text…
        </div>
      )}
      {detailQuery.isError && (
        <div className="mm-detail-note">Full text unavailable.</div>
      )}
      <dl className="mm-detail-meta">
        <dt>Connections</dt>
        <dd>{model.deg.get(selected.id) ?? 0}</dd>
        {detail?.createdAt && (
          <>
            <dt>Created</dt>
            <dd>{detail.createdAt.slice(0, 16).replace('T', ' ')}</dd>
          </>
        )}
        {detail?.updatedAt && (
          <>
            <dt>Updated</dt>
            <dd>{detail.updatedAt.slice(0, 16).replace('T', ' ')}</dd>
          </>
        )}
        {!detail?.createdAt && lastSeen && (
          <>
            <dt>Last seen</dt>
            <dd>{lastSeen.slice(0, 10)}</dd>
          </>
        )}
        {(detail?.count ?? 1) > 1 && (
          <>
            <dt>Seen</dt>
            <dd>{dateRange(detail!.firstAt, detail!.lastAt)}</dd>
          </>
        )}
        {Object.entries(detail?.source ?? {}).map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k.replace(/_/g, ' ')}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
        <dt>ID</dt>
        <dd className="mm-detail-id">{selected.id}</dd>
      </dl>
      {selected.kind === 'wiki' && (
        <button
          type="button"
          className="mm-toggle is-on"
          onClick={() => onOpenInWiki(selected.id)}
        >
          Open in Wiki
        </button>
      )}
      {detail?.facts && detail.facts.length > 0 && (
        <div className="mm-detail-neighbours">
          <section>
            <h4>
              <KindGlyph kind="fact" />
              distinct facts · {detail.source.distinct_facts}
              {Number(detail.source.facts) >
                Number(detail.source.distinct_facts) &&
                ` (${detail.source.facts} rows)`}
            </h4>
            <ul>
              {detail.facts.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={!model.byId.has(f.id)}
                    title={
                      model.byId.has(f.id) ? undefined : 'Not in current view'
                    }
                    onClick={() => onFocusNode(f.id)}
                  >
                    {f.text.length > 48 ? `${f.text.slice(0, 47)}…` : f.text}
                    {f.count > 1 && (
                      <span
                        className="mm-count-badge"
                        title={dateRange(f.firstAt, f.lastAt)}
                      >
                        ×{f.count}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {neighbourGroups.length > 0 && (
        <div className="mm-detail-neighbours">
          {neighbourGroups.map((g) => (
            <section key={g.kind}>
              <h4>
                <KindGlyph kind={g.kind} />
                {g.kind} · {g.nodes.length}
              </h4>
              <ul>
                {g.nodes
                  .slice(0, expandedKinds.has(g.kind) ? NEIGHBOUR_MAX : 12)
                  .map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => onFocusNode(n.id)}>
                        {shortLabel(n, 48, model.dates.get(n.id)?.last ?? null)}
                      </button>
                    </li>
                  ))}
              </ul>
              {g.nodes.length > 12 && (
                <button
                  type="button"
                  className="mm-detail-more"
                  aria-expanded={expandedKinds.has(g.kind)}
                  onClick={() =>
                    setExpandedKinds((cur) => {
                      const next = new Set(cur)
                      if (next.has(g.kind)) next.delete(g.kind)
                      else next.add(g.kind)
                      return next
                    })
                  }
                >
                  {expandedKinds.has(g.kind)
                    ? 'Show fewer'
                    : `+${g.nodes.length - 12} more`}
                </button>
              )}
              {expandedKinds.has(g.kind) && g.nodes.length > NEIGHBOUR_MAX && (
                <div className="mm-detail-note">
                  {g.nodes.length - NEIGHBOUR_MAX} more not listed
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </aside>
  )
}
