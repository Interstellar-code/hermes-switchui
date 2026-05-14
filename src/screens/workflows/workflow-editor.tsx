import type React from 'react'
import { useState } from 'react'
import { MOCK_WORKFLOWS, relativeTime, type MockWorkflow, type NodeType } from './mock-workflows'

// ── Constants ────────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Visual DAG', 'YAML', 'When-to-Use', 'History'] as const
type Tab = (typeof TABS)[number]

const NODE_COLOR: Record<NodeType, string> = {
  prompt: '#00ff41',
  bash: '#5ad3ff',
  command: '#bf97ff',
  approval: '#ffb454',
  router: '#ff6b6b',
  loop: '#ffd700',
}

const MOCK_HISTORY = [
  { id: 'run-a1b2', started_at: '2026-05-13 09:14', status: 'success', duration: '4m 12s', triggered_by: 'rohit', phase: 'merge' },
  { id: 'run-c3d4', started_at: '2026-05-12 22:03', status: 'success', duration: '3m 58s', triggered_by: 'hermes-agent', phase: 'merge' },
  { id: 'run-e5f6', started_at: '2026-05-12 15:41', status: 'failed',  duration: '1m 07s', triggered_by: 'rohit', phase: 'validate' },
  { id: 'run-g7h8', started_at: '2026-05-11 11:27', status: 'success', duration: '5m 33s', triggered_by: 'rohit', phase: 'merge' },
  { id: 'run-i9j0', started_at: '2026-05-10 08:55', status: 'success', duration: '4m 41s', triggered_by: 'hermes-agent', phase: 'merge' },
  { id: 'run-k1l2', started_at: '2026-05-09 17:19', status: 'cancelled', duration: '0m 22s', triggered_by: 'rohit', phase: 'invest' },
  { id: 'run-m3n4', started_at: '2026-05-08 10:03', status: 'success', duration: '3m 50s', triggered_by: 'rohit', phase: 'merge' },
]

// ── YAML syntax highlighter ───────────────────────────────────────────────────

function yamlLine(line: string, idx: number): React.ReactElement {
  // comment
  if (/^\s*#/.test(line)) {
    return <span key={idx} className="yl-line"><span className="yt-comment">{line}</span>{'\n'}</span>
  }
  // key: value
  const kvMatch = line.match(/^(\s*)([^:\s][^:]*?)(\s*:\s*)(.*)$/)
  if (kvMatch) {
    const [, indent, key, colon, value] = kvMatch
    let valueEl: React.ReactElement
    if (value === '' || value === '|' || value === '>') {
      valueEl = <span className="yt-punct">{value}</span>
    } else if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
      valueEl = <span className="yt-string">{value}</span>
    } else if (/^\d+(\.\d+)?$/.test(value)) {
      valueEl = <span className="yt-number">{value}</span>
    } else if (value.startsWith('[') || value.startsWith('{')) {
      valueEl = <span className="yt-string">{value}</span>
    } else {
      valueEl = <span className="yt-value">{value}</span>
    }
    return (
      <span key={idx} className="yl-line">
        {indent}<span className="yt-key">{key}</span><span className="yt-punct">{colon}</span>{valueEl}{'\n'}
      </span>
    )
  }
  // list item
  if (/^\s*-\s/.test(line)) {
    const m = line.match(/^(\s*-\s)(.*)$/)
    if (m) {
      return (
        <span key={idx} className="yl-line">
          <span className="yt-punct">{m[1]}</span><span className="yt-string">{m[2]}</span>{'\n'}
        </span>
      )
    }
  }
  return <span key={idx} className="yl-line">{line}{'\n'}</span>
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: MockWorkflow['source'] }) {
  return <span className={`wfl-src-badge wfl-src-${source}`}>{source}</span>
}

