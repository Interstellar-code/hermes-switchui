import { useEffect, useState } from 'react'
import { useLaunchWorkflowRun, useWorkflowParsed } from './use-workflows'
import type { NodeType, WorkflowDagNode } from './types'

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENTS = ['Switch', 'Neo', 'Trinity', 'Morpheus'] as const
type Agent = (typeof AGENTS)[number]

const NODE_COLOR: Record<NodeType, string> = {
  prompt: '#00ff41',
  bash: '#5ad3ff',
  command: '#bf97ff',
  approval: '#ffb454',
  router: '#ff6b6b',
  loop: '#ffd700',
  script: '#5ad3ff',
  cancel: '#ff6b6b',
}

const STEP_TITLES = ['Plan', 'Route', 'Schedule', 'Confirm'] as const

function agentForNode(nodeId: string): Agent {
  let h = 0
  for (let i = 0; i < nodeId.length; i++) h = (h * 31 + nodeId.charCodeAt(i)) & 0xffff
  return AGENTS[h % 4]
}

/** Kahn topological layout for wizard DAG (horizontal) */
function computeWizardLayout(
  nodes: Array<WorkflowDagNode>,
  edges: Array<[string, string]>,
): Partial<Record<string, { x: number; y: number }>> {
  const NODE_W = 110
  const NODE_H = 44
  const GAP_X = 50
  const GAP_Y = 16
  const PAD = 24

  const inDeg: Record<string, number> = {}
  const adj: Record<string, Array<string>> = {}
  for (const n of nodes) { inDeg[n.id] = 0; adj[n.id] = [] }
  for (const [a, b] of edges) {
    adj[a] = adj[a] ?? []
    adj[a].push(b)
    inDeg[b] = (inDeg[b] ?? 0) + 1
  }

  const depth: Record<string, number> = {}
  const queue: Array<string> = []
  for (const n of nodes) if ((inDeg[n.id] ?? 0) === 0) queue.push(n.id)
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const nb of adj[id] ?? []) {
      depth[nb] = Math.max(depth[nb] ?? 0, (depth[id] ?? 0) + 1)
      inDeg[nb]--
      if (inDeg[nb] === 0) queue.push(nb)
    }
  }

  const byDepth: Record<number, Array<string>> = {}
  for (const n of nodes) {
    const d = depth[n.id] ?? 0
    byDepth[d] = byDepth[d] ?? []
    byDepth[d].push(n.id)
  }

  const pos: Partial<Record<string, { x: number; y: number }>> = {}
  for (const [d, ids] of Object.entries(byDepth)) {
    const depthNum = Number(d)
    const cx = PAD + depthNum * (NODE_W + GAP_X) + NODE_W / 2
    ids.forEach((id, rank) => {
      pos[id] = { x: cx - NODE_W / 2, y: PAD + rank * (NODE_H + GAP_Y) }
    })
  }
  return pos
}

// ── Step 1 — Plan ─────────────────────────────────────────────────────────────

interface WizardData {
  id: string
  name: string
  description: string
  required_inputs: Array<string>
  optional_inputs: Array<string>
  nodes: Array<WorkflowDagNode>
  edges: Array<[string, string]>
}

