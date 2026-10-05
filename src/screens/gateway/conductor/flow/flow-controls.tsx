import { Panel, useReactFlow, useStore } from '@xyflow/react'

interface FlowControlsProps {
  locked: boolean
  /** No workflow id = nothing to persist the lock to. */
  lockDisabled?: boolean
  onToggleLock: () => void
  minimap: boolean
  onToggleMinimap: () => void
  onFit: () => void
  /** Zoom buttons count as a manual move (auto-fit stops). */
  onZoom: () => void
  /** Readout prefix: 'FIT' while auto-fitted, or `centred on <id>` after a focus. */
  mode: 'fit' | 'free' | { centredOn: string }
}

const icon = (d: string) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
)

export function FlowControls({
  locked,
  lockDisabled = false,
  onToggleLock,
  minimap,
  onToggleMinimap,
  onFit,
  onZoom,
  mode,
}: FlowControlsProps) {
  const { zoomIn, zoomOut } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  const pct = `${Math.round(zoom * 100)}%`
  const readout =
    mode === 'fit'
      ? `FIT · ${pct}`
      : mode === 'free'
        ? pct
        : `${pct} · centred on ${mode.centredOn}`

  return (
    <Panel position="bottom-left" className="flow-ctl-panel">
      <div className="flow-ctl" role="toolbar" aria-label="Canvas controls">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => {
            onZoom()
            void zoomIn({ duration: 150 })
          }}
        >
          {icon('M8 3v10M3 8h10')}
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => {
            onZoom()
            void zoomOut({ duration: 150 })
          }}
        >
          {icon('M3 8h10')}
        </button>
        <button type="button" aria-label="Fit view" onClick={onFit}>
          FIT
        </button>
        <button
          type="button"
          aria-label="Lock node positions"
          aria-pressed={locked}
          disabled={lockDisabled}
          onClick={onToggleLock}
        >
          {icon(
            locked
              ? 'M3 7h10v7H3zM5 7V5a3 3 0 0 1 6 0v2'
              : 'M3 7h10v7H3zM5 7V5a3 3 0 0 1 5.8-1',
          )}
        </button>
        <button
          type="button"
          aria-label="Minimap"
          aria-pressed={minimap}
          onClick={onToggleMinimap}
        >
          {icon('M2 3h12v10H2zM9 8h4v4H9z')}
        </button>
      </div>
      <span className="flow-zm">{readout}</span>
    </Panel>
  )
}
