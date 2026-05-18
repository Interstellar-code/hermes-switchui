import { useState } from 'react'
import { useWorkflowEvents } from './use-workflow-events'
import {
  useDeleteWorkflowDefinition,
  useUpsertWorkflowDefinition,
  useWorkflowParsed,
  useWorkflowRuns,
} from './use-workflows'
import { relativeTime } from './types'
import type React from 'react'
import type { WorkflowDefinitionRow, WorkflowRunRow } from './api-client'
import type { NodeType, ParsedWorkflow, WorkflowDagNode } from './types'

// ── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  'Overview',
  'Visual DAG',
  'YAML',
  'When-to-Use',
  'History',
] as const
type Tab = (typeof TABS)[number]

const NODE_COLOR: Record<NodeType, string> = {
  prompt: '#00ff41',
  bash: '#5ad3ff',
  command: '#bf97ff',
  approval: '#ffb454',
  router: '#ff6b6b',
  loop: '#ffd700',
  cancel: '#ff6b6b',
  script: '#5ad3ff',
}

function formatRunStartedAt(value: WorkflowRunRow['started_at']): string {
  const ms =
    typeof value === 'number'
      ? value * (value < 1e12 ? 1000 : 1)
      : new Date(value).getTime()
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

function formatRunDuration(run: WorkflowRunRow): string {
  if (run.completed_at == null) return '—'
  const start =
    typeof run.started_at === 'number'
      ? run.started_at * (run.started_at < 1e12 ? 1000 : 1)
      : new Date(run.started_at).getTime()
  const end =
    typeof run.completed_at === 'number'
      ? run.completed_at * (run.completed_at < 1e12 ? 1000 : 1)
      : new Date(run.completed_at).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return '—'
  const seconds = Math.round((end - start) / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

function triggeredBy(run: WorkflowRunRow): string {
  return run.conversation_id.startsWith('cron:')
    ? 'cron'
    : run.conversation_id.startsWith('hermes')
      ? 'hermes-agent'
      : 'user'
}

function parseTags(raw: string | null): Array<string> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function duplicateWorkflowId(id: string): string {
  return `${id}-copy-${Date.now().toString(36)}`
}

function mockSha256(id: string): string {
  let h = 5381
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  }
  const base = h.toString(16).padStart(8, '0')
  return (base + base + base + base + base + base + base + base).slice(0, 64)
}

function mockVersion(id: string): string {
  const n = id.charCodeAt(id.length - 1) % 10
  return `1.${n}.0`
}

function filePathFor(def: WorkflowDefinitionRow): string {
  if (def.source === 'bundled') {
    return `~/.archon/workflows/defaults/${def.id}.yaml`
  }
  if (def.source === 'project') {
    return `${def.scope_path ?? '.'}/.archon/workflows/${def.id}.yaml`
  }
  return `~/.archon/workflows/user/${def.id}.yaml`
}

// ── Topological layout ────────────────────────────────────────────────────────

/** Kahn's algorithm: returns map of nodeId -> {cx, cy} using horizontal depth layout */
function computeLayout(
  nodes: Array<WorkflowDagNode>,
  edges: Array<[string, string]>,
): Record<string, { cx: number; cy: number }> {
  const NODE_W = 190
  const NODE_H = 78
  const GAP_X = 72
  const GAP_Y = 30
  const PAD = 40

  // Build adjacency + in-degree
  const inDeg: Record<string, number> = {}
  const adj: Record<string, Array<string>> = {}
  for (const n of nodes) {
    inDeg[n.id] = 0
    adj[n.id] = []
  }
  for (const [a, b] of edges) {
    adj[a] = adj[a] ?? []
    adj[a].push(b)
    inDeg[b] = (inDeg[b] ?? 0) + 1
  }

  // Kahn BFS — assign depth
  const depth: Record<string, number> = {}
  const queue: Array<string> = []
  for (const n of nodes) {
    if ((inDeg[n.id] ?? 0) === 0) queue.push(n.id)
  }
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const nb of adj[id] ?? []) {
      depth[nb] = Math.max(depth[nb] ?? 0, (depth[id] ?? 0) + 1)
      inDeg[nb]--
      if (inDeg[nb] === 0) queue.push(nb)
    }
  }

  // Group by depth
  const byDepth: Record<number, Array<string>> = {}
  for (const n of nodes) {
    const d = depth[n.id] ?? 0
    byDepth[d] = byDepth[d] ?? []
    byDepth[d].push(n.id)
  }

  const pos: Record<string, { cx: number; cy: number }> = {}
  for (const [d, ids] of Object.entries(byDepth)) {
    const depthNum = Number(d)
    const cx = PAD + depthNum * (NODE_W + GAP_X) + NODE_W / 2
    ids.forEach((id, rank) => {
      const cy = PAD + rank * (NODE_H + GAP_Y) + NODE_H / 2
      pos[id] = { cx, cy }
    })
  }
  return pos
}

