import { useMemo } from 'react'
import { nodeColor as colorFor } from '../node-colors'
import { parseDagFromYaml } from './parse-dag'
import type { DagInfo } from './parse-dag'

/** Types shown in the wizard's DAG preview legend. */
export const WIZARD_LEGEND_TYPES = [
  'prompt',
  'bash',
  'command',
  'approval',
  'router',
  'loop',
]

export interface DagSvgProps {
  dag: DagInfo
  extraCount: number
}

export function DagSvg({ dag, extraCount }: DagSvgProps) {
  const { positioned, edges } = dag
  if (positioned.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '32px 0',
          opacity: 0.5,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          width="36"
          height="36"
        >
          <rect x="3" y="8" width="6" height="8" rx="1" />
          <rect x="9" y="5" width="6" height="5" rx="1" />
          <rect x="9" y="14" width="6" height="5" rx="1" />
          <rect x="15" y="8" width="6" height="8" rx="1" />
        </svg>
        <div
          style={{
            font: '500 11px var(--m-font-mono)',
            color: 'var(--m-text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '.15em',
            marginTop: 10,
          }}
        >
          Visual DAG — view only
        </div>
        <div
          style={{
            font: '400 12px var(--m-font-sans)',
            color: 'var(--m-text-ghost)',
            marginTop: 4,
          }}
        >
          No nodes defined
        </div>
      </div>
    )
  }

  const W = 110,
    H = 34,
    R = 5
  const posMap: Map<string, { cx: number; cy: number }> = new Map()
  positioned.forEach((n) => {
    posMap.set(n.id, { cx: n.cx, cy: n.cy })
  })

  const svgW = Math.max(...positioned.map((n) => n.cx + W / 2)) + 24
  const svgH = Math.max(...positioned.map((n) => n.cy + H / 2)) + 24

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%' }}>
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ width: '100%', maxWidth: svgW, display: 'block' }}
      >
        <defs>
          <marker
            id="wz-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 2 L 8 5 L 0 8 z" fill="rgba(0,255,65,.35)" />
          </marker>
        </defs>

        {/* edges */}
        {edges.map(([a, b], i) => {
          const s = posMap.get(a)
          const t = posMap.get(b)
          if (!s || !t) return null
          const sx = s.cx + W / 2,
            sy = s.cy
          const tx = t.cx - W / 2,
            ty = t.cy
          const mx = (sx + tx) / 2
          return (
            <path
              key={i}
              d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
              fill="none"
              stroke="rgba(0,255,65,.25)"
              strokeWidth="1.5"
              markerEnd="url(#wz-arrow)"
            />
          )
        })}

        {/* nodes */}
        {positioned.map((n) => {
          const c = colorFor(n.type)
          return (
            <g key={n.id} style={{ cursor: 'default' }}>
              <rect
                x={n.cx - W / 2}
                y={n.cy - H / 2}
                width={W}
                height={H}
                rx={R}
                fill="rgba(4,16,8,.9)"
                stroke={c}
                strokeWidth="1"
              />
              <text
                x={n.cx}
                y={n.cy - 4}
                textAnchor="middle"
                style={{
                  font: '600 10px var(--m-font-mono)',
                  fill: c,
                  letterSpacing: '.08em',
                }}
              >
                {n.id.length > 14 ? n.id.slice(0, 13) + '…' : n.id}
              </text>
              <text
                x={n.cx}
                y={n.cy + 9}
                textAnchor="middle"
                style={{
                  font: '500 9px var(--m-font-mono)',
                  fill: c,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  opacity: 0.7,
                }}
              >
                {n.type}
              </text>
            </g>
          )
        })}
      </svg>

      {/* +N more badge */}
      {extraCount > 0 && (
        <div
          style={{
            font: '500 10px var(--m-font-mono)',
            color: 'var(--m-text-faint)',
            textAlign: 'center',
            marginTop: 4,
          }}
        >
          +{extraCount} more nodes
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 14px',
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid var(--m-border-subtle)',
        }}
      >
        {WIZARD_LEGEND_TYPES.map((t) => [t, colorFor(t)] as const).map(
          ([t, c]) => (
            <span
              key={t}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                font: '400 10px var(--m-font-mono)',
                color: 'var(--m-text-faint)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: c,
                  boxShadow: `0 0 4px ${c}`,
                  display: 'inline-block',
                }}
              />
              {t}
            </span>
          ),
        )}
      </div>
    </div>
  )
}

export interface DesignStepProps {
  yaml: string
}

export function DesignStep({ yaml }: DesignStepProps) {
  const dag = useMemo(() => parseDagFromYaml(yaml), [yaml])

  if ('error' in dag) {
    return (
      <div className="wz-route">
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(255,90,90,.07)',
            border: '1px solid rgba(255,90,90,.25)',
            borderRadius: 6,
            font: '400 12px var(--m-font-mono)',
            color: '#ff5fa2',
          }}
        >
          Could not parse YAML — fix it on Step 4 and come back.
          <span
            style={{
              color: 'var(--m-text-ghost)',
              display: 'block',
              marginTop: 4,
              fontSize: 11,
            }}
          >
            {dag.error}
          </span>
        </div>
      </div>
    )
  }

  const extraCount = dag.node_count - dag.positioned.length
  const typeCounts = Object.entries(dag.node_type_counts)
  // Heuristic: ~1 min per node (rough estimate)
  const estMin = dag.node_count

  return (
    <div className="wz-route">
      <div className="route-note">
        Proposed DAG structure based on your YAML definition. Node types and
        layout are auto-computed.
      </div>

      {/* SVG DAG canvas */}
      <div
        style={{
          marginTop: 8,
          padding: '14px 12px',
          background: 'var(--m-bg-deep)',
          border: '1px solid var(--m-border-subtle)',
          borderRadius: 6,
        }}
      >
        <DagSvg dag={dag} extraCount={extraCount} />
      </div>

      {/* Breakdown + Estimates */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginTop: 6,
        }}
      >
        <div className="panel-card">
          <div className="pc-head">Node Breakdown</div>
          <div className="pc-body node-breakdown">
            {typeCounts.length === 0 ? (
              <div className="nb-row">
                <span
                  className="nb-type"
                  style={{ color: 'var(--m-text-ghost)' }}
                >
                  —
                </span>
              </div>
            ) : (
              typeCounts.map(([t, n]) => {
                const c = colorFor(t)
                return (
                  <div key={t} className="nb-row">
                    <span
                      className="nb-dot"
                      style={{ background: c, boxShadow: `0 0 5px ${c}` }}
                    />
                    <span className="nb-type">{t}</span>
                    <span className="nb-n">{n}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
        <div className="panel-card">
          <div className="pc-head">Estimates</div>
          <div className="pc-body node-breakdown">
            {(
              [
                ['Nodes', String(dag.node_count)],
                ['DAG Depth', String(dag.depth)],
                ['Parallelism', String(dag.parallelism)],
                ['Est. time', `~${estMin} min`],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k} className="nb-row">
                <span className="nb-type" style={{ flex: 1 }}>
                  {k}
                </span>
                <span className="nb-n">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
