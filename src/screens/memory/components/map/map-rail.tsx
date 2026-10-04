/**
 * MapRail — Memory Map filter controls: edge-type toggles + min-connections
 * slider (Filters popover) and the kind legend toggles.
 *
 * Phase 0 split from memory-map.tsx with the original DOM/placement; Lane E
 * moves these into a left rail.
 */

import { EDGE_KIND, EDGE_ORDER, KIND_ORDER, KindGlyph } from './map-kinds'
import type { EdgeType, Kind, MapViewState } from '../memory-map-graph'

/** View-state props share MapViewState's names (Lane E adds colourBy / selectedCluster). */
export type MapRailProps = Pick<
  MapViewState,
  'types' | 'kinds' | 'minDegree'
> & {
  filtersOpen: boolean
  byType?: Record<EdgeType, number>
  counts: Partial<Record<Kind, number>>
  maxConn: number
  onToggleType: (t: EdgeType) => void
  onToggleKind: (k: Kind) => void
  onMinConnections: (n: number) => void
  onReset: () => void
}

export function MapRail({
  filtersOpen,
  byType,
  counts,
  maxConn,
  types,
  kinds,
  minDegree,
  onToggleType,
  onToggleKind,
  onMinConnections,
  onReset,
}: MapRailProps) {
  return (
    <>
      {filtersOpen && (
        <div
          className="mm-filter-panel"
          role="group"
          aria-label="Graph filters"
        >
          <div className="mm-filter-row">
            <span className="mm-filter-label">Edge types</span>
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
          </div>
          <div className="mm-filter-row">
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
            <button type="button" className="mm-toggle" onClick={onReset}>
              Reset
            </button>
          </div>
        </div>
      )}

      <div
        className="mm-legend"
        role="group"
        aria-label="Node kinds (toggle visibility)"
      >
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
    </>
  )
}