function shortenNodeLabel(label: string): string {
  return label.length > 22 ? `${label.slice(0, 19)}…` : label
}

function shortenPhaseLabel(phase: string): string {
  return phase.length > 24 ? `${phase.slice(0, 21)}…` : phase
}

// ── YAML syntax highlighter ───────────────────────────────────────────────────

function yamlLine(line: string, idx: number): React.ReactElement {
  if (/^\s*#/.test(line)) {
    return (
      <span key={idx} className="yl-line">
        <span className="yt-comment">{line}</span>
        {'\n'}
      </span>
    )
  }
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
        {indent}
        <span className="yt-key">{key}</span>
        <span className="yt-punct">{colon}</span>
        {valueEl}
        {'\n'}
      </span>
    )
  }
  if (/^\s*-\s/.test(line)) {
    const m = line.match(/^(\s*-\s)(.*)$/)
    if (m) {
      return (
        <span key={idx} className="yl-line">
          <span className="yt-punct">{m[1]}</span>
          <span className="yt-string">{m[2]}</span>
          {'\n'}
        </span>
      )
    }
  }
  return (
    <span key={idx} className="yl-line">
      {line}
      {'\n'}
    </span>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  return <span className={`wfl-src-badge wfl-src-${source}`}>{source}</span>
}