function Step1Plan({
  wf,
  userMessage,
  setUserMessage,
}: {
  wf: WizardData
  userMessage: string
  setUserMessage: (m: string) => void
}) {
  const phases = Array.from(
    new Set(wf.nodes.map((n) => n.phase).filter((p): p is string => Boolean(p))),
  )
  const agentHints = Array.from(
    new Set(
      wf.nodes
        .map((n) => n.hermes_task?.agent_hint)
        .filter((a): a is string => Boolean(a)),
    ),
  )
  const skillSet = Array.from(
    new Set(wf.nodes.flatMap((n) => n.hermes_task?.skills ?? [])),
  )

  return (
    <div className="wfw-step-1">
      <div className="wfw-s1-left">
        <div className="wfw-summary-card">
          <div className="wfw-summary-id">{wf.id}</div>
          <div className="wfw-summary-name">{wf.name}</div>
          <div className="wfw-summary-desc">{wf.description}</div>
        </div>
        {wf.required_inputs.length > 0 && (
          <div className="wfw-inputs-list">
            <div className="wfw-inputs-label">Inputs to provide</div>
            {wf.required_inputs.map((inp) => (
              <div key={inp} className="wfw-input-item">
                <span className="wfw-input-badge">required</span>
                <span className="wfw-input-name">{inp}</span>
              </div>
            ))}
            {wf.optional_inputs.map((inp) => (
              <div key={inp} className="wfw-input-item">
                <span className="wfw-input-badge wfw-input-badge--opt">optional</span>
                <span className="wfw-input-name">{inp}</span>
              </div>
            ))}
          </div>
        )}
        <div className="wfw-inputs-list">
          <div className="wfw-inputs-label">Run context (optional)</div>
          <textarea
            className="wfw-chat-input"
            style={{ minHeight: 80, padding: 8, resize: 'vertical', width: '100%' }}
            placeholder="Issue number, repo, or extra prompt context…"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
          />
        </div>
      </div>
      <div className="wfw-s1-right">
        <div className="wfw-chat-header">Workflow overview</div>
        <div className="wfw-chat-msgs">
          <div className="wfw-inputs-list" style={{ marginBottom: 12 }}>
            <div className="wfw-inputs-label">Stats</div>
            <div className="wfw-input-item">
              <span className="wfw-input-name">{wf.nodes.length} nodes</span>
            </div>
            <div className="wfw-input-item">
              <span className="wfw-input-name">{wf.edges.length} edges</span>
            </div>
            {phases.length > 0 && (
              <div className="wfw-input-item">
                <span className="wfw-input-name">Phases: {phases.join(' → ')}</span>
              </div>
            )}
            {agentHints.length > 0 && (
              <div className="wfw-input-item">
                <span className="wfw-input-name">Agents: {agentHints.join(', ')}</span>
              </div>
            )}
            {skillSet.length > 0 && (
              <div className="wfw-input-item">
                <span className="wfw-input-name">Skills: {skillSet.join(', ')}</span>
              </div>
            )}
          </div>
          <div className="wfw-inputs-label">Nodes</div>
          {wf.nodes.map((n) => {
            const agent = n.hermes_task?.agent_hint
            const color = NODE_COLOR[n.type]
            return (
              <div
                key={n.id}
                className="wfw-bubble wfw-bubble--switch"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <span className="wfw-bubble-sender">
                  {n.type}
                  {n.phase ? ` · ${n.phase}` : ''}
                  {agent ? ` · ${agent}` : ''}
                </span>
                <span>{n.label || n.id}</span>
              </div>
            )
          })}
          {wf.nodes.length === 0 && (
            <div className="wfw-bubble wfw-bubble--switch">
              <span>No nodes defined.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Step 2 — Route ────────────────────────────────────────────────────────────

function Step2Route({
  wf,
  agentMap,
  setAgentMap,
}: {
  wf: WizardData
  agentMap: Record<string, Agent>
  setAgentMap: React.Dispatch<React.SetStateAction<Record<string, Agent>>>
}) {
  const [popupNode, setPopupNode] = useState<string | null>(null)

  const W = 110
  const H = 44
  const R = 5
  const PAD = 24

  const hasDag = wf.nodes.length > 0
  const posMap = hasDag ? computeWizardLayout(wf.nodes, wf.edges) : {}

  const positions = Object.values(posMap).filter((p): p is { x: number; y: number } => Boolean(p))
  const allX = positions.map((p) => p.x)
  const allY = positions.map((p) => p.y)
  const svgW = hasDag ? Math.max(...allX) + W + PAD : 400
  const svgH = hasDag ? Math.max(...allY) + H + 20 + PAD : 120

  function handleNodeClick(nodeId: string) {
    setPopupNode(popupNode === nodeId ? null : nodeId)
  }

  return (
    <div className="wfw-step-2">
      <div className="wfw-dag-wrap">
        {!hasDag ? (
          <div className="wfw-dag-empty">No DAG defined — nodes will run sequentially.</div>
        ) : (
          <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', maxWidth: `${svgW}px` }}>
            <defs>
              <marker
                id="wfw-arrow"
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
            {wf.edges.map(([a, b], i) => {
              const s = posMap[a]
              const t = posMap[b]
              if (!s || !t) return null
              const sx = s.x + W
              const sy = s.y + H / 2
              const tx = t.x
              const ty = t.y + H / 2
              const mx = (sx + tx) / 2
              return (
                <path
                  key={i}
                  d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
                  fill="none"
                  stroke="rgba(0,255,65,.25)"
                  strokeWidth="1.5"
                  markerEnd="url(#wfw-arrow)"
                />
              )
            })}
            {wf.nodes.map((n) => {
              const pos = posMap[n.id]
              if (!pos) return null
              const c = NODE_COLOR[n.type]
              const agent = agentMap[n.id] ?? agentForNode(n.id)
              return (
                <g
                  key={n.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleNodeClick(n.id)}
                >
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={W}
                    height={H}
                    rx={R}
                    fill={popupNode === n.id ? 'rgba(0,255,65,.1)' : 'rgba(4,16,8,.9)'}
                    stroke={c}
                    strokeWidth="1"
                  />
                  <text
                    x={pos.x + W / 2}
                    y={pos.y + H / 2 - 8}
                    textAnchor="middle"
                    style={{ font: '600 10px var(--m-font-mono, ui-monospace, monospace)', fill: '#e8ffe8', letterSpacing: '.04em' }}
                  >
                    {n.label}
                  </text>
                  <text
                    x={pos.x + W / 2}
                    y={pos.y + H / 2 + 4}
                    textAnchor="middle"
                    style={{ font: '500 8px var(--m-font-mono, ui-monospace, monospace)', fill: c, letterSpacing: '.1em', textTransform: 'uppercase' }}
                  >
                    {n.type}
                  </text>
                  <text
                    x={pos.x + W / 2}
                    y={pos.y + H / 2 + 16}
                    textAnchor="middle"
                    style={{ font: '500 8px var(--m-font-mono, ui-monospace, monospace)', fill: '#00c832', letterSpacing: '.04em' }}
                  >
                    {agent}
                  </text>
                </g>
              )
            })}
          </svg>
        )}

        {/* Override popup */}
        {popupNode && (
          <div className="wfw-override-popup">
            <div className="wfw-override-label">Override agent for <strong>{popupNode}</strong></div>
            <select
              className="wfw-override-select"
              value={agentMap[popupNode] ?? agentForNode(popupNode)}
              onChange={(e) => {
                setAgentMap((prev) => ({ ...prev, [popupNode]: e.target.value as Agent }))
              }}
            >
              {AGENTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button className="wfw-override-close" onClick={() => setPopupNode(null)}>Done</button>
          </div>
        )}
      </div>

      <div className="wfw-resolved-vars">
        <div className="wfw-rv-label">Resolved variables</div>
        {wf.required_inputs.length === 0 && wf.optional_inputs.length === 0 ? (
          <div className="wfw-rv-empty">No variables required.</div>
        ) : (
          <table className="wfw-rv-table">
            <tbody>
              {wf.required_inputs.map((inp) => (
                <tr key={inp}>
                  <td className="wfw-rv-key">{inp}</td>
                  <td className="wfw-rv-val">&lt;USER_PROVIDED&gt;</td>
                </tr>
              ))}
              {wf.optional_inputs.map((inp) => (
                <tr key={inp}>
                  <td className="wfw-rv-key">{inp}</td>
                  <td className="wfw-rv-val wfw-rv-val--opt">&lt;optional&gt;</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Step 3 — Schedule ─────────────────────────────────────────────────────────

type ScheduleMode = 'now' | 'at' | 'cron'
type Priority = 'low' | 'normal' | 'high' | 'urgent'

interface ScheduleState {
  mode: ScheduleMode
  datetime: string
  cron: string
  priority: Priority
  maxRuntime: number
}

function Step3Schedule({
  schedule,
  setSchedule,
}: {
  schedule: ScheduleState
  setSchedule: React.Dispatch<React.SetStateAction<ScheduleState>>
}) {
  function update<TKey extends keyof ScheduleState>(k: TKey, v: ScheduleState[TKey]) {
    setSchedule((prev) => ({ ...prev, [k]: v }))
  }

  return (
    <div className="wfw-step-3">
      <div className="wfw-field-group">
        <div className="wfw-field-label">When to run</div>
        <label className="wfw-radio">
          <input type="radio" name="sched" value="now" checked={schedule.mode === 'now'} onChange={() => update('mode', 'now')} />
          <span>Run now</span>
        </label>
        <label className="wfw-radio">
          <input type="radio" name="sched" value="at" checked={schedule.mode === 'at'} onChange={() => update('mode', 'at')} />
          <span>Run at</span>
          {schedule.mode === 'at' && (
            <input
              type="datetime-local"
              className="wfw-datetime"
              value={schedule.datetime}
              onChange={(e) => update('datetime', e.target.value)}
            />
          )}
        </label>
        <label className="wfw-radio">
          <input type="radio" name="sched" value="cron" checked={schedule.mode === 'cron'} onChange={() => update('mode', 'cron')} />
          <span>Run on schedule</span>
          {schedule.mode === 'cron' && (
            <div className="wfw-cron-wrap">
              <input
                type="text"
                className="wfw-cron-input"
                placeholder="0 9 * * 1-5"
                value={schedule.cron}
                onChange={(e) => update('cron', e.target.value)}
              />
              <div className="wfw-cron-preview">Daily at 9:00 AM</div>
            </div>
          )}
        </label>
      </div>

      <div className="wfw-field-group">
        <label className="wfw-field-label" htmlFor="wfw-priority">Priority</label>
        <select
          id="wfw-priority"
          className="wfw-select"
          value={schedule.priority}
          onChange={(e) => update('priority', e.target.value as Priority)}
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      <div className="wfw-field-group">
        <label className="wfw-field-label" htmlFor="wfw-maxruntime">Max runtime (seconds)</label>
        <input
          id="wfw-maxruntime"
          type="number"
          className="wfw-number-input"
          value={schedule.maxRuntime}
          min={60}
          max={86400}
          onChange={(e) => update('maxRuntime', Number(e.target.value))}
        />
      </div>
    </div>
  )
}

// ── Step 4 — Confirm ──────────────────────────────────────────────────────────

function Step4Confirm({
  wf,
  agentMap,
  schedule,
  onSubmit,
  isSubmitting,
}: {
  wf: WizardData
  agentMap: Record<string, Agent>
  schedule: ScheduleState
  onSubmit: () => void
  isSubmitting: boolean
}) {
  const scheduleLabel =
    schedule.mode === 'now'
      ? 'Run immediately'
      : schedule.mode === 'at'
        ? `Run at ${schedule.datetime || '(not set)'}`
        : `Cron: ${schedule.cron || '(not set)'} — Daily at 9:00 AM`

  return (
    <div className="wfw-step-4">
      <div className="wfw-confirm-grid">
        <div className="wfw-confirm-card">
          <div className="wfw-cc-title">Workflow</div>
          <div className="wfw-cc-row"><span>ID</span><span>{wf.id}</span></div>
          <div className="wfw-cc-row"><span>Name</span><span>{wf.name}</span></div>
        </div>
        <div className="wfw-confirm-card">
          <div className="wfw-cc-title">Execution</div>
          <div className="wfw-cc-row"><span>Schedule</span><span>{scheduleLabel}</span></div>
          <div className="wfw-cc-row"><span>Priority</span><span>{schedule.priority}</span></div>
          <div className="wfw-cc-row"><span>Max runtime</span><span>{schedule.maxRuntime}s</span></div>
        </div>
        {wf.nodes.length > 0 && (
          <div className="wfw-confirm-card">
            <div className="wfw-cc-title">Agent Assignments</div>
            {wf.nodes.map((n) => (
              <div key={n.id} className="wfw-cc-row">
                <span>{n.label}</span>
                <span className="wfw-agent-tag">{agentMap[n.id] ?? agentForNode(n.id)}</span>
              </div>
            ))}
          </div>
        )}
        {(wf.required_inputs.length > 0 || wf.optional_inputs.length > 0) && (
          <div className="wfw-confirm-card">
            <div className="wfw-cc-title">Resolved Variables</div>
            {wf.required_inputs.map((inp) => (
              <div key={inp} className="wfw-cc-row">
                <span>{inp}</span><span className="wfw-rv-val">&lt;USER_PROVIDED&gt;</span>
              </div>
            ))}
            {wf.optional_inputs.map((inp) => (
              <div key={inp} className="wfw-cc-row">
                <span>{inp}</span><span className="wfw-rv-val wfw-rv-val--opt">&lt;optional&gt;</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="wfw-submit-btn" onClick={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? 'Launching…' : 'Submit as Workflow Run'}
      </button>
    </div>
  )
}

// ── Main LaunchWizard ─────────────────────────────────────────────────────────

interface LaunchWizardProps {
  workflowId: string | null
  onClose: () => void
  onRunLaunched?: (runId: string) => void
}

export function LaunchWizard({ workflowId, onClose, onRunLaunched }: LaunchWizardProps) {
  const [step, setStep] = useState(1)
  const [canAdvance, setCanAdvance] = useState(true)
  const [agentMap, setAgentMap] = useState<Record<string, Agent>>({})
  const [userMessage, setUserMessage] = useState('')
  const [schedule, setSchedule] = useState<ScheduleState>({
    mode: 'now',
    datetime: '',
    cron: '',
    priority: 'normal',
    maxRuntime: 3600,
  })

  const { data, isLoading } = useWorkflowParsed(workflowId)
  const launchMutation = useLaunchWorkflowRun()

  // Reset state when workflow changes
  useEffect(() => {
    setStep(1)
    setCanAdvance(true)
    setAgentMap({})
    setUserMessage('')
    setSchedule({ mode: 'now', datetime: '', cron: '', priority: 'normal', maxRuntime: 3600 })
  }, [workflowId])

  // Keyboard dismiss
  useEffect(() => {
    if (!workflowId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workflowId, onClose])

  if (!workflowId) return null

  // Build wizard data from parsed response
  let wf: WizardData | null = null
  if (data) {
    const { definition: def, parsed } = data
    wf = {
      id: def.id,
      name: parsed.name,
      description: parsed.description,
      required_inputs: parsed.required_inputs,
      optional_inputs: parsed.optional_inputs,
      nodes: parsed.nodes.map((n) => ({
        id: n.id,
        label: n.label ?? n.id,
        type: (n.type ?? 'prompt') as NodeType,
        config: n.config,
      })),
      edges: parsed.edges,
    }
  }

  if (isLoading) {
    return (
      <div className="wfw-backdrop" onClick={onClose}>
        <div className="wfw-modal" onClick={(e) => e.stopPropagation()}>
          <div className="wfw-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
            <span style={{ opacity: 0.5 }}>Loading workflow…</span>
          </div>
        </div>
      </div>
    )
  }

  if (!wf) return null

  function next() {
    if (step < 4) {
      setStep((s) => s + 1)
      if (step + 1 !== 1) setCanAdvance(true)
    }
  }
  function back() {
    if (step > 1) setStep((s) => s - 1)
  }
  function submit() {
    if (!wf) return
    // Codex Bundle 6 Q3 — guard against double-submit before React flushes
    // the button's disabled state on rapid clicks.
    if (launchMutation.isPending) return
    const conversationId = crypto.randomUUID()
    const summary = userMessage || `Launch ${wf.name}`
    launchMutation.mutate(
      {
        workflow_id: wf.id,
        conversation_id: conversationId,
        user_message: summary,
      },
      {
        onSuccess: (result) => {
          onClose()
          if (onRunLaunched) {
            onRunLaunched(result.run.id)
          } else {
            window.dispatchEvent(
              new CustomEvent('wf-toast', {
                detail: { msg: `Workflow Run created: ${result.run.id}` },
              }),
            )
          }
        },
        onError: (err) => {
          window.dispatchEvent(
            new CustomEvent('wf-toast', {
              detail: { msg: `Launch failed: ${(err).message}` },
            }),
          )
        },
      },
    )
  }

  const isLast = step === 4

  return (
    <div className="wfw-backdrop" onClick={onClose}>
      <div className="wfw-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="wfw-header">
          <div className="wfw-progress">
            {STEP_TITLES.map((title, i) => {
              const num = i + 1
              const isActive = num === step
              const isDone = num < step
              return (
                <div key={title} className="wfw-progress-item">
                  <span
                    className={`wfw-progress-dot ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
                  >
                    {num}
                  </span>
                  <span className="wfw-progress-title">{title}</span>
                </div>
              )
            })}
          </div>
          <button className="wfw-close-btn" onClick={onClose} aria-label="Close wizard">✕</button>
        </div>

        {/* Body */}
        <div className="wfw-body">
          {step === 1 && (
            <Step1Plan
              wf={wf}
              userMessage={userMessage}
              setUserMessage={setUserMessage}
            />
          )}
          {step === 2 && (
            <Step2Route wf={wf} agentMap={agentMap} setAgentMap={setAgentMap} />
          )}
          {step === 3 && (
            <Step3Schedule schedule={schedule} setSchedule={setSchedule} />
          )}
          {step === 4 && (
            <Step4Confirm
              wf={wf}
              agentMap={agentMap}
              schedule={schedule}
              onSubmit={submit}
              isSubmitting={launchMutation.isPending}
            />
          )}
        </div>

        {/* Footer */}
        <div className="wfw-footer">
          <button
            className="wfw-btn wfw-btn--secondary"
            onClick={back}
            disabled={step === 1}
          >
            Back
          </button>
          <div className="wfw-footer-spacer" />
          <button className="wfw-btn wfw-btn--ghost" onClick={onClose}>Cancel</button>
          {!isLast && (
            <button
              className="wfw-btn wfw-btn--primary"
              onClick={next}
              disabled={step === 1 && !canAdvance}
            >
              {step === 3 ? 'Next — Review' : 'Next'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
