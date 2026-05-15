/**
 * NewWorkflowWizard — 4-step wizard for creating a workflow definition.
 *
 * Step 1 DESCRIBE  — fully wired: start-from picker, patterns chips, Hermes prompt panel, chat input
 * Step 2 DESIGN    — placeholder (TODO: DAG design surface)
 * Step 3 CONFIGURE — placeholder (TODO: node/agent configuration surface)
 * Step 4 SAVE      — real form: id, name, description, source, YAML → POST /api/workflow-definitions
 *
 * Design source: docs/Design Assets/Hermes-Switchui/workflows-app.jsx + Workflows.html
 */
import { useEffect, useRef, useState } from 'react'
import { useUpsertWorkflowDefinition, useWorkflowDefinitions } from './use-workflows'

// ── Constants ───────────────────────────────────────────────────────────────

const STEPS = ['DESCRIBE', 'DESIGN', 'CONFIGURE', 'SAVE'] as const
type StepLabel = (typeof STEPS)[number]

const ID_REGEX = /^[A-Za-z0-9_:.-]{1,128}$/

const YAML_TEMPLATE = `id: my-workflow
name: My Workflow
description: ""
nodes:
  - id: start
    type: prompt
    prompt: "Hello"
`

function slugify(raw: string): string {
  return raw
    .replace(/\.ya?ml$/i, '')
    .replace(/[^A-Za-z0-9_:.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
}

const START_OPTIONS = [
  { label: 'Scratch',     desc: 'Describe from scratch',        color: 'var(--m-green-500, #00ff41)' },
  { label: 'Duplicate',   desc: 'Copy an existing workflow',     color: '#5ad3ff' },
  { label: 'Template',    desc: 'Use a workflow pattern',        color: '#b07cff' },
  { label: 'Import YAML', desc: 'Upload a .yaml file',           color: '#ffb454' },
] as const
type StartOption = (typeof START_OPTIONS)[number]['label']

const PATTERN_CHIPS = [
  { label: 'Pipeline',    desc: 'Linear chain of steps',             color: '#ffb454' },
  { label: 'Review',      desc: 'Parallel review agents',            color: '#5ad3ff' },
  { label: 'Interactive', desc: 'Human-in-the-loop checkpoints',     color: '#b07cff' },
  { label: 'Specialist',  desc: 'Focused single-purpose agent',      color: 'var(--m-green-500, #00ff41)' },
] as const

type ChatMessage = { role: 'assistant' | 'user'; msg: string }

const NWZ_CHAT_INIT: Array<ChatMessage> = [
  { role: 'assistant', msg: "Let's build a new workflow. Describe what you want it to do — the steps it should take, what triggers it, and what the output should look like." },
]

// ── Sub-components ──────────────────────────────────────────────────────────

interface StepBarProps { step: number }
function StepBar({ step }: StepBarProps) {
  return (
    <div className="wz-steps">
      <div className="wz-steps-line" />
      {STEPS.map((label, i) => {
        const n = i + 1
        const cls = n < step ? 'done' : n === step ? 'cur' : ''
        return (
          <div key={n} className={`wz-step ${cls}`}>
            <div className="wz-dot">{n < step ? '✓' : n}</div>
            <div className="wz-lbl">{label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Describe ────────────────────────────────────────────────────────

interface DescribeStepProps {
  activeStart: StartOption
  onSelectStart: (s: StartOption) => void
  chatHistory: Array<ChatMessage>
  chatInput: string
  onChatInput: (v: string) => void
  onSend: () => void
  patternFilter: string
  onPatternFilter: (l: string) => void
  importRef: React.RefObject<HTMLInputElement | null>
  onImportChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function DescribeStep({
  activeStart,
  onSelectStart,
  chatHistory,
  chatInput,
  onChatInput,
  onSend,
  patternFilter,
  onPatternFilter,
  importRef,
  onImportChange,
}: DescribeStepProps) {
  const msgsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  return (
    <div className="wz-plan">
      {/* Left rail: start-from + patterns */}
      <div className="plan-summary">
        <div className="ps-title" style={{ marginBottom: 10 }}>Start from…</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {START_OPTIONS.map(({ label, desc, color }) => (
            <div
              key={label}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelectStart(label)
                if (label === 'Import YAML') importRef.current?.click()
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectStart(label) }}
              style={{
                padding: '9px 11px',
                border: `1px solid ${activeStart === label ? color : 'var(--m-border-subtle, #2a2a2a)'}`,
                borderRadius: 5,
                background: activeStart === label ? `${color}12` : 'var(--m-bg, #0d0d0d)',
                cursor: 'pointer',
                transition: 'border-color .15s',
              }}
            >
              <div style={{ font: `600 11px var(--m-font-mono, monospace)`, color: activeStart === label ? color : 'var(--m-text, #e0e0e0)', marginBottom: 2 }}>{label}</div>
              <div style={{ font: `400 10px var(--m-font-sans, sans-serif)`, color: 'var(--m-text-ghost, #555)' }}>{desc}</div>
            </div>
          ))}
        </div>

        {/* Hidden file input for Import YAML */}
        <input
          ref={importRef}
          type="file"
          accept=".yml,.yaml,text/yaml"
          style={{ display: 'none' }}
          onChange={onImportChange}
        />

        <div style={{ marginTop: 14 }}>
          <div className="act-lbl" style={{ marginBottom: 7 }}>Patterns</div>
          <div style={{ display: 'grid', gap: 5 }}>
            {PATTERN_CHIPS.map(({ label, desc, color }) => (
              <div
                key={label}
                role="button"
                tabIndex={0}
                onClick={() => onPatternFilter(patternFilter === label ? '' : label)}
                onKeyDown={(e) => { if (e.key === 'Enter') onPatternFilter(patternFilter === label ? '' : label) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 8px',
                  border: `1px solid ${patternFilter === label ? color : 'var(--m-border-subtle, #2a2a2a)'}`,
                  borderRadius: 4,
                  background: patternFilter === label ? `${color}10` : 'var(--m-bg, #0d0d0d)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 5px ${color}` }} />
                <span style={{ font: `500 10px var(--m-font-mono, monospace)`, color: 'var(--m-text, #e0e0e0)' }}>{label}</span>
                <span style={{ font: `400 9px var(--m-font-sans, sans-serif)`, color: 'var(--m-text-ghost, #555)', flex: 1 }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right pane: Hermes prompt panel */}
      <div className="plan-chat">
        <div className="chat-msgs">
          {chatHistory.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <span className="chat-who">{m.role === 'assistant' ? 'Hermes' : 'You'}</span>
              <div className="chat-text">
                {m.msg.split('\n').map((line, j) => <p key={j}>{line}</p>)}
              </div>
            </div>
          ))}
          <div ref={msgsEndRef} />
        </div>
        <div className="chat-input-row">
          <input
            className="chat-inp"
            placeholder="Describe your workflow in plain language…"
            value={chatInput}
            onChange={(e) => onChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSend() }}
          />
          <button className="btn-mini prim" onClick={onSend}>Send</button>
        </div>
      </div>
    </div>
  )
}

// ── Step 2: Design (placeholder) ────────────────────────────────────────────

function DesignStep() {
  // TODO: DAG design surface — node editor / visual builder goes here
  return (
    <div className="wfw-placeholder-pane">
      <div className="wfw-placeholder-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="32" height="32">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="8" y="14" width="8" height="7" rx="1" />
          <path d="M6.5 10v4M17.5 10v4M10.5 17.5H13" strokeDasharray="2 2" />
        </svg>
      </div>
      <div className="wfw-placeholder-title">DAG Design Surface</div>
      <div className="wfw-placeholder-desc">
        Visual node editor and DAG builder coming soon. After creation you can edit nodes in the YAML editor.
      </div>
    </div>
  )
}

// ── Step 3: Configure (placeholder) ─────────────────────────────────────────

function ConfigureStep() {
  // TODO: node/agent configuration panel goes here
  return (
    <div className="wfw-placeholder-pane">
      <div className="wfw-placeholder-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="32" height="32">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
        </svg>
      </div>
      <div className="wfw-placeholder-title">Node Configuration</div>
      <div className="wfw-placeholder-desc">
        Agent assignment, variable bindings, and node-level overrides coming soon. Use the YAML editor for full control after creation.
      </div>
    </div>
  )
}

// ── Step 4: Save ─────────────────────────────────────────────────────────────

interface SaveStepProps {
  id: string
  name: string
  description: string
  source: 'user' | 'project'
  yaml: string
  serverError: string | null
  isPending: boolean
  onIdChange: (v: string) => void
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onSourceChange: (v: 'user' | 'project') => void
  onYamlChange: (v: string) => void
  onSubmit: () => void
}

function SaveStep({
  id, name, description, source, yaml,
  serverError, isPending,
  onIdChange, onNameChange, onDescriptionChange, onSourceChange, onYamlChange,
}: SaveStepProps) {
  const idValid = ID_REGEX.test(id)
  const fieldStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--m-text-muted, var(--text-muted, #888))' }

  return (
    <div className="wfw-save-pane">
      {/* ID */}
      <div style={{ marginBottom: 14 }}>
        <label className="wfrd-label" style={labelStyle}>
          ID <span style={{ color: 'var(--text-danger, #e55)' }}>*</span>
        </label>
        <input
          className="wfrd-input"
          type="text"
          value={id}
          onChange={(e) => onIdChange(e.target.value)}
          placeholder="my-workflow"
          style={fieldStyle}
        />
        {id.length > 0 && !idValid && (
          <div style={{ color: 'var(--text-danger, #e55)', fontSize: 11, marginTop: 3 }}>
            id must be 1–128 chars of [A-Za-z0-9_:.-]
          </div>
        )}
      </div>

      {/* Name */}
      <div style={{ marginBottom: 14 }}>
        <label className="wfrd-label" style={labelStyle}>
          Name <span style={{ color: 'var(--text-danger, #e55)' }}>*</span>
        </label>
        <input
          className="wfrd-input"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My Workflow"
          style={fieldStyle}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 14 }}>
        <label className="wfrd-label" style={labelStyle}>Description</label>
        <input
          className="wfrd-input"
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Optional description"
          style={fieldStyle}
        />
      </div>

      {/* Source */}
      <div style={{ marginBottom: 14 }}>
        <label className="wfrd-label" style={labelStyle}>Source</label>
        <select
          className="wfrd-select"
          value={source}
          onChange={(e) => onSourceChange(e.target.value as 'user' | 'project')}
          style={fieldStyle}
        >
          <option value="project">project</option>
          <option value="user">user</option>
        </select>
      </div>

      {/* YAML */}
      <div style={{ marginBottom: 18 }}>
        <label className="wfrd-label" style={labelStyle}>
          YAML <span style={{ color: 'var(--text-danger, #e55)' }}>*</span>
        </label>
        <textarea
          className="wfrd-yaml"
          value={yaml}
          onChange={(e) => onYamlChange(e.target.value)}
          rows={14}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        />
      </div>

      {serverError && (
        <div style={{ color: 'var(--text-danger, #e55)', fontSize: 12, marginBottom: 12 }}>
          {serverError}
        </div>
      )}

      {isPending && (
        <div style={{ color: 'var(--m-text-muted, #888)', fontSize: 12, marginBottom: 8 }}>Saving…</div>
      )}
    </div>
  )
}

// ── Main wizard ──────────────────────────────────────────────────────────────

export interface NewWorkflowWizardProps {
  /** If provided, wizard opens with Import YAML pre-selected and this as the YAML content */
  initialYaml?: string
  /** If provided, pre-fills the ID field on Step 4 */
  initialId?: string
  onClose: () => void
}

export function NewWorkflowWizard({ initialYaml, initialId, onClose }: NewWorkflowWizardProps) {
  const [step, setStep] = useState(1)

  // Step 1 state
  const [activeStart, setActiveStart] = useState<StartOption>(initialYaml ? 'Import YAML' : 'Scratch')
  const [chatHistory, setChatHistory] = useState<Array<ChatMessage>>(NWZ_CHAT_INIT)
  const [chatInput, setChatInput] = useState('')
  const [patternFilter, setPatternFilter] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  // Step 4 state (pre-filled from step 1 interactions)
  const [id, setId] = useState(initialId ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState<'user' | 'project'>('project')
  const [yaml, setYaml] = useState(initialYaml ?? YAML_TEMPLATE)
  const [serverError, setServerError] = useState<string | null>(null)

  const upsert = useUpsertWorkflowDefinition()
  // For Duplicate picker
  const { data: existingWorkflows } = useWorkflowDefinitions()

  const idValid = ID_REGEX.test(id)
  const canSave = idValid && name.trim().length > 0 && yaml.trim().length > 0 && !upsert.isPending

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSend() {
    const userMsg = chatInput.trim()
    if (!userMsg) return
    const suggested = userMsg
      .split(' ')
      .filter((w) => w.length > 3)
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    const suggestedName = suggested || 'Custom'
    setChatHistory((h) => [
      ...h,
      { role: 'user', msg: userMsg },
      {
        role: 'assistant',
        msg: `Understood — mapping this as a 5-node pipeline: analyze → plan → execute → validate → output.\n\nSuggested name: ${suggestedName} Workflow\n\nI'll pre-fill the configuration in step 3. Ready to review the proposed DAG?`,
      },
    ])
    setChatInput('')
    if (!name) setName(suggestedName + ' Workflow')
    if (!id) setId(slugify(suggestedName + '-workflow'))
    if (!description) setDescription(userMsg.slice(0, 90))
  }

  function handleImportChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((text) => {
      setYaml(text)
      if (!id) setId(slugify(file.name))
      if (!name) setName(file.name.replace(/\.ya?ml$/i, ''))
    })
    e.target.value = ''
  }

  function handleDuplicateSelect(wfId: string) {
    const wf = existingWorkflows?.find((w) => w.id === wfId)
    if (!wf) return
    setYaml(wf.yaml || YAML_TEMPLATE)
    setName(wf.name + ' (copy)')
    setDescription(wf.description || '')
    setId(slugify(wf.id + '-copy'))
  }

  async function handleSave() {
    setServerError(null)
    try {
      const tags = patternFilter ? [patternFilter.toLowerCase()] : undefined
      await upsert.mutateAsync({ id, name: name.trim(), description: description.trim() || undefined, source, yaml, tags })
      onClose()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const currentStepLabel = STEPS[step - 1] ?? 'DESCRIBE'

  return (
    <div
      className="wizard-scrim"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="wizard-modal"
        style={{
          background: 'var(--m-bg-panel, var(--bg-2, #111))',
          border: '1px solid var(--m-border, var(--border, #2a2a2a))',
          borderRadius: 10,
          width: 860,
          maxWidth: '97vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div className="wz-head" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--m-border, #2a2a2a)', flexShrink: 0 }}>
          <div
            className="wz-icon"
            style={{
              width: 34, height: 34, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,255,65,.08)', border: '1px solid var(--m-green-500, #00ff41)',
              color: 'var(--m-green-500, #00ff41)', boxShadow: '0 0 10px rgba(0,255,65,.3)', flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--m-text, #e0e0e0)', letterSpacing: '.02em' }}>New Workflow</h2>
            <div className="wz-sub" style={{ fontSize: 10, color: 'var(--m-text-muted, #888)', marginTop: 2, fontFamily: 'var(--m-font-mono, monospace)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              CREATE A WORKFLOW DEFINITION · STEP {step} OF 4 — {currentStepLabel}
            </div>
          </div>
          <button
            className="wz-close"
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-text-muted, #888)', padding: 4, lineHeight: 1 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Step bar ── */}
        <StepBar step={step} />

        {/* ── Body ── */}
        <div className="wz-body" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {step === 1 && activeStart === 'Duplicate' && (
            <div style={{ marginBottom: 12 }}>
              <label className="act-lbl" style={{ display: 'block', marginBottom: 6 }}>Duplicate from existing workflow</label>
              <select
                className="wfrd-select"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
                defaultValue=""
                onChange={(e) => handleDuplicateSelect(e.target.value)}
              >
                <option value="" disabled>Select a workflow…</option>
                {(existingWorkflows ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}{w.source === 'bundled' ? ' (built-in)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {step === 1 && activeStart === 'Template' && (
            <div style={{ marginBottom: 12 }}>
              <label className="act-lbl" style={{ display: 'block', marginBottom: 6 }}>Start from a built-in template</label>
              <select
                className="wfrd-select"
                style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
                defaultValue=""
                onChange={(e) => handleDuplicateSelect(e.target.value)}
              >
                <option value="" disabled>Select a template…</option>
                {(existingWorkflows ?? [])
                  .filter((w) => w.source === 'bundled')
                  .map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
              </select>
            </div>
          )}

          {step === 1 && (
            <DescribeStep
              activeStart={activeStart}
              onSelectStart={setActiveStart}
              chatHistory={chatHistory}
              chatInput={chatInput}
              onChatInput={setChatInput}
              onSend={handleSend}
              patternFilter={patternFilter}
              onPatternFilter={setPatternFilter}
              importRef={importRef}
              onImportChange={handleImportChange}
            />
          )}

          {step === 2 && <DesignStep />}

          {step === 3 && <ConfigureStep />}

          {step === 4 && (
            <SaveStep
              id={id}
              name={name}
              description={description}
              source={source}
              yaml={yaml}
              serverError={serverError}
              isPending={upsert.isPending}
              onIdChange={setId}
              onNameChange={setName}
              onDescriptionChange={setDescription}
              onSourceChange={setSource}
              onYamlChange={setYaml}
              onSubmit={() => { void handleSave() }}
            />
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="wz-foot"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--m-border, #2a2a2a)', flexShrink: 0 }}
        >
          <span className="wz-foot-step" style={{ font: '500 10px var(--m-font-mono, monospace)', color: 'var(--m-text-faint, #444)', textTransform: 'uppercase', letterSpacing: '.14em' }}>
            Step {step} / 4
          </span>
          <div className="wz-nav" style={{ display: 'flex', gap: 8 }}>
            {step > 1 && (
              <button className="btn-mini" type="button" onClick={() => setStep((s) => s - 1)}>← Back</button>
            )}
            {step < 4 && (
              <button className="btn-mini prim" type="button" onClick={() => setStep((s) => s + 1)}>Next →</button>
            )}
            {step === 4 && (
              <button
                className="btn-mini prim"
                type="button"
                style={{ minWidth: 130 }}
                disabled={!canSave}
                onClick={() => { void handleSave() }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="11" height="11" style={{ marginRight: 5 }}>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Save Workflow
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Wizard-specific styles ── */}
      <style>{`
        .wz-steps {
          display: flex;
          justify-content: center;
          gap: 40px;
          padding: 14px 20px 10px;
          position: relative;
          flex-shrink: 0;
          border-bottom: 1px solid var(--m-border, #2a2a2a);
        }
        .wz-steps-line {
          position: absolute;
          top: 50%;
          left: 80px;
          right: 80px;
          height: 1px;
          background: var(--m-border, #2a2a2a);
          transform: translateY(-50%);
          z-index: 0;
        }
        .wz-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          position: relative;
          z-index: 1;
        }
        .wz-dot {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: 1px solid var(--m-border, #2a2a2a);
          display: flex;
          align-items: center;
          justify-content: center;
          font: 600 11px var(--m-font-mono, monospace);
          color: var(--m-text-muted, #888);
          background: var(--m-bg-panel, #111);
        }
        .wz-step.done .wz-dot {
          background: rgba(0,255,65,.08);
          border-color: var(--m-green-500, #00ff41);
          color: var(--m-green-500, #00ff41);
        }
        .wz-step.cur .wz-dot {
          background: var(--m-green-500, #00ff41);
          border-color: var(--m-green-500, #00ff41);
          color: #021204;
          font-weight: 700;
          box-shadow: 0 0 14px rgba(0,255,65,.5);
        }
        .wz-lbl {
          font: 500 9px var(--m-font-mono, monospace);
          color: var(--m-text-ghost, #555);
          text-transform: uppercase;
          letter-spacing: .1em;
        }
        .wz-step.cur .wz-lbl { color: var(--m-green-500, #00ff41); }
        .wz-step.done .wz-lbl { color: var(--m-text-muted, #888); }

        /* Describe step layout */
        .wz-plan {
          display: grid;
          grid-template-columns: 200px 1fr;
          gap: 16px;
          height: 380px;
        }
        .plan-summary {
          overflow-y: auto;
          padding-right: 4px;
        }
        .ps-title {
          font: 600 11px var(--m-font-mono, monospace);
          color: var(--m-text, #e0e0e0);
          text-transform: uppercase;
          letter-spacing: .08em;
        }
        .plan-chat {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--m-border-subtle, #222);
          border-radius: 6px;
          overflow: hidden;
          background: var(--m-bg-deep, #0a0a0a);
        }
        .chat-msgs {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .chat-msg { display: flex; flex-direction: column; gap: 3px; }
        .chat-who {
          font: 600 9px var(--m-font-mono, monospace);
          text-transform: uppercase;
          letter-spacing: .1em;
          color: var(--m-text-muted, #888);
        }
        .chat-msg.assistant .chat-who { color: var(--m-green-500, #00ff41); }
        .chat-text { font: 400 12px var(--m-font-sans, sans-serif); color: var(--m-text, #e0e0e0); line-height: 1.5; }
        .chat-text p { margin: 0 0 2px; }
        .chat-input-row {
          display: flex;
          gap: 8px;
          padding: 10px;
          border-top: 1px solid var(--m-border-subtle, #222);
        }
        .chat-inp {
          flex: 1;
          background: var(--m-bg, #0d0d0d);
          border: 1px solid var(--m-border-subtle, #222);
          border-radius: 4px;
          padding: 6px 10px;
          font: 400 12px var(--m-font-sans, sans-serif);
          color: var(--m-text, #e0e0e0);
          outline: none;
        }
        .chat-inp:focus { border-color: var(--m-green-500, #00ff41); }

        /* Placeholder panes */
        .wfw-placeholder-pane {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 340px;
          gap: 14px;
          color: var(--m-text-ghost, #555);
          border: 1px dashed var(--m-border-subtle, #222);
          border-radius: 8px;
          background: var(--m-bg-deep, #0a0a0a);
        }
        .wfw-placeholder-icon { color: var(--m-text-faint, #444); }
        .wfw-placeholder-title {
          font: 600 13px var(--m-font-mono, monospace);
          color: var(--m-text-muted, #888);
          text-transform: uppercase;
          letter-spacing: .1em;
        }
        .wfw-placeholder-desc {
          font: 400 12px var(--m-font-sans, sans-serif);
          color: var(--m-text-ghost, #555);
          max-width: 400px;
          text-align: center;
          line-height: 1.6;
        }

        /* Save pane */
        .wfw-save-pane { max-width: 560px; margin: 0 auto; }

        /* btn-mini */
        .btn-mini {
          padding: 5px 12px;
          font: 500 10px var(--m-font-mono, monospace);
          text-transform: uppercase;
          letter-spacing: .1em;
          border-radius: 4px;
          border: 1px solid var(--m-border, #333);
          background: transparent;
          color: var(--m-text, #e0e0e0);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
        }
        .btn-mini:disabled { opacity: .45; cursor: not-allowed; }
        .btn-mini.prim {
          border-color: var(--m-green-500, #00ff41);
          color: var(--m-green-500, #00ff41);
          background: rgba(0,255,65,.06);
        }
        .btn-mini.prim:not(:disabled):hover { background: rgba(0,255,65,.14); }

        .act-lbl {
          font: 600 10px var(--m-font-mono, monospace);
          text-transform: uppercase;
          letter-spacing: .1em;
          color: var(--m-text-muted, #888);
        }
      `}</style>
    </div>
  )
}
