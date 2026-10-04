/**
 * MapRail — left rail of the Memory Map: colour-by segmented control, kind
 * toggles (shape glyph + count), cluster list, min-connections slider and
 * edge-type toggles.
 */

import { useEffect, useRef, useState } from 'react'
import { EDGE_KIND, EDGE_ORDER, KIND_ORDER, KindGlyph } from './map-kinds'
import type {
  ClusterResult,
  ColourBy,
  EdgeType,
  Kind,
  MapViewState,
} from '../memory-map-graph'

const COLOUR_BY: ReadonlyArray<{ id: ColourBy; label: string }> = [
  { id: 'cluster', label: 'Cluster' },
  { id: 'kind', label: 'Kind' },
  { id: 'age', label: 'Age' },
]

export type MapRailProps = Pick<
  MapViewState,
  'types' | 'kinds' | 'minDegree' | 'colourBy'
> & {
  defaultTypes: Record<EdgeType, boolean>
  defaultKinds: Record<Kind, boolean>
  byType?: Record<EdgeType, number>
  counts: Partial<Record<Kind, number>>
  maxConn: number
  clusters: ClusterResult | null
  selectedCluster: number | null
  onColourBy: (c: ColourBy) => void
  onSelectCluster: (id: number | null) => void
  onToggleType: (t: EdgeType) => void
  onToggleKind: (k: Kind) => void
  onMinConnections: (n: number) => void
  onReset: () => void
}

export function MapRail({
  defaultTypes,
  defaultKinds,
  byType,
  counts,
  maxConn,
  types,
  kinds,
  minDegree,
  colourBy,
  clusters,
  selectedCluster,
  onColourBy,
  onSelectCluster,
  onToggleType,
  onToggleKind,
  onMinConnections,
  onReset,
}: MapRailProps) {
  // Starts expanded (SSR-safe); narrow widths collapse after mount.
  const [collapsed, setCollapsed] = useState(false)
  const railRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 1099px)')
    setCollapsed(mq.matches)
    const on = (e: MediaQueryListEvent) => setCollapsed(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // Publish the occupied width so the canvas fit can keep clear of the rail.
  useEffect(() => {
    const wrap = railRef.current?.parentElement
    const w = railRef.current?.offsetWidth
    wrap?.style.setProperty(
      '--mm-rail-w',
      `${(w || (collapsed ? 40 : 210)) + 24}px`,
    )
    return () => {
      wrap?.style.removeProperty('--mm-rail-w')
    }
  }, [collapsed])
  const filtersActive =
    minDegree > 0 ||
    EDGE_ORDER.some((t) => types[t] !== defaultTypes[t]) ||
    KIND_ORDER.some((k) => kinds[k] !== defaultKinds[k])

  function onSegKey(e: React.KeyboardEvent, i: number) {
    const n = COLOUR_BY.length
    const j =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (i + 1) % n
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (i + n - 1) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1
    if (j < 0) return
    e.preventDefault()
    const next = COLOUR_BY[j]
    onColourBy(next.id)
    ;(
      e.currentTarget.parentElement?.querySelector(
        `[data-seg="${next.id}"]`,
      ) as HTMLElement | null
    )?.focus()
  }

  return (
    <aside
      ref={railRef}
      className={`mm-rail ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Map controls"
    >
      <button
        type="button"
        className={`mm-toggle mm-rail-collapse ${filtersActive ? 'has-filters' : ''}`}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Show' : 'Hide'} map controls${filtersActive ? ' (filters active)' : ''}`}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? '☰' : '‹'}
      </button>
      {!collapsed && (
        <>
          <section className="mm-rail-sec">
            <h3 className="mm-rail-h" id="mm-rail-colour">
              Colour by
            </h3>
            <div
              className="mm-seg"
              role="radiogroup"
              aria-labelledby="mm-rail-colour"
            >
              {COLOUR_BY.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  data-seg={o.id}
                  aria-checked={colourBy === o.id}
                  tabIndex={colourBy === o.id ? 0 : -1}
                  className={`mm-seg-btn ${colourBy === o.id ? 'is-on' : ''}`}
                  onClick={() => onColourBy(o.id)}
                  onKeyDown={(e) => onSegKey(e, i)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {colourBy === 'age' && (
              <div className="mm-age-key" aria-label="Age colours">
                <span>old</span>
                <span className="mm-age-ramp" aria-hidden="true" />
                <span>new</span>
                <span
                  className="mm-cluster-swatch"
                  style={{ background: 'var(--mm-cluster-other)' }}
                  aria-hidden="true"
                />
                <span>undated</span>
              </div>
            )}
          </section>

          <section className="mm-rail-sec">
            <h3 className="mm-rail-h">Show</h3>
            <div role="group" aria-label="Node kinds (toggle visibility)">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mm-legend-item ${kinds[k] ? 'is-on' : ''}`}
                  aria-pressed={kinds[k]}
                  aria-label={`${k} (${counts[k] ?? 0})`}
                  onClick={() => onToggleKind(k)}
                >
                  <KindGlyph kind={k} />
                  {k} <span className="mm-legend-count">{counts[k] ?? 0}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="mm-rail-sec">
            <h3 className="mm-rail-h">Clusters</h3>
            {clusters && clusters.clusters.length > 0 ? (
              <ul className="mm-cluster-list" aria-label="Clusters">
                {clusters.clusters.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`mm-cluster-item ${selectedCluster === c.id ? 'is-on' : ''}`}
                      aria-pressed={selectedCluster === c.id}
                      aria-label={`Cluster ${c.name} (${c.size})`}
                      onClick={() =>
                        onSelectCluster(selectedCluster === c.id ? null : c.id)
                      }
                    >
                      <span
                        className="mm-cluster-swatch"
                        style={{
                          background:
                            c.slot == null
                              ? 'var(--mm-cluster-other)'
                              : `var(--mm-cluster-${c.slot})`,
                        }}
                        aria-hidden="true"
                      />
                      <span className="mm-cluster-name">{c.name}</span>
                      <span className="mm-legend-count">{c.size}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mm-rail-hint">
                {colourBy !== 'cluster'
                  ? 'Clusters appear when colour-by Cluster is active.'
                  : clusters
                    ? 'No clusters'
                    : 'Computing clusters…'}
              </p>
            )}
          </section>

          <section className="mm-rail-sec">
            <label className="mm-filter-slider">
              <span>Min connections: {minDegree}</span>
              <input
                type="range"
                min={0}
                max={maxConn}
                value={minDegree}
                onChange={(e) => onMinConnections(Number(e.target.value))}
                aria-label="Minimum connections"
              />
            </label>
          </section>

          <section className="mm-rail-sec">
            <h3 className="mm-rail-h">Edge types</h3>
            <div
              className="mm-toggles"
              role="group"
              aria-label="Edge type filters"
            >
              {EDGE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`mm-toggle ${types[t] ? 'is-on' : ''}`}
                  aria-pressed={types[t]}
                  onClick={() => onToggleType(t)}
                >
                  <span
                    className="mm-edge-swatch"
                    style={{ background: `var(--mm-${EDGE_KIND[t]})` }}
                    aria-hidden="true"
                  />
                  {t}
                  {byType ? ` (${byType[t]})` : ''}
                </button>
              ))}
            </div>
            <button type="button" className="mm-toggle" onClick={onReset}>
              Reset
            </button>
          </section>
        </>
      )}
    </aside>
  )
}
