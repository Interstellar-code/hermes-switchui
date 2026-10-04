/**
 * MapInspector — detail panel for the selected Memory Map node: fetches the
 * full node (GET /api/memory/graph/node) and lists facts + neighbours by kind.
 *
 * Phase 0 split from memory-map.tsx; Lane D rebuilds it on `deriveInspector`.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useBrowseFocusStore,
  useMemoryChatStore,
  useMemoryScreenStore,
} from '../../../../stores/memory-screen-store'
import { cleanLabel, deriveInspector, shortLabel } from '../memory-map-graph'
import { KindGlyph } from './map-kinds'
import type {
  ClusterResult,
  GraphNode,
  GraphNodeDetail,
  InspectorModel,
  Kind,
} from '../memory-map-graph'

const FACTS_PREVIEW = 6
const MENTIONS_PREVIEW = 10
const OTHER_PREVIEW = 6
const CHIPS_PREVIEW = 12

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})
function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : MONTH_DAY.format(d)
}
function ago(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso.slice(0, 10)
  const h = (Date.now() - t) / 36e5
  if (h < 1) return 'just now'
  if (h < 24) return `${Math.floor(h)}h ago`
  if (h < 24 * 30) return `${Math.floor(h / 24)}d ago`
  return shortDate(iso)
}

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
  /** Lane C passes the cluster result; null until then. */
  clusters?: ClusterResult | null
  /** Select/centre another node (chips, fact rows). */
  onFocusNode: (id: string) => void
  /** FOCUS action: enter focus (ego) mode on the selected node. */
  onFocus: (id: string) => void
  onOpenInWiki: (path: string) => void
}

