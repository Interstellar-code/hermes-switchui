import type { Baseline } from '@/lib/self-improve-types'

interface BaselineChartProps {
  baselines: Array<Baseline>
  profile: string
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return ''
  }
}

function formatScore(n: number): string {
  return (n * 100).toFixed(0) + '%'
}

export function BaselineChart({ baselines, profile }: BaselineChartProps) {
  // Sort oldest → newest; exclude entries with null score
  const sorted = [...baselines]
    .filter((b) => b.profile === profile && b.score !== null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) as Array<Baseline & { score: number }>

  if (sorted.length === 0) {
    return (
      <div className="si-bc-empty">No baseline data yet for <strong>{profile}</strong>.</div>
    )
  }

  if (sorted.length === 1) {
    const b = sorted[0]
    return (
      <div className="si-bc-single">
        <span className="si-bc-single-score">{formatScore(b.score)}</span>
        <span className="si-bc-single-label">baseline · {formatDate(b.created_at)}</span>
      </div>
    )
  }

  // SVG dimensions
  const W = 480
  const H = 140
  const PAD_L = 44
  const PAD_R = 16
  const PAD_T = 12
  const PAD_B = 28

  const scores = sorted.map((b) => b.score)
  const rawMin = Math.min(...scores)
  const rawMax = Math.max(...scores)
  // Add 10% padding to score range; if flat, use ±0.05
  const range = rawMax - rawMin < 0.001 ? 0.1 : (rawMax - rawMin) * 1.2
  const mid = (rawMax + rawMin) / 2
  const yMin = Math.max(0, mid - range / 2)
  const yMax = Math.min(1, mid + range / 2)

  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B

  function xOf(i: number): number {
    return PAD_L + (i / (sorted.length - 1)) * chartW
  }
  function yOf(score: number): number {
    return PAD_T + chartH - ((score - yMin) / (yMax - yMin)) * chartH
  }

  const points = sorted.map((b, i) => ({ x: xOf(i), y: yOf(b.score), b }))
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ')

  // Y axis ticks (3)
  const yTicks = [yMin, (yMin + yMax) / 2, yMax]

  // X axis labels: first, last, and up to 3 middle ones
  const labelIdxs = new Set<number>([0, sorted.length - 1])
  if (sorted.length >= 3) labelIdxs.add(Math.floor((sorted.length - 1) / 2))
  if (sorted.length >= 5) {
    labelIdxs.add(Math.floor((sorted.length - 1) / 4))
    labelIdxs.add(Math.floor((3 * (sorted.length - 1)) / 4))
  }

  return (
    <div className="si-bc-wrap">
      <svg
        className="si-bc-svg"
        viewBox={`0 0 ${W} ${H}`}
        aria-label={`Baseline score curve for ${profile}`}
      >
        {/* Grid lines */}
        {yTicks.map((tick) => (
          <line
            key={tick}
            x1={PAD_L}
            y1={yOf(tick)}
            x2={W - PAD_R}
            y2={yOf(tick)}
            className="si-bc-grid"
          />
        ))}

        {/* Y axis labels */}
        {yTicks.map((tick) => (
          <text key={tick} x={PAD_L - 6} y={yOf(tick) + 4} className="si-bc-axis-label" textAnchor="end">
            {formatScore(tick)}
          </text>
        ))}

        {/* Area fill */}
        <polygon
          points={[
            `${PAD_L},${PAD_T + chartH}`,
            ...points.map((p) => `${p.x},${p.y}`),
            `${W - PAD_R},${PAD_T + chartH}`,
          ].join(' ')}
          className="si-bc-area"
        />

        {/* Line */}
        <polyline points={polyline} className="si-bc-line" />

        {/* Data points with tooltips */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3.5} className="si-bc-dot">
            <title>{`${formatScore(p.b.score)} · ${p.b.created_at.slice(0, 10)}`}</title>
          </circle>
        ))}

        {/* X axis labels */}
        {[...labelIdxs].sort((a, b) => a - b).map((i) => (
          <text
            key={i}
            x={xOf(i)}
            y={H - 4}
            className="si-bc-axis-label"
            textAnchor={i === 0 ? 'start' : i === sorted.length - 1 ? 'end' : 'middle'}
          >
            {formatDate(sorted[i].created_at)}
          </text>
        ))}
      </svg>
    </div>
  )
}