function WorkflowHeaderActions({
  def,
  onOpenLaunchWizard,
  onDeselect,
  onSelectWorkflow,
}: {
  def: WorkflowDefinitionRow
  onOpenLaunchWizard?: (workflowId: string) => void
  onDeselect?: () => void
  onSelectWorkflow?: (workflowId: string) => void
}) {
  const duplicateMutation = useUpsertWorkflowDefinition()
  const deleteMutation = useDeleteWorkflowDefinition()
  const isBundled = def.source === 'bundled'

  function handleExportYaml() {
    const blob = new Blob([def.yaml], { type: 'text/yaml;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `${def.id}.yaml`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
  }

  function handleDuplicate() {
    const nextId = duplicateWorkflowId(def.id)
    duplicateMutation.mutate(
      {
        id: nextId,
        name: `${def.name} Copy`,
        description: def.description ?? undefined,
        source: 'user',
        yaml: def.yaml,
        version: def.version ?? undefined,
        tags: parseTags(def.tags),
      },
      {
        onSuccess: () => {
          onSelectWorkflow?.(nextId)
        },
      },
    )
  }

  function handleDelete() {
    if (
      !window.confirm(`Delete workflow "${def.name}"? This cannot be undone.`)
    ) {
      return
    }
    deleteMutation.mutate(def.id, {
      onSuccess: () => {
        onDeselect?.()
      },
    })
  }

  return (
    <div className="ed-actions">
      <button
        className="ed-action-btn ed-action-btn--launch"
        onClick={() => onOpenLaunchWizard?.(def.id)}
      >
        Launch
      </button>
      <button
        className="ed-action-btn"
        disabled={duplicateMutation.isPending}
        onClick={handleDuplicate}
      >
        {duplicateMutation.isPending ? 'Duplicating…' : 'Duplicate'}
      </button>
      <button className="ed-action-btn" onClick={handleExportYaml}>
        Export YAML
      </button>
      <button
        className="ed-action-btn ed-action-btn--danger"
        disabled={isBundled || deleteMutation.isPending}
        onClick={handleDelete}
        title={isBundled ? 'Bundled workflows cannot be deleted' : undefined}
      >
        {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
      </button>
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'success'
      ? 'run-ok'
      : status === 'failed'
        ? 'run-fail'
        : 'run-cancel'
  return <span className={`run-status ${cls}`}>{status}</span>
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  def,
  parsed,
}: {
  def: WorkflowDefinitionRow
  parsed: ParsedWorkflow
}) {
  const nodeBreakdown: Record<string, number> = {}
  for (const n of parsed.nodes) {
    const t = n.type ?? 'prompt'
    nodeBreakdown[t] = (nodeBreakdown[t] ?? 0) + 1
  }
  if (parsed.nodes.length === 0) {
    nodeBreakdown['prompt'] = parsed.node_count
  }

  const initials = parsed.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const checksum = def.checksum || mockSha256(def.id)
  const version = def.version || mockVersion(def.id)
  const filePath = filePathFor(def)

  return (
    <div className="overview-tab">
      <div className="ov-hero">
        <div className="ov-icon">{initials}</div>
        <div className="ov-title-block">
          <h2 className="ov-name">{parsed.name}</h2>
          <div className="ov-meta">
            <SourceBadge source={def.source} />
            <span className="ov-sep">·</span>
            <span className="ov-tier">{def.version ?? 'v1'}</span>
          </div>
        </div>
      </div>

      <p className="ov-desc">{parsed.description}</p>

      <div className="ov-stat-row">
        {(
          [
            ['Nodes', parsed.node_count],
            ['Inputs', parsed.required_inputs.length],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="ov-stat">
            <span className="ov-sv">{value}</span>
            <span className="ov-sl">{label}</span>
          </div>
        ))}
        <div className="ov-stat">
          <span className="ov-sv">{relativeTime(def.updated_at)}</span>
          <span className="ov-sl">Last updated</span>
        </div>
      </div>

      <div className="panel-card">
        <div className="pc-head">Inputs</div>
        <div className="pc-body">
          {parsed.required_inputs.map((r) => (
            <div key={r} className="input-row req">
              <span className="ir-name">{r}</span>
              <span className="ir-badge req">required</span>
            </div>
          ))}
          {parsed.optional_inputs.map((o) => (
            <div key={o} className="input-row">
              <span className="ir-name">{o}</span>
              <span className="ir-badge">optional</span>
            </div>
          ))}
          {parsed.required_inputs.length === 0 &&
            parsed.optional_inputs.length === 0 && (
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
                    background: NODE_COLOR[type as NodeType],
                    boxShadow: `0 0 5px ${NODE_COLOR[type as NodeType]}`,
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
            {parsed.has_loop && (
              <span className="tag-chip tag-loop">has-loop</span>
            )}
            {parsed.has_approval && (
              <span className="tag-chip tag-approval">has-approval</span>
            )}
            {!parsed.has_loop && !parsed.has_approval && (
              <span className="pc-empty">No flags</span>
            )}
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="pc-head">Metadata</div>
        <div className="pc-body ov-meta-grid">
          <div className="ov-meta-row">
            <span className="ov-meta-key">Checksum</span>
            <span className="ov-meta-value ov-meta-mono" title={checksum}>
              {checksum.slice(0, 12)}…
            </span>
          </div>
          <div className="ov-meta-row">
            <span className="ov-meta-key">Version</span>
            <span className="ov-meta-value">{version}</span>
          </div>
          <div className="ov-meta-row">
            <span className="ov-meta-key">Source</span>
            <span className="ov-meta-value">
              <SourceBadge source={def.source} />
            </span>
          </div>
          <div className="ov-meta-row">
            <span className="ov-meta-key">Path</span>
            <span className="ov-meta-value ov-meta-mono" title={filePath}>
              {filePath}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Visual DAG Tab ────────────────────────────────────────────────────────────

function DagSvgTab({ parsed }: { parsed: ParsedWorkflow }) {
  const [tooltip, setTooltip] = useState<{
    id: string
    cx: number
    cy: number
  } | null>(null)

  // Map backend nodes to WorkflowDagNode
  const dagNodes: Array<WorkflowDagNode> = parsed.nodes.map((n) => ({
    id: n.id,
    label: n.label ?? n.id,
    type: (n.type ?? 'prompt') as NodeType,
    phase: n.phase,
    hermes_task: n.hermes_task,
    config: n.config ?? n.config_preview,
    subgraph: n.subgraph,
  }))

  // Track expand state for subgraph nodes
  const [expandedSubgraphs, setExpandedSubgraphs] = useState<Set<string>>(
    new Set(),
  )
  function toggleSubgraph(id: string) {
    setExpandedSubgraphs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (dagNodes.length === 0) {
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
        <div className="dag-ph-sub">No nodes defined for this workflow</div>
      </div>
    )
  }

  const W = 190
  const H = 78
  const R = 12
  const PAD = 56

  const posMap = computeLayout(dagNodes, parsed.edges)

  const allCx = Object.values(posMap).map((p) => p.cx)
  const allCy = Object.values(posMap).map((p) => p.cy)
  const svgW = Math.max(...allCx) + W / 2 + PAD
  const svgH = Math.max(...allCy) + H / 2 + PAD

  const tooltipNode = tooltip ? dagNodes.find((n) => n.id === tooltip.id) : null
  const hermesTaskCount = dagNodes.filter((n) => n.hermes_task).length

  return (
    <div className="dag-canvas">
      <div className="dag-canvas-head">
        <div>
          <div className="dag-canvas-kicker">Visual DAG</div>
          <div className="dag-canvas-title">Read-only node canvas</div>
        </div>
        <div className="dag-canvas-stats">
          <span>{dagNodes.length} nodes</span>
          <span>{parsed.edges.length} edges</span>
          <span>{hermesTaskCount} Hermes tasks</span>
          <span>edit mode later</span>
        </div>
      </div>

      <div className="dag-stage" style={{ position: 'relative' }}>
        <svg
          className="dag-svg"
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ width: '100%', minWidth: `${svgW}px` }}
        >
          <defs>
            <pattern
              id="dag-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 24 0 L 0 0 0 24"
                fill="none"
                stroke="rgba(0,255,65,.06)"
                strokeWidth="1"
              />
            </pattern>
            {Object.entries(NODE_COLOR).map(([t]) => (
              <filter
                key={t}
                id={`glow-${t}`}
                x="-20%"
                y="-60%"
                width="140%"
                height="220%"
              >
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ))}
            <linearGradient
              id="dag-node-fill"
              x1="0%"
              x2="100%"
              y1="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor="rgba(4,24,10,.98)" />
              <stop offset="100%" stopColor="rgba(1,10,6,.96)" />
            </linearGradient>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 2 L 8 5 L 0 8 z" fill="rgba(0,255,65,.55)" />
            </marker>
          </defs>

          <rect width={svgW} height={svgH} fill="url(#dag-grid)" />

          {/* edges */}
          {parsed.edges.map(([a, b], i) => {
            const s = posMap[a]
            const t = posMap[b]
            const sx = s.cx + W / 2
            const sy = s.cy
            const tx = t.cx - W / 2
            const ty = t.cy
            const mx = (sx + tx) / 2
            return (
              <path
                key={i}
                d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
                fill="none"
                stroke="rgba(0,255,65,.34)"
                strokeWidth="2"
                markerEnd="url(#arrow)"
              />
            )
          })}

          {/* nodes */}
          {dagNodes.map((n) => {
            const pos = posMap[n.id]
            const c = NODE_COLOR[n.type]
            const isSubgraph = !!n.subgraph
            const isExpanded = expandedSubgraphs.has(n.id)
            // Count how many child nodes list this node as a dependency proxy
            const childCount = isSubgraph
              ? parsed.edges.filter(([a]) => a === n.id).length
              : 0

            if (isSubgraph) {
              // ── Subgraph node: dashed outline, chevron, ref badge ──
              const SG_COLOR = '#bf97ff'
              return (
                <g
                  key={n.id}
                  className="dag-node dag-node--subgraph"
                  onClick={() => toggleSubgraph(n.id)}
                  onMouseEnter={() =>
                    setTooltip({ id: n.id, cx: pos.cx, cy: pos.cy })
                  }
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    className="dag-node-shadow"
                    x={pos.cx - W / 2 + 5}
                    y={pos.cy - H / 2 + 7}
                    width={W}
                    height={H}
                    rx={R}
                  />
                  {/* dashed outline indicates subgraph */}
                  <rect
                    x={pos.cx - W / 2}
                    y={pos.cy - H / 2}
                    width={W}
                    height={H}
                    rx={R}
                    fill="url(#dag-node-fill)"
                    stroke={SG_COLOR}
                    strokeWidth="1.6"
                    strokeDasharray="5 3"
                    filter="url(#glow-command)"
                  />
                  <circle
                    className="dag-port dag-port-in"
                    cx={pos.cx - W / 2}
                    cy={pos.cy}
                    r="4"
                  />
                  <circle
                    className="dag-port dag-port-out"
                    cx={pos.cx + W / 2}
                    cy={pos.cy}
                    r="4"
                  />
                  {/* chevron expand/collapse */}
                  <text
                    x={pos.cx - W / 2 + 10}
                    y={pos.cy - 14}
                    style={{
                      font: '700 10px var(--m-font-mono, ui-monospace, monospace)',
                      fill: SG_COLOR,
                    }}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </text>
                  <text
                    x={pos.cx - W / 2 + 24}
                    y={pos.cy - 14}
                    style={{
                      font: '700 12px var(--m-font-mono, ui-monospace, monospace)',
                      fill: '#e8ffe8',
                      letterSpacing: '.02em',
                    }}
                  >
                    {shortenNodeLabel(n.label)}
                  </text>
                  {/* subgraph ref id */}
                  <text
                    x={pos.cx - W / 2 + 24}
                    y={pos.cy + 4}
                    style={{
                      font: '700 9px var(--m-font-mono, ui-monospace, monospace)',
                      fill: SG_COLOR,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    subgraph
                  </text>
                  <text
                    x={pos.cx - W / 2 + 24}
                    y={pos.cy + 18}
                    style={{
                      font: '500 8px var(--m-font-mono, ui-monospace, monospace)',
                      fill: 'rgba(191,151,255,.7)',
                      letterSpacing: '.04em',
                    }}
                  >
                    {n.subgraph!.ref.length > 20
                      ? `${n.subgraph!.ref.slice(0, 17)}…`
                      : n.subgraph!.ref}
                  </text>
                  {/* child-count badge */}
                  {childCount > 0 && (
                    <>
                      <rect
                        x={pos.cx + W / 2 - 30}
                        y={pos.cy - H / 2 + 6}
                        width={24}
                        height={14}
                        rx={4}
                        fill={SG_COLOR}
                        opacity={0.22}
                      />
                      <text
                        x={pos.cx + W / 2 - 18}
                        y={pos.cy - H / 2 + 16}
                        textAnchor="middle"
                        style={{
                          font: '700 9px var(--m-font-mono, ui-monospace, monospace)',
                          fill: SG_COLOR,
                          letterSpacing: '.04em',
                        }}
                      >
                        {childCount}
                      </text>
                    </>
                  )}
                </g>
              )
            }

            return (
              <g
                key={n.id}
                className="dag-node"
                onMouseEnter={() =>
                  setTooltip({ id: n.id, cx: pos.cx, cy: pos.cy })
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <rect
                  className="dag-node-shadow"
                  x={pos.cx - W / 2 + 5}
                  y={pos.cy - H / 2 + 7}
                  width={W}
                  height={H}
                  rx={R}
                />
                <rect
                  x={pos.cx - W / 2}
                  y={pos.cy - H / 2}
                  width={W}
                  height={H}
                  rx={R}
                  fill="url(#dag-node-fill)"
                  stroke={c}
                  strokeWidth="1.4"
                  filter={`url(#glow-${n.type})`}
                />
                <circle
                  className="dag-port dag-port-in"
                  cx={pos.cx - W / 2}
                  cy={pos.cy}
                  r="4"
                />
                <circle
                  className="dag-port dag-port-out"
                  cx={pos.cx + W / 2}
                  cy={pos.cy}
                  r="4"
                />
                <text
                  x={pos.cx - W / 2 + 18}
                  y={pos.cy - 18}
                  style={{
                    font: '700 12px var(--m-font-mono, ui-monospace, monospace)',
                    fill: '#e8ffe8',
                    letterSpacing: '.02em',
                  }}
                >
                  {shortenNodeLabel(n.label)}
                </text>
                <text
                  x={pos.cx - W / 2 + 18}
                  y={pos.cy + 4}
                  style={{
                    font: '700 9px var(--m-font-mono, ui-monospace, monospace)',
                    fill: c,
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                  }}
                >
                  {n.type}
                </text>
                {n.phase && (
                  <text
                    x={pos.cx - W / 2 + 18}
                    y={pos.cy + 22}
                    style={{
                      font: '600 8px var(--m-font-mono, ui-monospace, monospace)',
                      fill: 'rgba(210,255,220,.62)',
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {shortenPhaseLabel(n.phase)}
                  </text>
                )}
                <text
                  x={pos.cx + W / 2 - 16}
                  y={pos.cy + 24}
                  textAnchor="end"
                  style={{
                    font: '500 8px var(--m-font-mono, ui-monospace, monospace)',
                    fill: 'rgba(210,255,220,.42)',
                    letterSpacing: '.08em',
                  }}
                >
                  {n.hermes_task ? 'KANBAN TASK' : 'LOCAL NODE'}
                </text>
              </g>
            )
          })}
        </svg>

        {/* tooltip */}
        {tooltipNode && tooltip && (
          <div
            className="dag-tooltip"
            style={{
              position: 'absolute',
              top: `${tooltip.cy + H / 2 + 6}px`,
              left: `${tooltip.cx}px`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="dag-tt-id">{tooltipNode.id}</div>
            {tooltipNode.phase && (
              <div className="dag-tt-phase">{tooltipNode.phase}</div>
            )}
            {tooltipNode.subgraph && (
              <div className="dag-tt-task">
                <div>Subgraph ref: {tooltipNode.subgraph.ref}</div>
                <div style={{ opacity: 0.7, fontSize: 10 }}>
                  Click node to {expandedSubgraphs.has(tooltipNode.id) ? 'collapse' : 'expand'} children
                </div>
              </div>
            )}
            {tooltipNode.hermes_task && (
              <div className="dag-tt-task">
                <div>Hermes Kanban task-backed node</div>
                {tooltipNode.hermes_task.agent_hint && (
                  <div>agent: {tooltipNode.hermes_task.agent_hint}</div>
                )}
                {tooltipNode.hermes_task.model_hint && (
                  <div>model: {tooltipNode.hermes_task.model_hint}</div>
                )}
                {tooltipNode.hermes_task.skills &&
                  tooltipNode.hermes_task.skills.length > 0 && (
                    <div>
                      skills: {tooltipNode.hermes_task.skills.join(', ')}
                    </div>
                  )}
              </div>
            )}
            <div
              className="dag-tt-type"
              style={{ color: tooltipNode.subgraph ? '#bf97ff' : NODE_COLOR[tooltipNode.type] }}
            >
              {tooltipNode.subgraph ? 'subgraph' : tooltipNode.type}
            </div>
            {tooltipNode.config && !tooltipNode.subgraph && (
              <div className="dag-tt-cfg">{tooltipNode.config}</div>
            )}
          </div>
        )}

        {/* expanded subgraph children list */}
        {dagNodes
          .filter((n) => n.subgraph && expandedSubgraphs.has(n.id))
          .map((n) => {
            const pos = posMap[n.id]
            // Children: nodes that have an edge FROM this subgraph node
            const childIds = parsed.edges
              .filter(([a]) => a === n.id)
              .map(([, b]) => b)
            const childNodes = dagNodes.filter((c) => childIds.includes(c.id))
            return (
              <div
                key={`sg-expand-${n.id}`}
                className="dag-sg-expand"
                style={{
                  position: 'absolute',
                  top: `${pos.cy + H / 2 + 10}px`,
                  left: `${pos.cx - W / 2}px`,
                  width: W,
                }}
              >
                <div className="dag-sg-expand-title">
                  {n.subgraph!.ref} children
                </div>
                {childNodes.length === 0 ? (
                  <div className="dag-sg-expand-empty">no direct children</div>
                ) : (
                  childNodes.map((c) => (
                    <div key={c.id} className="dag-sg-expand-row">
                      <span
                        className="dag-sg-expand-dot"
                        style={{ background: NODE_COLOR[c.type] }}
                      />
                      <span className="dag-sg-expand-id">{c.id}</span>
                      <span className="dag-sg-expand-type">{c.type}</span>
                    </div>
                  ))
                )}
              </div>
            )
          })}
      </div>

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

function YamlTab({
  def,
  parsed,
}: {
  def: WorkflowDefinitionRow
  parsed: ParsedWorkflow
}) {
  const lines = def.yaml.split('\n')
  const isEditable = def.source !== 'bundled'
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
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('wf-toast', {
                      detail: { msg: 'Duplicate as user workflow coming v1.1' },
                    }),
                  )
                }
              >
                Duplicate as user workflow
              </button>
            </>
          )}
          {isEditable && <span className="editable-indicator">● Editable</span>}
          <span className="yaml-valid-badge">
            ✓ Parsed by workflow engine · {parsed.node_count} nodes
          </span>
        </div>
        <div className="yt-right">
          <button className="btn-mini" disabled>
            Validate
          </button>
          <button className="btn-mini" disabled>
            Format
          </button>
          {isEditable && (
            <>
              <button className="btn-mini" disabled>
                Revert
              </button>
              <button className="btn-mini prim" disabled>
                Save
              </button>
            </>
          )}
        </div>
      </div>
      <div className="yaml-body">
        <div className="yn-gutter">
          {lines.map((_, i) => (
            <div key={i} className="yn">
              {i + 1}
            </div>
          ))}
        </div>
        <pre className="wfe-yaml-code yaml-code">
          {lines.map((l, i) => yamlLine(l, i))}
        </pre>
      </div>
    </div>
  )
}

// ── When-to-Use Tab ───────────────────────────────────────────────────────────

function WhenToUseTab({
  def,
  parsed,
}: {
  def: WorkflowDefinitionRow
  parsed: ParsedWorkflow
}) {
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
          The <code>when_to_use</code> field powers Hermes' plan-phase
          suggestions — agents read it to decide which workflow to recommend to
          users during chat.
        </span>
      </div>
      <div className="panel-card">
        <div className="pc-head">Required Inputs Preview</div>
        <div className="pc-body">
          <div className="wtu-hint">
            These are surfaced to the user during the plan phase when this
            workflow is proposed.
          </div>
          {parsed.required_inputs.map((r) => (
            <div key={r} className="input-row req">
              <span className="ir-name">{r}</span>
              <span className="ir-badge req">required</span>
            </div>
          ))}
          {parsed.required_inputs.length === 0 && (
            <span className="pc-empty">No required inputs</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Live Events Panel (A.1.2 smoke harness) ───────────────────────────────────

function LiveEventsPanel({ conversationId }: { conversationId: string }) {
  const { events, status } = useWorkflowEvents(conversationId)
  const last10 = events.slice(-10)
  return (
    <div className="panel-card" style={{ marginTop: 16 }}>
      <div
        className="pc-head"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        Live SSE events
        <span
          style={{
            fontSize: 9,
            letterSpacing: '.1em',
            color:
              status === 'open'
                ? '#00ff41'
                : status === 'error'
                  ? '#ff6b6b'
                  : '#888',
          }}
        >
          [{status.toUpperCase()}]
        </span>
      </div>
      <div
        className="pc-body"
        style={{
          fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
          fontSize: 10,
          lineHeight: 1.6,
        }}
      >
        {last10.length === 0 && (
          <span className="pc-empty">
            No events yet — launch a workflow to see real-time updates.
          </span>
        )}
        {last10.map((evt, i) => (
          <div
            key={i}
            style={{
              borderBottom: '1px solid rgba(0,255,65,.07)',
              paddingBottom: 2,
              marginBottom: 2,
            }}
          >
            <span style={{ color: '#00ff41' }}>{evt.type}</span>
            <span style={{ color: '#555', marginLeft: 8 }}>
              {new Date(evt.receivedAt).toISOString().slice(11, 23)}
            </span>
            <span style={{ color: '#888', marginLeft: 8 }}>
              {JSON.stringify(evt.data).slice(0, 80)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────────

function HistoryTab({
  name,
  workflowId,
  onOpenRun,
}: {
  name: string
  workflowId: string
  onOpenRun?: (runId: string) => void
}) {
  const { data: runs = [], isLoading, isError } = useWorkflowRuns(workflowId)
  return (
    <div className="history-tab">
      <div className="history-header">
        <span className="hist-subtitle">
          {isLoading
            ? 'Loading runs for '
            : `Showing last ${runs.length} runs of `}
          <strong style={{ color: 'var(--m-text, var(--theme-fg))' }}>
            {name}
          </strong>
        </span>
        <a href="/conductor" className="link-out">
          View all in Conductor →
        </a>
      </div>
      {isError ? (
        <div className="hist-empty">Run history failed to load.</div>
      ) : runs.length === 0 && !isLoading ? (
        <div className="hist-empty">
          No runs yet. Launch this workflow to populate history.
        </div>
      ) : (
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
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="run-id">{r.id.slice(0, 8)}</td>
                <td>{formatRunStartedAt(r.started_at)}</td>
                <td>
                  <RunStatusBadge status={r.status} />
                </td>
                <td className="run-dur">{formatRunDuration(r)}</td>
                <td>
                  <span className="run-who">{triggeredBy(r)}</span>
                </td>
                <td className="run-phase">{r.current_phase}</td>
                <td>
                  <button
                    className="link-out hist-open-run"
                    style={{ fontSize: 10 }}
                    onClick={() => onOpenRun?.(r.id)}
                  >
                    Open run →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Loading / Error states ────────────────────────────────────────────────────

function EditorSkeleton() {
  return (
    <div className="wf-editor-empty">
      <div className="es-title" style={{ opacity: 0.5 }}>
        Loading workflow…
      </div>
    </div>
  )
}

function EditorError({ id, onRetry }: { id: string; onRetry: () => void }) {
  return (
    <div className="wf-editor-empty">
      <div className="es-title">Failed to load workflow</div>
      <div className="es-sub" style={{ marginBottom: 12 }}>
        Could not fetch parsed data for <code>{id}</code>
      </div>
      <button className="btn-mini prim" onClick={onRetry}>
        Retry
      </button>
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
      <div className="es-title">
        Select a workflow on the left or create a new one.
      </div>
      <div className="es-sub">The editor will appear here.</div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface WorkflowEditorProps {
  selectedId: string | null
  onOpenRun?: (runId: string) => void
  onOpenLaunchWizard?: (workflowId: string) => void
  onDeselect?: () => void
  onSelectWorkflow?: (workflowId: string) => void
}

export function WorkflowEditor({
  selectedId,
  onOpenRun,
  onOpenLaunchWizard,
  onDeselect,
  onSelectWorkflow,
}: WorkflowEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const { data, isLoading, isError, refetch } = useWorkflowParsed(selectedId)

  if (!selectedId) {
    return <EditorEmptyState />
  }

  if (isLoading) {
    return <EditorSkeleton />
  }

  if (isError || !data) {
    return <EditorError id={selectedId} onRetry={() => void refetch()} />
  }

  const { definition: def, parsed } = data

  return (
    <>
      {/* top bar inside editor */}
      <div className="ed-topbar">
        <div className="ed-header-row">
          <div className="ed-crumbs">
            <span>Workflows</span>
            <span className="ed-sep">/</span>
            <span className="ed-cur">{parsed.name}</span>
          </div>
          <WorkflowHeaderActions
            def={def}
            onOpenLaunchWizard={onOpenLaunchWizard}
            onDeselect={onDeselect}
            onSelectWorkflow={onSelectWorkflow}
          />
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
        {activeTab === 'Overview' && <OverviewTab def={def} parsed={parsed} />}
        {activeTab === 'Visual DAG' && <DagSvgTab parsed={parsed} />}
        {activeTab === 'YAML' && <YamlTab def={def} parsed={parsed} />}
        {activeTab === 'When-to-Use' && (
          <WhenToUseTab def={def} parsed={parsed} />
        )}
        {activeTab === 'History' && (
          <>
            <HistoryTab
              name={parsed.name}
              workflowId={selectedId}
              onOpenRun={onOpenRun}
            />
            <LiveEventsPanel conversationId={selectedId} />
          </>
        )}
      </div>
    </>
  )
}