export function MapInspector({
  profile,
  selected,
  model,
  clusters = null,
  onClose,
  onFocusNode,
  onFocus,
  onOpenInWiki,
}: MapInspectorProps) {
  const selectedId = selected.id
  const [allFacts, setAllFacts] = useState(false)
  const [allChips, setAllChips] = useState(false)
  const [allMentions, setAllMentions] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)
  const [allOther, setAllOther] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  // collapse expanded lists and move focus into the panel on selection change
  useEffect(() => {
    setAllFacts(false)
    setAllChips(false)
    setAllMentions(false)
    setOtherOpen(false)
    setAllOther(false)
    asideRef.current?.focus({ preventScroll: true })
  }, [selectedId])
  // remaining direct neighbours (facts/episodic/working) not covered above
  const otherGroups = useMemo(() => {
    const groups = new Map<Kind, Array<GraphNode>>()
    for (const id of model.adj.get(selectedId) ?? []) {
      const n = model.byId.get(id)
      if (!n || n.kind === 'entity' || n.kind === 'gist' || n.kind === 'wiki')
        continue
      groups.set(n.kind, [...(groups.get(n.kind) ?? []), n])
    }
    for (const g of groups.values())
      g.sort((a, b) => (model.deg.get(b.id) ?? 0) - (model.deg.get(a.id) ?? 0))
    return [...groups.entries()]
  }, [model, selectedId])
  const otherTotal = otherGroups.reduce((t, [, g]) => t + g.length, 0)
  const data = useMemo(
    () => deriveInspector(model, selectedId, clusters),
    [model, selectedId, clusters],
  )
  const clusterInfo = useMemo(
    () => new Map(clusters?.clusters.map((c) => [c.id, c])),
    [clusters],
  )
  const clusterVar = (nodeId: string): string => {
    const c = clusterInfo.get(clusters?.clusterOf.get(nodeId) ?? NaN)
    return c?.slot == null
      ? 'var(--mm-cluster-other)'
      : `var(--mm-cluster-${c.slot})`
  }
  const cluster = clusterInfo.get(data?.clusterId ?? NaN)

  const label = cleanLabel(selected.label)
  const truncated = /[…]$|\.\.\.$/.test(label.trim())
  const plain = label.replace(/(…|\.\.\.)$/, '').trim()

  function openInBrowse() {
    // Browse has no wiki type; its other types match graph kinds.
    let tokens: Array<string> = plain.match(/[\p{L}\p{N}_]+/gu) ?? []
    // a truncated label's last token may be cut mid-word
    if (truncated && tokens.length > 1) tokens = tokens.slice(0, -1)
    useBrowseFocusStore.getState().setFocus({
      type: selected.kind === 'wiki' ? null : selected.kind,
      q: tokens.length ? tokens.slice(0, 4).join(' ') : label,
    })
    useMemoryScreenStore.getState().setActiveTab('browse')
  }
  function askAbout() {
    useMemoryChatStore
      .getState()
      .askMemory(
        selected.kind === 'entity'
          ? `What do you know about ${plain}?`
          : `What do you know about this memory: "${plain}"?`,
      )
  }

  const detailQuery = useQuery({
    queryKey: ['memory', 'map', 'node', profile, selectedId],
    queryFn: () => fetchNode(selectedId, profile),
    staleTime: 60_000,
  })
  const detail =
    detailQuery.data?.id === selectedId ? detailQuery.data : undefined
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      className="mm-detail"
      aria-label="Selected node detail"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="mm-detail-head">
        <span className="mm-detail-kind">
          <KindGlyph kind={selected.kind} />
          {selected.kind}
          {cluster && (
            <span
              className="mm-detail-cluster"
              style={{ color: clusterVar(selectedId) }}
            >
              · {cluster.name}
            </span>
          )}
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
      <div className="mm-detail-stats">
        <span>{data?.connections ?? 0} connections</span>
        {data?.firstSeen && <span>first {shortDate(data.firstSeen)}</span>}
        {data?.lastSeen && <span>last {ago(data.lastSeen)}</span>}
      </div>
      <div className="mm-detail-actions">
        <button
          type="button"
          className="mm-detail-act is-primary"
          onClick={() => onFocus(selectedId)}
        >
          FOCUS
        </button>
        {selected.kind !== 'wiki' && (
          <button
            type="button"
            className="mm-detail-act"
            onClick={openInBrowse}
          >
            OPEN IN BROWSE
          </button>
        )}
        <button type="button" className="mm-detail-act" onClick={askAbout}>
          ASK ABOUT
        </button>
      </div>
      <dl className="mm-detail-meta">
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
        <section className="mm-detail-sec">
          <h4>
            facts ·{' '}
            {Math.min(
              allFacts ? detail.facts.length : FACTS_PREVIEW,
              detail.facts.length,
            )}{' '}
            of {detail.facts.length}
            {Number(detail.source.facts) > detail.facts.length &&
              ` (${detail.source.facts} rows)`}
          </h4>
          <ul>
            {detail.facts
              .slice(0, allFacts ? undefined : FACTS_PREVIEW)
              .map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={!model.byId.has(f.id)}
                    title={
                      model.byId.has(f.id) ? undefined : 'Not in current view'
                    }
                    aria-label={`fact: ${f.text.length > 60 ? `${f.text.slice(0, 59)}…` : f.text}${f.count > 1 ? `, seen ${f.count} times` : ''}`}
                    onClick={() => onFocusNode(f.id)}
                  >
                    <span className="mm-detail-row-text">{f.text}</span>
                    {f.count > 1 ? (
                      <span
                        className="mm-count-badge"
                        title={dateRange(f.firstAt, f.lastAt)}
                      >
                        ×{f.count}
                      </span>
                    ) : (
                      f.lastAt && (
                        <span className="mm-detail-date">
                          {shortDate(f.lastAt)}
                        </span>
                      )
                    )}
                  </button>
                </li>
              ))}
          </ul>
          {detail.facts.length > FACTS_PREVIEW && (
            <button
              type="button"
              className="mm-detail-more"
              aria-expanded={allFacts}
              onClick={() => setAllFacts((v) => !v)}
            >
              {allFacts ? 'Show fewer' : `Show all ${detail.facts.length} →`}
            </button>
          )}
        </section>
      )}
      {data && data.linkedEntities.length > 0 && (
        <section className="mm-detail-sec">
          <h4>linked entities</h4>
          <div className="mm-detail-chips">
            {data.linkedEntities
              .slice(0, allChips ? undefined : CHIPS_PREVIEW)
              .map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="mm-detail-chip"
                  style={{ color: clusterVar(n.id) }}
                  onClick={() => onFocusNode(n.id)}
                >
                  {shortLabel(n, 24)}
                </button>
              ))}
            {data.linkedEntities.length > CHIPS_PREVIEW && (
              <button
                type="button"
                className="mm-detail-chip is-more"
                aria-expanded={allChips}
                aria-label={
                  allChips
                    ? 'show fewer linked entities'
                    : `show ${data.linkedEntities.length - CHIPS_PREVIEW} more linked entities`
                }
                onClick={() => setAllChips((v) => !v)}
              >
                {allChips
                  ? 'fewer'
                  : `+${data.linkedEntities.length - CHIPS_PREVIEW}`}
              </button>
            )}
          </div>
        </section>
      )}
      {data && data.mentionedIn.length > 0 && (
        <section className="mm-detail-sec">
          <h4>mentioned in</h4>
          <ul>
            {data.mentionedIn
              .slice(0, allMentions ? undefined : MENTIONS_PREVIEW)
              .map(({ node: n, at }) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onFocusNode(n.id)}>
                    <span className="mm-detail-row-text">
                      {n.kind === 'wiki' ? 'Wiki' : 'Gist'} ·{' '}
                      {shortLabel(n, 48, at ?? null)}
                    </span>
                    {at && (
                      <span className="mm-detail-date">{shortDate(at)}</span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
          {data.mentionedIn.length > MENTIONS_PREVIEW && (
            <button
              type="button"
              className="mm-detail-more"
              aria-expanded={allMentions}
              onClick={() => setAllMentions((v) => !v)}
            >
              {allMentions
                ? 'Show fewer'
                : `Show all ${data.mentionedIn.length} →`}
            </button>
          )}
        </section>
      )}
      {otherTotal > 0 && (
        <section className="mm-detail-sec">
          <h4>
            <button
              type="button"
              className="mm-detail-more"
              aria-expanded={otherOpen}
              onClick={() => setOtherOpen((v) => !v)}
            >
              {otherOpen ? '▾' : '▸'} other neighbours · {otherTotal}
            </button>
          </h4>
          {otherOpen &&
            otherGroups.map(([kind, nodes]) => (
              <div key={kind}>
                <h5 className="mm-detail-sub">
                  <KindGlyph kind={kind} /> {kind} · {nodes.length}
                </h5>
                <ul>
                  {nodes
                    .slice(0, allOther ? undefined : OTHER_PREVIEW)
                    .map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onFocusNode(n.id)}>
                          <span className="mm-detail-row-text">
                            {shortLabel(
                              n,
                              48,
                              model.dates.get(n.id)?.last ?? null,
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          {otherOpen && otherTotal > OTHER_PREVIEW && (
            <button
              type="button"
              className="mm-detail-more"
              aria-expanded={allOther}
              onClick={() => setAllOther((v) => !v)}
            >
              {allOther ? 'Show fewer' : 'Show all'}
            </button>
          )}
        </section>
      )}
    </aside>
  )
}