function RunStatusBadge({ status }: { status: string }) {
  const cls = status === 'success' ? 'run-ok' : status === 'failed' ? 'run-fail' : 'run-cancel'
  return <span className={`run-status ${cls}`}>{status}</span>
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ wf }: { wf: MockWorkflow }) {
  // Compute node breakdown from dag
  const nodeBreakdown: Record<string, number> = {}
  for (const n of wf.dag) {
    nodeBreakdown[n.type] = (nodeBreakdown[n.type] ?? 0) + 1
  }
  // If no dag nodes, use node_count as total prompt nodes
  if (wf.dag.length === 0) {
    nodeBreakdown['prompt'] = wf.node_count
  }

  const initials = wf.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="overview-tab">
      <div className="ov-hero">
        <div className="ov-icon">{initials}</div>
        <div className="ov-title-block">
          <h2 className="ov-name">{wf.name}</h2>
          <div className="ov-meta">
            <SourceBadge source={wf.source} />
            <span className="ov-sep">·</span>
            <span className="ov-tier">{wf.version_tier}</span>
          </div>
        </div>
      </div>

      <p className="ov-desc">{wf.description}</p>

      <div className="ov-stat-row">
        {([
          ['Nodes', wf.node_count, ''],
          ['DAG Depth', wf.dag_depth, ''],
          ['Parallelism', wf.max_parallelism, ''],
          ['Runs', wf.run_count, 'ok'],
        ] as const).map(([label, value, cls]) => (
          <div key={label} className="ov-stat">
            <span className={`ov-sv${cls ? ' ' + cls : ''}`}>{value}</span>
            <span className="ov-sl">{label}</span>
          </div>
        ))}
        <div className="ov-stat">
          <span className="ov-sv">{relativeTime(wf.last_used_at)}</span>
          <span className="ov-sl">Last used</span>
        </div>
      </div>

      <div className="panel-card">
        <div className="pc-head">Inputs</div>
        <div className="pc-body">
          {wf.required_inputs.map((r) => (
            <div key={r} className="input-row req">
              <span className="ir-name">{r}</span>
              <span className="ir-badge req">required</span>
            </div>
          ))}
          {wf.optional_inputs.map((o) => (
            <div key={o} className="input-row">
              <span className="ir-name">{o}</span>
              <span className="ir-badge">optional</span>
            </div>
          ))}
          {wf.required_inputs.length === 0 && wf.optional_inputs.length === 0 && (
            <span className="pc-empty">No inputs defined</span>
          )}
        </div>
      </div>

      <div className="ov-grid2">
        <div className="panel-card">
          <div className="pc-head">Node Breakdown</div>
          <div className="pc-body node-breakdown">
            {Object.entries(nodeBreakdown).map(([type, count]) => (
              <div key={type} className="nb-row">
                <span
                  className="nb-dot"
                  style={{
                    background: NODE_COLOR[type as NodeType] ?? '#aaa',
                    boxShadow: `0 0 5px ${NODE_COLOR[type as NodeType] ?? '#aaa'}`,
                  }}
                />
                <span className="nb-type">{type}</span>
                <span className="nb-n">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel-card">
          <div className="pc-head">Tags</div>
          <div className="pc-body tag-list">
            {wf.tags.map((t) => (
              <span key={t} className="tag-chip">{t}</span>
            ))}
            {wf.has_loop && <span className="tag-chip tag-loop">has-loop</span>}
            {wf.has_approval && <span className="tag-chip tag-approval">has-approval</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Visual DAG Tab ────────────────────────────────────────────────────────────

function DagSvgTab({ wf }: { wf: MockWorkflow }) {
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null)

  if (wf.dag.length === 0) {
    return (
      <div className="dag-placeholder">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          width="36"
          height="36"
          style={{ opacity: 0.3 }}
        >
          <rect x="3" y="8" width="6" height="8" rx="1" />
          <rect x="9" y="5" width="6" height="5" rx="1" />
          <rect x="9" y="14" width="6" height="5" rx="1" />
          <rect x="15" y="8" width="6" height="8" rx="1" />
          <path d="M9 12H9M15 12H15M9 7.5h-3M15 7.5h3M9 16.5h-3M15 16.5h3" />
        </svg>
        <div className="dag-ph-title">Visual DAG — view only</div>
        <div className="dag-ph-sub">No DAG defined for this workflow</div>
      </div>
    )
  }

  const W = 110
  const H = 34
  const R = 5
  const PAD = 20

  const posMap: Record<string, { x: number; y: number }> = {}
  for (const n of wf.dag) posMap[n.id] = { x: n.cx, y: n.cy }

  const svgW = Math.max(...wf.dag.map((n) => n.cx + W / 2)) + PAD
  const svgH = Math.max(...wf.dag.map((n) => n.cy + H / 2)) + PAD

  const tooltipNode = tooltip ? wf.dag.find((n) => n.id === tooltip.id) : null

  return (
    <div className="dag-canvas" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', maxWidth: `${svgW}px` }}>
        <defs>
          {Object.entries(NODE_COLOR).map(([t]) => (
            <filter key={t} id={`glow-${t}`} x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
          <marker
            id="arrow"
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
        {wf.dag_edges.map(([a, b], i) => {
          const s = posMap[a]
          const t = posMap[b]
          if (!s || !t) return null
          const sx = s.x + W / 2
          const sy = s.y
          const tx = t.x - W / 2
          const ty = t.y
          const mx = (sx + tx) / 2
          return (
            <path
              key={i}
              d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
              fill="none"
              stroke="rgba(0,255,65,.25)"
              strokeWidth="1.5"
              markerEnd="url(#arrow)"
            />
          )
        })}

        {/* nodes */}
        {wf.dag.map((n) => {
          const c = NODE_COLOR[n.type] ?? '#00ff41'
          return (
            <g
              key={n.id}
              className="dag-node"
              style={{ cursor: 'default' }}
              onMouseEnter={() => setTooltip({ id: n.id, x: n.cx, y: n.cy })}
              onMouseLeave={() => setTooltip(null)}
            >
              <rect
                x={n.cx - W / 2}
                y={n.cy - H / 2}
                width={W}
                height={H}
                rx={R}
                fill="rgba(4,16,8,.9)"
                stroke={c}
                strokeWidth="1"
                filter={`url(#glow-${n.type})`}
              />
              <text
                x={n.cx}
                y={n.cy - 3}
                textAnchor="middle"
                style={{
                  font: '600 10px var(--m-font-mono, ui-monospace, monospace)',
                  fill: '#e8ffe8',
                  letterSpacing: '.04em',
                }}
              >
                {n.label}
              </text>
              <text
                x={n.cx}
                y={n.cy + 10}
                textAnchor="middle"
                style={{
                  font: '500 8px var(--m-font-mono, ui-monospace, monospace)',
                  fill: c,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                }}
              >
                {n.type}
              </text>
            </g>
          )
        })}
      </svg>

      {/* tooltip */}
      {tooltipNode && (
        <div
          className="dag-tooltip"
          style={{
            position: 'absolute',
            top: `${tooltip!.y + H / 2 + 6}px`,
            left: `${tooltip!.x}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="dag-tt-id">{tooltipNode.id}</div>
          <div className="dag-tt-type" style={{ color: NODE_COLOR[tooltipNode.type] }}>
            {tooltipNode.type}
          </div>
          {tooltipNode.config && <div className="dag-tt-cfg">{tooltipNode.config}</div>}
        </div>
      )}

      {/* legend */}
      <div className="dag-legend">
        {Object.entries(NODE_COLOR).map(([type, color]) => (
          <span key={type} className="dag-leg-item">
            <span
              style={{
                background: color,
                width: 8,
                height: 8,
                borderRadius: 2,
                display: 'inline-block',
                marginRight: 5,
                boxShadow: `0 0 4px ${color}`,
              }}
            />
            {type}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── YAML Tab ──────────────────────────────────────────────────────────────────

function detectYamlErrors(yaml: string): string[] {
  const errors: string[] = []
  const lines = yaml.split('\n')
  lines.forEach((line, i) => {
    // unbalanced braces
    const opens = (line.match(/\{/g) ?? []).length
    const closes = (line.match(/\}/g) ?? []).length
    if (opens !== closes) errors.push(`Line ${i + 1}: unbalanced braces — '${line.trim()}'`)
    // key without colon (bare word on its own line that looks like a key)
    if (/^[a-zA-Z_][a-zA-Z0-9_]+ [^:=]/.test(line.trim())) {
      errors.push(`Line ${i + 1}: missing colon after key — '${line.trim()}'`)
    }
  })
  return errors
}

function YamlTab({ wf }: { wf: MockWorkflow }) {
  const lines = wf.yaml.split('\n')
  const isEditable = wf.source !== 'bundled'
  const yamlErrors = detectYamlErrors(wf.yaml)
  return (
    <div className="yaml-tab">
      <div className="yaml-toolbar">
        <div className="yt-left">
          {!isEditable && (
            <>
              <span className="bundled-lock-badge">🔒 bundled</span>
              <button
                className="btn-mini"
                style={{ marginLeft: 8 }}
                onClick={() => window.dispatchEvent(new CustomEvent('wf-toast', { detail: { msg: 'Duplicate as user workflow coming v1.1' } }))}
              >
                Duplicate as user workflow
              </button>
            </>
          )}
          {isEditable && <span className="editable-indicator">● Editable</span>}
        </div>
        <div className="yt-right">
          <button className="btn-mini" disabled>Validate</button>
          <button className="btn-mini" disabled>Format</button>
          {isEditable && (
            <>
              <button className="btn-mini" disabled>Revert</button>
              <button className="btn-mini prim" disabled>Save</button>
            </>
          )}
        </div>
      </div>
      <div className="yaml-body">
        <div className="yn-gutter">
          {lines.map((_, i) => (
            <div key={i} className="yn">{i + 1}</div>
          ))}
        </div>
        <pre className="wfe-yaml-code yaml-code">{lines.map((l, i) => yamlLine(l, i))}</pre>
      </div>
      {yamlErrors.length > 0 && (
        <div className="yaml-diagnostics">
          <div className="yaml-diag-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            {yamlErrors.length} YAML validation {yamlErrors.length === 1 ? 'error' : 'errors'}
          </div>
          <ul className="yaml-diag-list">
            {yamlErrors.map((e, i) => (
              <li key={i} className="yaml-diag-item">{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── When-to-Use Tab ───────────────────────────────────────────────────────────

function WhenToUseTab({ wf }: { wf: MockWorkflow }) {
  return (
    <div className="wtu-tab">
      <div className="wtu-info">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          width="14"
          height="14"
          style={{ color: '#5fcfff', flexShrink: 0 }}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          The <code>when_to_use</code> field powers Hermes' plan-phase suggestions — agents read it
          to decide which workflow to recommend to users during chat.
        </span>
      </div>
      <div className="panel-card">
        <div className="pc-head">
          when_to_use
          <span className="pc-head-tag">MARKDOWN</span>
        </div>
        <div className="pc-body">
          <textarea className="wtu-editor" defaultValue={wf.when_to_use} readOnly={wf.source === 'bundled'} />
        </div>
      </div>
      <div className="panel-card">
        <div className="pc-head">Required Inputs Preview</div>
        <div className="pc-body">
          <div className="wtu-hint">
            These are surfaced to the user during the plan phase when this workflow is proposed.
          </div>
          {wf.required_inputs.map((r) => (
            <div key={r} className="input-row req">
              <span className="ir-name">{r}</span>
              <span className="ir-badge req">required</span>
            </div>
          ))}
          {wf.required_inputs.length === 0 && (
            <span className="pc-empty">No required inputs</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab({ wf }: { wf: MockWorkflow }) {
  return (
    <div className="history-tab">
      <div className="history-header">
        <span className="hist-subtitle">
          Showing last {MOCK_HISTORY.length} runs of{' '}
          <strong style={{ color: 'var(--m-text, var(--theme-fg))' }}>{wf.name}</strong>
        </span>
        <a href="/conductor" className="link-out">View all in Conductor →</a>
      </div>
      <table className="hist-table">
        <thead>
          <tr>
            <th>Run ID</th>
            <th>Started</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Triggered by</th>
            <th>Phase reached</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {MOCK_HISTORY.map((r) => (
            <tr key={r.id}>
              <td className="run-id">{r.id}</td>
              <td>{r.started_at}</td>
              <td>
                <RunStatusBadge status={r.status} />
              </td>
              <td className="run-dur">{r.duration}</td>
              <td>
                <span className="run-who">{r.triggered_by}</span>
              </td>
              <td className="run-phase">{r.phase}</td>
              <td>
                <a href="/conductor" className="link-out" style={{ fontSize: 10 }}>
                  View in Conductor →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EditorEmptyState() {
  return (
    <div className="wf-editor-empty">
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        width="52"
        height="52"
        style={{ opacity: 0.22 }}
      >
        <rect x="4" y="8" width="12" height="32" rx="2" />
        <rect x="20" y="8" width="8" height="20" rx="2" />
        <rect x="20" y="32" width="8" height="8" rx="2" />
        <rect x="32" y="8" width="12" height="32" rx="2" />
        <path d="M16 16h4M16 24h4M16 32h4" />
      </svg>
      <div className="es-title">Select a workflow on the left or create a new one.</div>
      <div className="es-sub">The editor will appear here.</div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface WorkflowEditorProps {
  selectedId: string | null
}

export function WorkflowEditor({ selectedId }: WorkflowEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const wf = selectedId ? MOCK_WORKFLOWS.find((w) => w.id === selectedId) ?? null : null

  if (!wf) {
    return <EditorEmptyState />
  }

  return (
    <>
      {/* top bar inside editor */}
      <div className="ed-topbar">
        <div className="ed-crumbs">
          <span>Workflows</span>
          <span className="ed-sep">/</span>
          <span className="ed-cur">{wf.name}</span>
        </div>
        <div className="ed-tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={activeTab === t ? 'on' : ''}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* scrollable body */}
      <div className="ed-body">
        {activeTab === 'Overview' && <OverviewTab wf={wf} />}
        {activeTab === 'Visual DAG' && <DagSvgTab wf={wf} />}
        {activeTab === 'YAML' && <YamlTab wf={wf} />}
        {activeTab === 'When-to-Use' && <WhenToUseTab wf={wf} />}
        {activeTab === 'History' && <HistoryTab wf={wf} />}
      </div>
    </>
  )
}
