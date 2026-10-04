/**
 * Focus-mode chrome for the Memory Map: breadcrumb, depth / edge-type
 * controls and the "edge types in view" legend. State lives in memory-map.tsx.
 */

import { EDGE_KIND, EDGE_ORDER } from './map-kinds'
import type { Ego } from './focus'
import type { ClusterResult, EdgeType, MapViewState } from '../memory-map-graph'

const HOPS: ReadonlyArray<1 | 2> = [1, 2]
/** breadcrumb shows at most this many earlier steps */
const TRAIL_SHOWN = 3

export function FocusBar({
  focus,
  ego,
  trail,
  label,
  cluster,
  backRef,
  onExit,
  onCluster,
  onRecentre,
  onHops,
  onTypes,
}: {
  focus: NonNullable<MapViewState['focus']>
  ego: Ego
  trail: ReadonlyArray<string>
  label: (id: string) => string
  cluster: ClusterResult['clusters'][number] | undefined
  backRef: React.RefObject<HTMLButtonElement | null>
  onExit: () => void
  /** leave focus and highlight this cluster on the map */
  onCluster: (id: number) => void
  onRecentre: (id: string) => void
  onHops: (hops: 1 | 2) => void
  onTypes: (types: Set<EdgeType>) => void
}) {
  const allOn = EDGE_ORDER.every((t) => focus.types.has(t))
  const earlier = trail.slice(0, -1).slice(-TRAIL_SHOWN)
  const inView = EDGE_ORDER.filter((t) => (ego.typeCounts[t] ?? 0) > 0)
  return (
    <div className="mm-focus-chrome">
      <div className="mm-focus-bar" role="group" aria-label="Focus mode">
        <nav className="mm-crumb" aria-label="Focus path">
          <button type="button" className="mm-link-btn" onClick={onExit}>
            All memory
          </button>
          {cluster && (
            <>
              <span aria-hidden="true"> › </span>
              <button
                type="button"
                className="mm-link-btn"
                title="Back to the map with this cluster highlighted"
                onClick={() => onCluster(cluster.id)}
              >
                {cluster.name}
              </button>
            </>
          )}
          {trail.length - 1 > earlier.length && (
            <span aria-hidden="true"> › …</span>
          )}
          {earlier.map((id) => (
            <span key={id}>
              <span aria-hidden="true"> › </span>
              <button
                type="button"
                className="mm-link-btn"
                onClick={() => onRecentre(id)}
              >
                {label(id)}
              </button>
            </span>
          ))}
          <span aria-hidden="true"> › </span>
          <b aria-current="location">{label(focus.id)}</b>
        </nav>
        <span className="mm-focus-lbl" aria-hidden="true">
          Depth
        </span>
        <div className="mm-seg" role="group" aria-label="Depth">
          {HOPS.map((h) => (
            <button
              key={h}
              type="button"
              className={`mm-seg-btn ${focus.hops === h ? 'is-on' : ''}`}
              aria-pressed={focus.hops === h}
              onClick={() => onHops(h)}
            >
              {h === 1 ? '1 hop' : '2 hops'}
            </button>
          ))}
        </div>
        <span className="mm-focus-lbl" aria-hidden="true">
          Edges
        </span>
        <div className="mm-seg" role="group" aria-label="Edge types">
          <button
            type="button"
            className={`mm-seg-btn ${allOn ? 'is-on' : ''}`}
            aria-pressed={allOn}
            onClick={() => onTypes(new Set(EDGE_ORDER))}
          >
            all
          </button>
          {EDGE_ORDER.map((t) => {
            const on = focus.types.has(t)
            return (
              <button
                key={t}
                type="button"
                className={`mm-seg-btn ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  // toggle; the last type on cannot be turned off
                  const next = new Set(focus.types)
                  if (on) next.delete(t)
                  else next.add(t)
                  if (next.size > 0) onTypes(next)
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
        <button
          ref={backRef}
          type="button"
          className="mm-toggle mm-focus-back"
          onClick={onExit}
        >
          Esc · back to map
        </button>
      </div>
      <div
        className="mm-focus-legend"
        role="group"
        aria-label="Edge types in view"
      >
        <div className="mm-focus-lbl" aria-hidden="true">
          Edge types in view
        </div>
        {inView.length === 0 && (
          <div className="mm-focus-note">No links of these types.</div>
        )}
        {inView.map((t) => (
          <div key={t} className="mm-focus-et">
            <span
              className="mm-edge-swatch"
              style={{ background: `var(--mm-${EDGE_KIND[t]})` }}
              aria-hidden="true"
            />
            {t}
            <span className="mm-legend-count">{ego.typeCounts[t]}</span>
          </div>
        ))}
        <div className="mm-focus-note" role="status">
          {ego.ring1.length} direct
          {ego.more1 > 0 && ` (+${ego.more1} more)`}
          {focus.hops === 2 &&
            ` · ${ego.ring2.length} at 2 hops${
              ego.more2 > 0 ? ` (+${ego.more2} more via shown nodes)` : ''
            }`}
        </div>
      </div>
    </div>
  )
}
