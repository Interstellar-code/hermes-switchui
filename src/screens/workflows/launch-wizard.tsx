import { useEffect, useRef, useState } from 'react'
import { MOCK_WORKFLOWS, type MockWorkflow, type NodeType } from './mock-workflows'

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
}

const STEP_TITLES = ['Plan', 'Route', 'Schedule', 'Confirm'] as const

function agentForNode(nodeId: string): Agent {
  let h = 0
  for (let i = 0; i < nodeId.length; i++) h = (h * 31 + nodeId.charCodeAt(i)) & 0xffff
  return AGENTS[h % 4]
}

// ── Step 1 — Plan ─────────────────────────────────────────────────────────────

interface ChatMsg {
  role: 'switch' | 'user'
  text: string
}

function Step1Plan({ wf, onUserSent }: { wf: MockWorkflow; onUserSent: (sent: boolean) => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      role: 'switch',
      text: `I see you want to launch **${wf.name}**. What's the issue number or repo context?`,
    },
  ])
  const [draft, setDraft] = useState('')
  const [hasSent, setHasSent] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  function send() {
    const text = draft.trim()
    if (!text) return
    const newMsgs: ChatMsg[] = [
      ...msgs,
      { role: 'user', text },
      {
        role: 'switch',
        text: `Understood. I'll use that context to configure the run. You can proceed to routing.`,
      },
    ]
    setMsgs(newMsgs)
    setDraft('')
    if (!hasSent) {
      setHasSent(true)
      onUserSent(true)
    }
  }

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

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
      </div>
      <div className="wfw-s1-right">
        <div className="wfw-chat-header">Hermes T1 Switch</div>
        <div className="wfw-chat-msgs" ref={chatRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`wfw-bubble wfw-bubble--${m.role}`}>
              {m.role === 'switch' && <span className="wfw-bubble-sender">Switch</span>}
              <span>{m.text}</span>
            </div>
          ))}
        </div>
        <div className="wfw-chat-input-row">
          <input
            className="wfw-chat-input"
            placeholder="Type a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="wfw-chat-send" onClick={send} disabled={!draft.trim()}>
            Send
          </button>
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
  wf: MockWorkflow
  agentMap: Record<string, Agent>
  setAgentMap: React.Dispatch<React.SetStateAction<Record<string, Agent>>>
}) {
  const [popupNode, setPopupNode] = useState<string | null>(null)

  const W = 110
  const H = 44
  const R = 5
  const PAD = 24

  const hasDag = wf.dag.length > 0

  const posMap: Record<string, { x: number; y: number }> = {}
  for (const n of wf.dag) posMap[n.id] = { x: n.cx, y: n.cy }

  const svgW = hasDag ? Math.max(...wf.dag.map((n) => n.cx + W / 2)) + PAD : 400
  const svgH = hasDag ? Math.max(...wf.dag.map((n) => n.cy + H / 2 + 20)) + PAD : 120

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
                  markerEnd="url(#wfw-arrow)"
                />
              )
            })}
            {wf.dag.map((n) => {
              const c = NODE_COLOR[n.type] ?? '#00ff41'
              const agent = agentMap[n.id] ?? agentForNode(n.id)
              return (
                <g
                  key={n.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleNodeClick(n.id)}
                >
                  <rect
                    x={n.cx - W / 2}
                    y={n.cy - H / 2}
                    width={W}
                    height={H}
                    rx={R}
                    fill={popupNode === n.id ? 'rgba(0,255,65,.1)' : 'rgba(4,16,8,.9)'}
                    stroke={c}
                    strokeWidth="1"
                  />
                  <text
                    x={n.cx}
                    y={n.cy - 8}
                    textAnchor="middle"
                    style={{ font: '600 10px var(--m-font-mono, ui-monospace, monospace)', fill: '#e8ffe8', letterSpacing: '.04em' }}
                  >
                    {n.label}
                  </text>
                  <text
                    x={n.cx}
                    y={n.cy + 4}
                    textAnchor="middle"
                    style={{ font: '500 8px var(--m-font-mono, ui-monospace, monospace)', fill: c, letterSpacing: '.1em', textTransform: 'uppercase' }}
                  >
                    {n.type}
                  </text>
                  <text
                    x={n.cx}
                    y={n.cy + 16}
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
  function update<K extends keyof ScheduleState>(k: K, v: ScheduleState[K]) {
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
}: {
  wf: MockWorkflow
  agentMap: Record<string, Agent>
  schedule: ScheduleState
  onSubmit: () => void
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
          <div className="wfw-cc-row"><span>Version</span><span>{wf.version_tier}</span></div>
        </div>
        <div className="wfw-confirm-card">
          <div className="wfw-cc-title">Execution</div>
          <div className="wfw-cc-row"><span>Schedule</span><span>{scheduleLabel}</span></div>
          <div className="wfw-cc-row"><span>Priority</span><span>{schedule.priority}</span></div>
          <div className="wfw-cc-row"><span>Max runtime</span><span>{schedule.maxRuntime}s</span></div>
        </div>
        {wf.dag.length > 0 && (
          <div className="wfw-confirm-card">
            <div className="wfw-cc-title">Agent Assignments</div>
            {wf.dag.map((n) => (
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

      <button className="wfw-submit-btn" onClick={onSubmit}>
        Submit as Workflow Run
      </button>
    </div>
  )
}

// ── Main LaunchWizard ─────────────────────────────────────────────────────────

interface LaunchWizardProps {
  workflowId: string | null
  onClose: () => void
}

export function LaunchWizard({ workflowId, onClose }: LaunchWizardProps) {
  const [step, setStep] = useState(1)
  const [canAdvance, setCanAdvance] = useState(false)
  const [agentMap, setAgentMap] = useState<Record<string, Agent>>({})
  const [schedule, setSchedule] = useState<ScheduleState>({
    mode: 'now',
    datetime: '',
    cron: '',
    priority: 'normal',
    maxRuntime: 3600,
  })

  const wf = workflowId ? MOCK_WORKFLOWS.find((w) => w.id === workflowId) ?? null : null

  // Reset state when workflow changes
  useEffect(() => {
    setStep(1)
    setCanAdvance(false)
    setAgentMap({})
    setSchedule({ mode: 'now', datetime: '', cron: '', priority: 'normal', maxRuntime: 3600 })
  }, [workflowId])

  // Keyboard dismiss
  useEffect(() => {
    if (!wf) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wf, onClose])

  if (!wf) return null

  function next() {
    if (step < 4) {
      setStep((s) => s + 1)
      if (step + 1 !== 1) setCanAdvance(true) // steps 2-4 always advanceable
    }
  }
  function back() {
    if (step > 1) setStep((s) => s - 1)
  }
  function submit() {
    window.dispatchEvent(new CustomEvent('wf-toast', { detail: { msg: 'Workflow Run created' } }))
    onClose()
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
              onUserSent={(sent) => setCanAdvance(sent)}
            />
          )}
          {step === 2 && (
            <Step2Route wf={wf} agentMap={agentMap} setAgentMap={setAgentMap} />
          )}
          {step === 3 && (
            <Step3Schedule schedule={schedule} setSchedule={setSchedule} />
          )}
          {step === 4 && (
            <Step4Confirm wf={wf} agentMap={agentMap} schedule={schedule} onSubmit={submit} />
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
