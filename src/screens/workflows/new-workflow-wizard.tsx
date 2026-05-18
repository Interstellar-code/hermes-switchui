/**
 * NewWorkflowWizard — 4-step wizard for creating a workflow definition.
 *
 * Step 1 DESCRIBE  — fully wired: start-from picker, Hermes prompt panel, chat input
 * Step 2 DESIGN    — live DAG preview (DagSvg + parseDagFromYaml)
 * Step 3 CONFIGURE — node-level editing with YAML round-tripping
 * Step 4 SAVE      — real form: id, name, description, source, YAML → POST /api/workflow-definitions
 *
 * Design source: docs/Design Assets/Hermes-Switchui/workflows-app.jsx + Workflows.html
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  useUpsertWorkflowDefinition,
  useWorkflowDefinitions,
} from './use-workflows'
import { chatWorkflowWizard } from './api-client'
import type { NodeType, WorkflowSummary } from './types'

// ── Constants ───────────────────────────────────────────────────────────────

const STEPS = ['DESCRIBE', 'DESIGN', 'CONFIGURE', 'SAVE'] as const
type StepLabel = (typeof STEPS)[number]

const ID_REGEX = /^[A-Za-z0-9_:.-]{1,128}$/

const YAML_TEMPLATE = `name: My Workflow
description: New workflow
nodes:
  - id: start
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
  {
    label: 'Scratch',
    desc: 'Describe from scratch',
    color: 'var(--m-green-500, #00ff41)',
  },
  { label: 'Duplicate', desc: 'Copy an existing workflow', color: '#5ad3ff' },
  { label: 'Template', desc: 'Use a workflow pattern', color: '#b07cff' },
  { label: 'Import YAML', desc: 'Upload a .yaml file', color: '#ffb454' },
] as const
type StartOption = (typeof START_OPTIONS)[number]['label']

type ChatMessage = { role: 'assistant' | 'user'; msg: string }

interface WizardHermesTaskDraft {
  skills: string
  agent_hint: string
  model_hint: string
}

interface WizardNodeDraft {
  id: string
  type: NodeType
  phase: string
  depends_on: Array<string>
  model: string
  provider: string
  skills: string
  hermes_task_enabled: boolean
  hermes_task: WizardHermesTaskDraft
  prompt: string
  command: string
  bash: string
  script: string
  runtime: string
  cancel: string
  approval_message: string
  approval_capture_response: boolean
  loop_prompt: string
  loop_until: string
  loop_max_iterations: number
  raw: Record<string, unknown>
}

interface WizardDocumentDraft {
  id: string
  name: string
  description: string
  topLevel: Record<string, unknown>
  nodes: Array<WizardNodeDraft>
}

const NODE_TYPE_OPTIONS: Array<NodeType> = [
  'prompt',
  'command',
  'bash',
  'script',
  'approval',
  'loop',
  'cancel',
]

const TOP_LEVEL_RESERVED_KEYS = new Set(['id', 'name', 'description', 'nodes'])
const COMMON_NODE_KEYS = [
  'id',
  'phase',
  'depends_on',
  'model',
  'provider',
  'skills',
  'hermes_task',
]
const VARIANT_NODE_KEYS = [
  'prompt',
  'command',
  'bash',
  'script',
  'runtime',
  'cancel',
  'approval',
  'loop',
]

const NWZ_CHAT_INIT: Array<ChatMessage> = [
  {
    role: 'assistant',
    msg: "Let's build a new workflow. Describe what you want it to do — the steps it should take, what triggers it, and what the output should look like.",
  },
]

function splitCsv(raw: string): Array<string> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function inferNodeType(raw: Record<string, unknown>): NodeType {
  if (typeof raw['prompt'] === 'string') return 'prompt'
  if (typeof raw['command'] === 'string') return 'command'
  if (typeof raw['bash'] === 'string') return 'bash'
  if (typeof raw['script'] === 'string') return 'script'
  if (typeof raw['cancel'] === 'string') return 'cancel'
  if (raw['approval'] && typeof raw['approval'] === 'object') return 'approval'
  if (raw['loop'] && typeof raw['loop'] === 'object') return 'loop'
  return 'prompt'
}

function createDefaultNodeDraft(
  type: NodeType,
  index: number,
): WizardNodeDraft {
  const idBase =
    type === 'approval'
      ? 'review'
      : type === 'loop'
        ? 'iterate'
        : type === 'cancel'
          ? 'stop'
          : type
  return {
    id: `${idBase}-${index + 1}`,
    type,
    phase: '',
    depends_on: [],
    model: '',
    provider: '',
    skills: '',
    hermes_task_enabled: false,
    hermes_task: { skills: '', agent_hint: '', model_hint: '' },
    prompt:
      type === 'prompt' ? 'Describe the work this node should perform.' : '',
    command: type === 'command' ? 'replace-with-command' : '',
    bash: type === 'bash' ? 'echo "todo"' : '',
    script: type === 'script' ? 'console.log("todo")' : '',
    runtime: type === 'script' ? 'bun' : '',
    cancel: type === 'cancel' ? 'Cancelled by workflow' : '',
    approval_message:
      type === 'approval' ? 'Review the plan above. Approve to continue.' : '',
    approval_capture_response: false,
    loop_prompt: type === 'loop' ? 'Repeat until the task is complete.' : '',
    loop_until: type === 'loop' ? 'DONE' : '',
    loop_max_iterations: 3,
    raw: {},
  }
}

function toNodeDraft(
  rawNode: Record<string, unknown>,
  index: number,
): WizardNodeDraft {
  const type = inferNodeType(rawNode)
  const hermesTaskRaw =
    rawNode['hermes_task'] && typeof rawNode['hermes_task'] === 'object'
      ? (rawNode['hermes_task'] as Record<string, unknown>)
      : null
  const approvalRaw =
    rawNode['approval'] && typeof rawNode['approval'] === 'object'
      ? (rawNode['approval'] as Record<string, unknown>)
      : null
  const loopRaw =
    rawNode['loop'] && typeof rawNode['loop'] === 'object'
      ? (rawNode['loop'] as Record<string, unknown>)
      : null
  const base = createDefaultNodeDraft(type, index)
  return {
    ...base,
    id:
      typeof rawNode['id'] === 'string' && rawNode['id'].trim().length > 0
        ? rawNode['id']
        : base.id,
    phase: typeof rawNode['phase'] === 'string' ? rawNode['phase'] : '',
    depends_on: Array.isArray(rawNode['depends_on'])
      ? rawNode['depends_on'].filter(
          (dep): dep is string => typeof dep === 'string',
        )
      : [],
    model: typeof rawNode['model'] === 'string' ? rawNode['model'] : '',
    provider:
      typeof rawNode['provider'] === 'string' ? rawNode['provider'] : '',
    skills: Array.isArray(rawNode['skills'])
      ? rawNode['skills']
          .filter((skill): skill is string => typeof skill === 'string')
          .join(', ')
      : '',
    hermes_task_enabled: Boolean(hermesTaskRaw),
    hermes_task: {
      skills: Array.isArray(hermesTaskRaw?.['skills'])
        ? hermesTaskRaw['skills']
            .filter((skill): skill is string => typeof skill === 'string')
            .join(', ')
        : '',
      agent_hint:
        typeof hermesTaskRaw?.['agent_hint'] === 'string'
          ? hermesTaskRaw['agent_hint']
          : '',
      model_hint:
        typeof hermesTaskRaw?.['model_hint'] === 'string'
          ? hermesTaskRaw['model_hint']
          : '',
    },
    prompt: typeof rawNode['prompt'] === 'string' ? rawNode['prompt'] : '',
    command: typeof rawNode['command'] === 'string' ? rawNode['command'] : '',
    bash: typeof rawNode['bash'] === 'string' ? rawNode['bash'] : '',
    script: typeof rawNode['script'] === 'string' ? rawNode['script'] : '',
    runtime:
      typeof rawNode['runtime'] === 'string'
        ? rawNode['runtime']
        : base.runtime,
    cancel: typeof rawNode['cancel'] === 'string' ? rawNode['cancel'] : '',
    approval_message:
      typeof approvalRaw?.['message'] === 'string'
        ? approvalRaw['message']
        : '',
    approval_capture_response: Boolean(approvalRaw?.['capture_response']),
    loop_prompt:
      typeof loopRaw?.['prompt'] === 'string' ? loopRaw['prompt'] : '',
    loop_until: typeof loopRaw?.['until'] === 'string' ? loopRaw['until'] : '',
    loop_max_iterations:
      typeof loopRaw?.['max_iterations'] === 'number'
        ? loopRaw['max_iterations']
        : base.loop_max_iterations,
    raw: rawNode,
  }
}

function toWorkflowDocumentDraft(yamlStr: string): WizardDocumentDraft | null {
  const parsed = parseYaml(yamlStr)
  if (!parsed || typeof parsed !== 'object') return null
  const raw = parsed as Record<string, unknown>
  const topLevel = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !TOP_LEVEL_RESERVED_KEYS.has(key)),
  )
  const nodesRaw = Array.isArray(raw['nodes'])
    ? raw['nodes'].filter(
        (node): node is Record<string, unknown> =>
          Boolean(node) && typeof node === 'object' && !Array.isArray(node),
      )
    : []
  return {
    id: typeof raw['id'] === 'string' ? raw['id'] : '',
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    description:
      typeof raw['description'] === 'string' ? raw['description'] : '',
    topLevel,
    nodes: nodesRaw.map((node, index) => toNodeDraft(node, index)),
  }
}

function serializeNodeDraft(node: WizardNodeDraft): Record<string, unknown> {
  const next: Record<string, unknown> = { ...node.raw }
  for (const key of [...COMMON_NODE_KEYS, ...VARIANT_NODE_KEYS]) {
    delete next[key]
  }

  next.id = node.id.trim()
  if (node.phase.trim()) next.phase = node.phase.trim()
  if (node.depends_on.length > 0) next.depends_on = node.depends_on
  if (node.model.trim()) next.model = node.model.trim()
  if (node.provider.trim()) next.provider = node.provider.trim()

  const skills = splitCsv(node.skills)
  if (skills.length > 0) next.skills = skills

  if (node.hermes_task_enabled) {
    const hermesTask: Record<string, unknown> = {}
    const hermesSkills = splitCsv(node.hermes_task.skills)
    if (hermesSkills.length > 0) hermesTask.skills = hermesSkills
    if (node.hermes_task.agent_hint.trim()) {
      hermesTask.agent_hint = node.hermes_task.agent_hint.trim()
    }
    if (node.hermes_task.model_hint.trim()) {
      hermesTask.model_hint = node.hermes_task.model_hint.trim()
    }
    next.hermes_task = hermesTask
  }

  switch (node.type) {
    case 'prompt':
      next.prompt =
        node.prompt.trim() || 'Describe the work this node should perform.'
      break
    case 'command':
      next.command = node.command.trim() || 'replace-with-command'
      break
    case 'bash':
      next.bash = node.bash || 'echo "todo"'
      break
    case 'script':
      next.script = node.script || 'console.log("todo")'
      next.runtime = node.runtime.trim() || 'bun'
      break
    case 'approval':
      next.approval = {
        message:
          node.approval_message.trim() ||
          'Review the plan above. Approve to continue.',
        ...(node.approval_capture_response ? { capture_response: true } : {}),
      }
      break
    case 'loop':
      next.loop = {
        prompt: node.loop_prompt.trim() || 'Repeat until the task is complete.',
        until: node.loop_until.trim() || 'DONE',
        max_iterations: Math.max(1, Math.trunc(node.loop_max_iterations || 1)),
      }
      break
    case 'cancel':
      next.cancel = node.cancel.trim() || 'Cancelled by workflow'
      break
  }

  return next
}

function serializeWorkflowYaml(doc: WizardDocumentDraft): string {
  const root: Record<string, unknown> = { ...doc.topLevel }
  root.name = doc.name.trim() || 'Workflow'
  root.description = doc.description.trim() || 'New workflow'
  root.nodes = doc.nodes.map((node) => serializeNodeDraft(node))
  return stringifyYaml(root, { lineWidth: 0 })
}

function buildWorkflowFromPrompt(
  userMsg: string,
  currentName: string,
): WizardDocumentDraft {
  const tokens = userMsg
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const wantsApproval = tokens.some((token) =>
    ['approve', 'approval', 'review', 'human', 'checkpoint'].includes(token),
  )
  const wantsLoop = tokens.some((token) =>
    ['iterate', 'loop', 'repeat', 'retry'].includes(token),
  )
  const wantsCommand = tokens.some((token) =>
    ['command', 'cli'].includes(token),
  )
  const wantsScript = tokens.some((token) =>
    ['script', 'transform', 'parse'].includes(token),
  )

  const drafts: Array<WizardNodeDraft> = [
    {
      ...createDefaultNodeDraft('prompt', 0),
      id: 'analyze',
      phase: 'Plan',
      prompt: `Analyze this workflow request and extract the needed context, constraints, and success criteria.\n\nUser request:\n${userMsg}`,
    },
    {
      ...createDefaultNodeDraft('prompt', 1),
      id: 'plan',
      phase: 'Plan',
      depends_on: ['analyze'],
      prompt: `Create the execution plan for this workflow based on the analyzed request.\n\nOriginal request:\n${userMsg}`,
    },
  ]

  if (wantsApproval) {
    drafts.push({
      ...createDefaultNodeDraft('approval', drafts.length),
      id: 'review',
      phase: 'Review',
      depends_on: ['plan'],
      approval_message:
        'Review the generated plan and approve before execution continues.',
      approval_capture_response: true,
    })
  }

  drafts.push({
    ...createDefaultNodeDraft(
      wantsCommand ? 'command' : wantsScript ? 'script' : 'prompt',
      drafts.length,
    ),
    id: 'execute',
    phase: 'Execute',
    depends_on: [wantsApproval ? 'review' : 'plan'],
    command: wantsCommand ? 'replace-with-command' : '',
    script: wantsScript ? 'console.log("implement task transform here")' : '',
    runtime: wantsScript ? 'bun' : '',
    prompt: `Execute the planned work for this request.\n\nOriginal request:\n${userMsg}`,
  })

  if (wantsLoop) {
    drafts.push({
      ...createDefaultNodeDraft('loop', drafts.length),
      id: 'iterate',
      phase: 'Execute',
      depends_on: ['execute'],
      loop_prompt: `Repeat the execution/refinement cycle until the workflow goal is complete.\n\nOriginal request:\n${userMsg}`,
      loop_until: 'DONE',
      loop_max_iterations: 3,
    })
  }

  drafts.push({
    ...createDefaultNodeDraft('prompt', drafts.length),
    id: 'summarize',
    phase: 'Verify',
    depends_on: [wantsLoop ? 'iterate' : 'execute'],
    prompt: `Summarize results, validation status, and final output for this workflow.\n\nOriginal request:\n${userMsg}`,
  })

  return {
    id: '',
    name: currentName,
    description: userMsg.slice(0, 160),
    topLevel: {},
    nodes: drafts,
  }
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface StepBarProps {
  step: number
}
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
  chatPending: boolean
  onChatInput: (v: string) => void
  onSend: () => void
  importRef: React.RefObject<HTMLInputElement | null>
  onImportChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  importedFileName: string | null
  yamlStatus: string
  workflowOptions: Array<WorkflowSummary>
  selectedWorkflowId: string
  onSelectWorkflow: (workflowId: string) => void
}

function DescribeStep({
  activeStart,
  onSelectStart,
  chatHistory,
  chatInput,
  chatPending,
  onChatInput,
  onSend,
  importRef,
  onImportChange,
  importedFileName,
  yamlStatus,
  workflowOptions,
  selectedWorkflowId,
  onSelectWorkflow,
}: DescribeStepProps) {
  const msgsEndRef = useRef<HTMLDivElement>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  const filteredWorkflowOptions = useMemo(() => {
    const normalized = pickerQuery.trim().toLowerCase()
    const sourceOptions =
      activeStart === 'Template'
        ? workflowOptions.filter((workflow) => workflow.source === 'bundled')
        : workflowOptions
    if (!normalized) return sourceOptions
    return sourceOptions.filter((workflow) => {
      const haystack = [
        workflow.name,
        workflow.id,
        workflow.description,
        workflow.source,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalized)
    })
  }, [activeStart, pickerQuery, workflowOptions])

  return (
    <div className="wz-plan">
      {/* Left rail: start-from */}
      <div className="plan-summary">
        <div className="ps-title" style={{ marginBottom: 10 }}>
          Start from…
        </div>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelectStart(label)
              }}
              style={{
                padding: '9px 11px',
                border: `1px solid ${activeStart === label ? color : 'var(--m-border-subtle, #2a2a2a)'}`,
                borderRadius: 5,
                background:
                  activeStart === label ? `${color}12` : 'var(--m-bg, #0d0d0d)',
                cursor: 'pointer',
                transition: 'border-color .15s',
              }}
            >
              <div
                style={{
                  font: `600 11px var(--m-font-mono, monospace)`,
                  color:
                    activeStart === label ? color : 'var(--m-text, #e0e0e0)',
                  marginBottom: 2,
                }}
              >
                {label}
                {label === 'Scratch' && (
                  <span
                    style={{
                      marginLeft: 5,
                      fontSize: 8,
                      letterSpacing: '.06em',
                      background: 'var(--m-green-500, #00ff41)',
                      color: '#000',
                      borderRadius: 3,
                      padding: '1px 4px',
                      verticalAlign: 'middle',
                      fontFamily: 'var(--m-font-mono, monospace)',
                    }}
                  >
                    PREVIEW
                  </span>
                )}
              </div>
              <div
                style={{
                  font: `400 10px var(--m-font-sans, sans-serif)`,
                  color: 'var(--m-text-ghost, #555)',
                }}
              >
                {desc}
              </div>
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
      </div>

      {/* Right pane: mode-specific guidance */}
      {activeStart === 'Scratch' ? (
        <div className="plan-chat">
          <div className="chat-msgs">
            {chatHistory.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                <span className="chat-who">
                  {m.role === 'assistant' ? 'Hermes' : 'You'}
                </span>
                <div className="chat-text">
                  {m.msg.split('\n').map((line, j) => (
                    <p key={j}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
            <div ref={msgsEndRef} />
          </div>
          <p style={{ fontSize: 10, color: 'var(--m-text-ghost, #666)', margin: '0 0 6px', padding: '0 2px' }}>
            Planning chat is a preview — not yet wired to an LLM.
          </p>
          <div className="chat-input-row">
            <input
              className="chat-inp"
              placeholder="Describe your workflow in plain language…"
              value={chatInput}
              disabled={chatPending}
              onChange={(e) => onChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSend()
              }}
            />
            <button
              className="btn-mini prim"
              onClick={onSend}
              disabled={chatPending}
            >
              {chatPending ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>
      ) : (
        <div className="plan-sidecard">
          <div className="plan-sidecard-head">
            {activeStart === 'Duplicate'
              ? 'Duplicate workflow'
              : activeStart === 'Template'
                ? 'Template workflow'
                : 'Imported YAML'}
          </div>
          <div className="plan-sidecard-body">
            {activeStart === 'Duplicate' && (
              <>
                <p>
                  Search and select an existing workflow, then refine the copied
                  structure in Steps 2–4.
                </p>
                <div className="wizard-combobox">
                  <input
                    className="chat-inp wizard-combobox-input"
                    placeholder="Search workflows…"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                  />
                  <div
                    className="wizard-combobox-list"
                    role="listbox"
                    aria-label="Duplicate workflow options"
                  >
                    {filteredWorkflowOptions.length > 0 ? (
                      filteredWorkflowOptions.map((workflow) => (
                        <button
                          key={workflow.id}
                          type="button"
                          className={`wizard-combobox-item ${selectedWorkflowId === workflow.id ? 'sel' : ''}`}
                          onClick={() => onSelectWorkflow(workflow.id)}
                        >
                          <span className="wizard-combobox-title">
                            {workflow.name}
                            {workflow.source === 'bundled' ? ' (built-in)' : ''}
                          </span>
                          <span className="wizard-combobox-meta">
                            {workflow.id}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="wizard-combobox-empty">
                        No workflows match your search.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
            {activeStart === 'Template' && (
              <>
                <p>
                  Pick a bundled template, then customize phases, dependencies,
                  and Hermes task hints.
                </p>
                <div className="wizard-combobox">
                  <input
                    className="chat-inp wizard-combobox-input"
                    placeholder="Search templates…"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                  />
                  <div
                    className="wizard-combobox-list"
                    role="listbox"
                    aria-label="Template workflow options"
                  >
                    {filteredWorkflowOptions.length > 0 ? (
                      filteredWorkflowOptions.map((workflow) => (
                        <button
                          key={workflow.id}
                          type="button"
                          className={`wizard-combobox-item ${selectedWorkflowId === workflow.id ? 'sel' : ''}`}
                          onClick={() => onSelectWorkflow(workflow.id)}
                        >
                          <span className="wizard-combobox-title">
                            {workflow.name}
                          </span>
                          <span className="wizard-combobox-meta">
                            {workflow.id}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="wizard-combobox-empty">
                        No templates match your search.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
            {activeStart === 'Import YAML' && (
              <>
                <p>
                  Imported YAML skips the scratch chat and goes straight to
                  review.
                </p>
                <ul>
                  <li>Status: {yamlStatus}</li>
                  <li>File: {importedFileName ?? 'Waiting for file import'}</li>
                  <li>Fix any parse issues in Step 4 if needed</li>
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 2: Design — live DAG preview ───────────────────────────────────────

/** Node type → Matrix neon color. Matches launch-wizard.tsx + workflow-editor.tsx palette. */
const NODE_COLOR: Record<string, string> = {
  prompt: '#00ff41',
  bash: '#5ad3ff',
  command: '#bf97ff',
  approval: '#ffb454',
  router: '#ff6b6b',
  loop: '#ffd700',
}

interface RawNode {
  id: string
  type: NodeType
  depends_on?: Array<string>
}

interface DagInfo {
  nodes: Array<RawNode>
  node_count: number
  depth: number
  parallelism: number
  node_type_counts: Record<string, number>
  /** Positioned nodes for SVG: cx/cy = center point */
  positioned: Array<{
    id: string
    type: string
    cx: number
    cy: number
    layer: number
  }>
  edges: Array<[string, string]>
}

interface DagError {
  error: string
}

/** Parse YAML string → DAG metrics + layout. Exported for smoke testing. */
export function parseDagFromYaml(yamlStr: string): DagInfo | DagError {
  try {
    const parsed = parseYaml(yamlStr) as Record<string, unknown>
    const rawNodes: Array<RawNode> = Array.isArray(parsed['nodes'])
      ? (parsed['nodes'] as Array<Record<string, unknown>>).map(
          (node, index) => ({
            id:
              typeof node['id'] === 'string' ? node['id'] : `node-${index + 1}`,
            type: inferNodeType(node),
            depends_on: Array.isArray(node['depends_on'])
              ? node['depends_on'].filter(
                  (dep): dep is string => typeof dep === 'string',
                )
              : [],
          }),
        )
      : []
    const node_count = rawNodes.length

    // Compute topo depth per node
    const depthMap: Record<string, number> = {}
    function nodeDepth(id: string, visited = new Set<string>()): number {
      if (id in depthMap) return depthMap[id]
      if (visited.has(id)) return 1 // cycle guard
      visited.add(id)
      const node = rawNodes.find((n) => n.id === id)
      const deps = node?.depends_on ?? []
      const d =
        deps.length === 0
          ? 1
          : 1 + Math.max(...deps.map((dep) => nodeDepth(dep, new Set(visited))))
      depthMap[id] = d
      return d
    }
    rawNodes.forEach((n) => nodeDepth(n.id))

    const depth =
      rawNodes.length === 0 ? 0 : Math.max(...Object.values(depthMap))

    // Group by layer for parallelism + layout
    const layers: Record<number, Array<RawNode>> = {}
    rawNodes.forEach((n) => {
      const d = depthMap[n.id] ?? 1
      ;(layers[d] ??= []).push(n)
    })
    const parallelism = Object.values(layers).reduce(
      (m, l) => Math.max(m, l.length),
      0,
    )

    const node_type_counts: Record<string, number> = {}
    rawNodes.forEach((n) => {
      node_type_counts[n.type] = (node_type_counts[n.type] ?? 0) + 1
    })

    // Layout: X by layer depth, Y by index within layer
    const NODE_W = 110,
      NODE_H = 34
    const LAYER_GAP = 140,
      ROW_GAP = 80,
      X_OFFSET = 60,
      Y_OFFSET = 50
    const capped = rawNodes.slice(0, 30)
    const positioned = capped.map((n) => {
      const layer = depthMap[n.id] ?? 1
      const layerNodes = layers[layer] ?? []
      const idx = layerNodes.indexOf(n)
      return {
        id: n.id,
        type: n.type,
        cx: (layer - 1) * LAYER_GAP + X_OFFSET + NODE_W / 2,
        cy: idx * ROW_GAP + Y_OFFSET,
        layer,
      }
    })

    // Edges from depends_on (capped set only)
    const cappedIds = new Set(capped.map((n) => n.id))
    const edges: Array<[string, string]> = []
    capped.forEach((n) => {
      ;(n.depends_on ?? []).forEach((dep) => {
        if (cappedIds.has(dep)) edges.push([dep, n.id])
      })
    })

    return {
      nodes: rawNodes,
      node_count,
      depth,
      parallelism,
      node_type_counts,
      positioned,
      edges,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

// ── DagSvg ───────────────────────────────────────────────────────────────────

interface DagSvgProps {
  dag: DagInfo
  extraCount: number
}

function DagSvg({ dag, extraCount }: DagSvgProps) {
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
          const c = NODE_COLOR[n.type] ?? '#00ff41'
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
        {Object.entries(NODE_COLOR).map(([t, c]) => (
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
        ))}
      </div>
    </div>
  )
}

// ── DesignStep ────────────────────────────────────────────────────────────────

interface DesignStepProps {
  yaml: string
}

function DesignStep({ yaml }: DesignStepProps) {
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
                const c = NODE_COLOR[t] ?? '#aaa'
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

      {/* Footer banner */}
      <div
        style={{
          marginTop: 6,
          font: '400 11px var(--m-font-sans)',
          color: 'var(--m-text-faint)',
          padding: '8px 12px',
          border: '1px solid rgba(0,255,65,.15)',
          borderLeft: '2px solid var(--m-green-500)',
          borderRadius: 4,
          background: 'rgba(0,255,65,.03)',
          lineHeight: 1.5,
        }}
      >
        Review the inferred structure here, then refine node types,
        dependencies, phases, and Hermes task hints in Step 3.
      </div>
    </div>
  )
}

// ── Step 3: Configure ────────────────────────────────────────────────────────

interface ConfigureStepProps {
  nodes: Array<WizardNodeDraft>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onUpdateNode: (nodeId: string, patch: Partial<WizardNodeDraft>) => void
  onUpdateHermesTask: (
    nodeId: string,
    patch: Partial<WizardHermesTaskDraft>,
  ) => void
  onAddNode: (type: NodeType) => void
  onRemoveNode: (nodeId: string) => void
}

function ConfigureStep({
  nodes,
  selectedNodeId,
  onSelectNode,
  onUpdateNode,
  onUpdateHermesTask,
  onAddNode,
  onRemoveNode,
}: ConfigureStepProps) {
  const selectedNode =
    nodes.find((node) => node.id === selectedNodeId) ??
    (nodes.length > 0 ? nodes[0] : null)

  return (
    <div className="wz-config">
      <div className="wz-config-list">
        <div className="wz-config-toolbar">
          <div>
            <div className="pc-head">Nodes</div>
            <div className="route-note">
              Edit node type, order dependencies, phase, and Hermes task hints.
            </div>
          </div>
          <div className="wz-config-add">
            {NODE_TYPE_OPTIONS.map((type) => (
              <button
                key={type}
                className="btn-mini"
                type="button"
                onClick={() => onAddNode(type)}
              >
                + {type}
              </button>
            ))}
          </div>
        </div>

        <div className="wz-config-cards">
          {nodes.map((node) => {
            const selected = selectedNode?.id === node.id
            const nodeColor =
              NODE_COLOR[node.type] ?? 'var(--m-green-500, #00ff41)'
            return (
              <button
                key={node.id}
                type="button"
                className={`wz-node-card ${selected ? 'sel' : ''}`}
                onClick={() => onSelectNode(node.id)}
              >
                <div className="wz-node-card-row">
                  <span className="wz-node-card-id">{node.id}</span>
                  <span
                    className="wz-node-card-type"
                    style={{ color: nodeColor, borderColor: `${nodeColor}55` }}
                  >
                    {node.type}
                  </span>
                </div>
                <div className="wz-node-card-meta">
                  <span>{node.phase.trim() || 'No phase'}</span>
                  <span>{node.depends_on.length} deps</span>
                  <span>
                    {node.hermes_task_enabled ? 'Hermes task' : 'Local node'}
                  </span>
                </div>
              </button>
            )
          })}
          {nodes.length === 0 && (
            <div className="wz-empty-config">
              No nodes yet. Add one from the toolbar or go back to Describe to
              scaffold a flow.
            </div>
          )}
        </div>
      </div>

      <div className="wz-config-editor">
        {selectedNode ? (
          <>
            <div className="wz-config-editor-head">
              <div>
                <div className="pc-head">Configure node</div>
                <div className="route-note">
                  Changes here regenerate the workflow YAML immediately.
                </div>
              </div>
              <button
                className="btn-mini"
                type="button"
                onClick={() => onRemoveNode(selectedNode.id)}
              >
                Remove node
              </button>
            </div>

            <div className="wz-config-grid">
              <label className="wz-field">
                <span>ID</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.id}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      id: slugify(e.target.value) || selectedNode.id,
                    })
                  }
                />
              </label>
              <label className="wz-field">
                <span>Type</span>
                <select
                  className="wfrd-select"
                  value={selectedNode.type}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      type: e.target.value as NodeType,
                    })
                  }
                >
                  {NODE_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wz-field">
                <span>Phase</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.phase}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { phase: e.target.value })
                  }
                  placeholder="Plan / Execute / Verify"
                />
              </label>
              <label className="wz-field">
                <span>Depends on</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.depends_on.join(', ')}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      depends_on: splitCsv(e.target.value),
                    })
                  }
                  placeholder="analyze, plan"
                />
              </label>
              <label className="wz-field">
                <span>Provider</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.provider}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { provider: e.target.value })
                  }
                  placeholder="claude / codex"
                />
              </label>
              <label className="wz-field">
                <span>Model</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.model}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { model: e.target.value })
                  }
                  placeholder="sonnet / gpt-5.4"
                />
              </label>
              <label className="wz-field wz-field-full">
                <span>Node skills</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.skills}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { skills: e.target.value })
                  }
                  placeholder="planning, testing"
                />
              </label>
            </div>

            {selectedNode.type === 'prompt' && (
              <label className="wz-field wz-field-full">
                <span>Prompt</span>
                <textarea
                  className="wfrd-yaml"
                  rows={8}
                  value={selectedNode.prompt}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { prompt: e.target.value })
                  }
                />
              </label>
            )}

            {selectedNode.type === 'command' && (
              <label className="wz-field wz-field-full">
                <span>Command</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.command}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { command: e.target.value })
                  }
                  placeholder="archon-smart-pr-review"
                />
              </label>
            )}

            {selectedNode.type === 'bash' && (
              <label className="wz-field wz-field-full">
                <span>Bash</span>
                <textarea
                  className="wfrd-yaml"
                  rows={8}
                  value={selectedNode.bash}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { bash: e.target.value })
                  }
                />
              </label>
            )}

            {selectedNode.type === 'script' && (
              <>
                <label className="wz-field">
                  <span>Runtime</span>
                  <select
                    className="wfrd-select"
                    value={selectedNode.runtime}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, { runtime: e.target.value })
                    }
                  >
                    <option value="bun">bun</option>
                    <option value="uv">uv</option>
                  </select>
                </label>
                <label className="wz-field wz-field-full">
                  <span>Script</span>
                  <textarea
                    className="wfrd-yaml"
                    rows={8}
                    value={selectedNode.script}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, { script: e.target.value })
                    }
                  />
                </label>
              </>
            )}

            {selectedNode.type === 'approval' && (
              <>
                <label className="wz-field wz-field-full">
                  <span>Approval message</span>
                  <textarea
                    className="wfrd-yaml"
                    rows={5}
                    value={selectedNode.approval_message}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, {
                        approval_message: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="wz-check">
                  <input
                    type="checkbox"
                    checked={selectedNode.approval_capture_response}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, {
                        approval_capture_response: e.target.checked,
                      })
                    }
                  />
                  Capture reviewer response
                </label>
              </>
            )}

            {selectedNode.type === 'loop' && (
              <>
                <label className="wz-field wz-field-full">
                  <span>Loop prompt</span>
                  <textarea
                    className="wfrd-yaml"
                    rows={6}
                    value={selectedNode.loop_prompt}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, {
                        loop_prompt: e.target.value,
                      })
                    }
                  />
                </label>
                <div className="wz-config-grid">
                  <label className="wz-field">
                    <span>Until signal</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.loop_until}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          loop_until: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="wz-field">
                    <span>Max iterations</span>
                    <input
                      className="wfrd-input"
                      type="number"
                      min={1}
                      value={selectedNode.loop_max_iterations}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          loop_max_iterations: Number(e.target.value) || 1,
                        })
                      }
                    />
                  </label>
                </div>
              </>
            )}

            {selectedNode.type === 'cancel' && (
              <label className="wz-field wz-field-full">
                <span>Cancel reason</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.cancel}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { cancel: e.target.value })
                  }
                />
              </label>
            )}

            <div className="wz-hermes-box">
              <label className="wz-check">
                <input
                  type="checkbox"
                  checked={selectedNode.hermes_task_enabled}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      hermes_task_enabled: e.target.checked,
                    })
                  }
                />
                Hermes task-backed node
              </label>

              {selectedNode.hermes_task_enabled && (
                <div className="wz-config-grid">
                  <label className="wz-field wz-field-full">
                    <span>Hermes task skills</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.hermes_task.skills}
                      onChange={(e) =>
                        onUpdateHermesTask(selectedNode.id, {
                          skills: e.target.value,
                        })
                      }
                      placeholder="testing, planning"
                    />
                  </label>
                  <label className="wz-field">
                    <span>Agent hint</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.hermes_task.agent_hint}
                      onChange={(e) =>
                        onUpdateHermesTask(selectedNode.id, {
                          agent_hint: e.target.value,
                        })
                      }
                      placeholder="trinity"
                    />
                  </label>
                  <label className="wz-field">
                    <span>Model hint</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.hermes_task.model_hint}
                      onChange={(e) =>
                        onUpdateHermesTask(selectedNode.id, {
                          model_hint: e.target.value,
                        })
                      }
                      placeholder="claude-sonnet-4"
                    />
                  </label>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="wz-empty-config">No configurable node selected.</div>
        )}
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
  yamlError: string | null
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
  id,
  name,
  description,
  source,
  yaml,
  yamlError,
  serverError,
  isPending,
  onIdChange,
  onNameChange,
  onDescriptionChange,
  onSourceChange,
  onYamlChange,
}: SaveStepProps) {
  const idValid = ID_REGEX.test(id)
  const fieldStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    marginBottom: 4,
    color: 'var(--m-text-muted, var(--text-muted, #888))',
  }

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
          <div
            style={{
              color: 'var(--text-danger, #e55)',
              fontSize: 11,
              marginTop: 3,
            }}
          >
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
        <label className="wfrd-label" style={labelStyle}>
          Description
        </label>
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
        <label className="wfrd-label" style={labelStyle}>
          Source
        </label>
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
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'monospace',
            fontSize: 12,
            resize: 'vertical',
          }}
        />
      </div>

      {yamlError && (
        <div
          style={{
            color: 'var(--text-danger, #e55)',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          YAML parse error: {yamlError}
        </div>
      )}

      {serverError && (
        <div
          style={{
            color: 'var(--text-danger, #e55)',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {serverError}
        </div>
      )}

      {isPending && (
        <div
          style={{
            color: 'var(--m-text-muted, #888)',
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          Saving…
        </div>
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

export function NewWorkflowWizard({
  initialYaml,
  initialId,
  onClose,
}: NewWorkflowWizardProps) {
  const initialDocument = toWorkflowDocumentDraft(
    initialYaml ?? YAML_TEMPLATE,
  ) ?? {
    id: '',
    name: 'My Workflow',
    description: '',
    topLevel: {},
    nodes: [toNodeDraft({ id: 'start', prompt: 'Hello' }, 0)],
  }
  const [step, setStep] = useState(1)

  // Step 1 state
  const [activeStart, setActiveStart] = useState<StartOption>(
    initialYaml ? 'Import YAML' : 'Scratch',
  )
  const [chatHistory, setChatHistory] =
    useState<Array<ChatMessage>>(NWZ_CHAT_INIT)
  const [chatInput, setChatInput] = useState('')
  const [chatPending, setChatPending] = useState(false)
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [importedFileName, setImportedFileName] = useState<string | null>(null)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')

  // Draft workflow state
  const [id, setId] = useState(initialId ?? '')
  const [name, setName] = useState(initialDocument.name || 'My Workflow')
  const [description, setDescription] = useState(initialDocument.description)
  const [source, setSource] = useState<'user' | 'project'>('project')
  const [topLevelDraft, setTopLevelDraft] = useState<Record<string, unknown>>(
    initialDocument.topLevel,
  )
  const [nodeDrafts, setNodeDrafts] = useState<Array<WizardNodeDraft>>(
    initialDocument.nodes,
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialDocument.nodes[0]?.id ?? null,
  )
  const [yaml, setYaml] = useState(
    initialYaml ??
      serializeWorkflowYaml({
        ...initialDocument,
        name: initialDocument.name || 'My Workflow',
      }),
  )
  const [serverError, setServerError] = useState<string | null>(null)

  const upsert = useUpsertWorkflowDefinition()
  // For Duplicate picker
  const { data: existingWorkflows } = useWorkflowDefinitions()

  const yamlParse = useMemo(() => parseDagFromYaml(yaml), [yaml])
  const idValid = ID_REGEX.test(id)
  const canSave =
    idValid &&
    name.trim().length > 0 &&
    yaml.trim().length > 0 &&
    !('error' in yamlParse) &&
    !upsert.isPending

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function buildDocument(
    next: {
      name?: string
      description?: string
      topLevel?: Record<string, unknown>
      nodes?: Array<WizardNodeDraft>
    } = {},
  ): WizardDocumentDraft {
    return {
      id: '',
      name: next.name ?? name,
      description: next.description ?? description,
      topLevel: next.topLevel ?? topLevelDraft,
      nodes: next.nodes ?? nodeDrafts,
    }
  }

  function syncYamlFromDocument(nextDoc: WizardDocumentDraft) {
    setYaml(serializeWorkflowYaml(nextDoc))
  }

  function applyParsedDocument(
    nextDoc: WizardDocumentDraft,
    options?: {
      wizardId?: string
      forceName?: string
      forceDescription?: string
    },
  ) {
    const nextName = options?.forceName ?? nextDoc.name
    const nextDescription = options?.forceDescription ?? nextDoc.description
    const normalizedDoc = {
      ...nextDoc,
      name: nextName || 'My Workflow',
      description: nextDescription,
    }
    setTopLevelDraft(normalizedDoc.topLevel)
    setNodeDrafts(normalizedDoc.nodes)
    setName(normalizedDoc.name)
    setDescription(normalizedDoc.description)
    if (options?.wizardId !== undefined) setId(options.wizardId)
    setSelectedNodeId((current) =>
      normalizedDoc.nodes.some((node) => node.id === current)
        ? current
        : (normalizedDoc.nodes[0]?.id ?? null),
    )
    syncYamlFromDocument(normalizedDoc)
  }

  function updateNodes(nextNodes: Array<WizardNodeDraft>) {
    setNodeDrafts(nextNodes)
    syncYamlFromDocument(buildDocument({ nodes: nextNodes }))
  }

  async function handleSend() {
    const userMsg = chatInput.trim()
    if (!userMsg || chatPending) return
    setChatHistory((h) => [...h, { role: 'user', msg: userMsg }])
    setChatInput('')
    setChatPending(true)
    try {
      const result = await chatWorkflowWizard({
        sessionId: wizardSessionId ?? undefined,
        message: userMsg,
        currentYaml: yaml,
        currentName: name,
        currentDescription: description,
        history: [...chatHistory, { role: 'user', msg: userMsg }],
      })
      setWizardSessionId(result.sessionId ?? null)
      setChatHistory((h) => [...h, { role: 'assistant', msg: result.reply }])

      const parsed = toWorkflowDocumentDraft(result.workflow_yaml)
      if (parsed) {
        applyParsedDocument(parsed, {
          wizardId:
            result.suggested_id ||
            id ||
            slugify(result.suggested_name || name || 'workflow'),
          forceName: result.suggested_name || parsed.name || name || 'Workflow',
          forceDescription:
            result.suggested_description || parsed.description || description,
        })
      } else {
        setYaml(result.workflow_yaml)
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[workflow-wizard] Hermes scratch chat failed', err)
      }
      const fallbackDoc = buildWorkflowFromPrompt(
        userMsg,
        name || 'My Workflow',
      )
      applyParsedDocument(fallbackDoc, {
        wizardId: id || slugify(fallbackDoc.name || userMsg || 'workflow'),
        forceName: fallbackDoc.name || name || 'Workflow',
        forceDescription: fallbackDoc.description || description,
      })
      setChatHistory((h) => [
        ...h,
        {
          role: 'assistant',
          msg: 'I could not reach the live Hermes chat service for this turn, so I created a local workflow draft from your message. Review the DAG in Step 2, refine nodes in Step 3, or tell me more about the trigger, steps, and expected output.',
        },
      ])
    } finally {
      setChatPending(false)
    }
  }

  function handleImportChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((text) => {
      const parsed = toWorkflowDocumentDraft(text)
      if (parsed) {
        applyParsedDocument(parsed, {
          wizardId: id || slugify(file.name),
          forceName: parsed.name || name || file.name.replace(/\.ya?ml$/i, ''),
          forceDescription: parsed.description || description,
        })
      } else {
        setYaml(text)
      }
      setImportedFileName(file.name)
      if (!id) setId(slugify(file.name))
      if (!name) setName(file.name.replace(/\.ya?ml$/i, ''))
    })
    e.target.value = ''
  }

  const yamlStatus =
    yaml.trim().length === 0
      ? 'No YAML loaded yet'
      : 'error' in yamlParse
        ? `Parse error — ${yamlParse.error}`
        : `Valid YAML — ${'node_count' in yamlParse ? yamlParse.node_count : 0} nodes detected`

  function handleDuplicateSelect(wfId: string) {
    const wf = existingWorkflows?.find((w) => w.id === wfId)
    if (!wf) return
    setSelectedWorkflowId(wfId)
    const parsed = toWorkflowDocumentDraft(wf.yaml || YAML_TEMPLATE)
    if (parsed) {
      applyParsedDocument(parsed, {
        wizardId: slugify(wf.id + '-copy'),
        forceName: `${wf.name} (copy)`,
        forceDescription: wf.description || parsed.description,
      })
    } else {
      setYaml(wf.yaml || YAML_TEMPLATE)
      setName(wf.name + ' (copy)')
      setDescription(wf.description || '')
      setId(slugify(wf.id + '-copy'))
    }
  }

  function handleYamlChange(nextYaml: string) {
    setYaml(nextYaml)
    const parsed = toWorkflowDocumentDraft(nextYaml)
    if (!parsed) return
    setTopLevelDraft(parsed.topLevel)
    setNodeDrafts(parsed.nodes)
    if (parsed.name) setName(parsed.name)
    setDescription(parsed.description)
    setSelectedNodeId((current) =>
      parsed.nodes.some((node) => node.id === current)
        ? current
        : (parsed.nodes[0]?.id ?? null),
    )
  }

  function handleUpdateNode(nodeId: string, patch: Partial<WizardNodeDraft>) {
    const nextNodes = nodeDrafts.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node,
    )
    if (patch.id && selectedNodeId === nodeId) setSelectedNodeId(patch.id)
    updateNodes(nextNodes)
  }

  function handleUpdateHermesTask(
    nodeId: string,
    patch: Partial<WizardHermesTaskDraft>,
  ) {
    const nextNodes = nodeDrafts.map((node) =>
      node.id === nodeId
        ? { ...node, hermes_task: { ...node.hermes_task, ...patch } }
        : node,
    )
    updateNodes(nextNodes)
  }

  function handleAddNode(type: NodeType) {
    const draft = createDefaultNodeDraft(type, nodeDrafts.length)
    if (nodeDrafts.length > 0) {
      draft.depends_on = [nodeDrafts[nodeDrafts.length - 1]?.id].filter(Boolean)
    }
    const nextNodes = [...nodeDrafts, draft]
    setSelectedNodeId(draft.id)
    updateNodes(nextNodes)
  }

  function handleRemoveNode(nodeId: string) {
    const nextNodes = nodeDrafts
      .filter((node) => node.id !== nodeId)
      .map((node) => ({
        ...node,
        depends_on: node.depends_on.filter((dep) => dep !== nodeId),
      }))
    setSelectedNodeId(nextNodes[0]?.id ?? null)
    updateNodes(nextNodes)
  }

  async function handleSave() {
    setServerError(null)
    try {
      await upsert.mutateAsync({
        id,
        name: name.trim(),
        description: description.trim() || undefined,
        source,
        yaml,
      })
      onClose()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const currentStepLabel = STEPS[step - 1] ?? 'DESCRIBE'

  return (
    <div
      className="wizard-scrim"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
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
        <div
          className="wz-head"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--m-border, #2a2a2a)',
            flexShrink: 0,
          }}
        >
          <div
            className="wz-icon"
            style={{
              width: 34,
              height: 34,
              borderRadius: 7,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,255,65,.08)',
              border: '1px solid var(--m-green-500, #00ff41)',
              color: 'var(--m-green-500, #00ff41)',
              boxShadow: '0 0 10px rgba(0,255,65,.3)',
              flexShrink: 0,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="16"
              height="16"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--m-text, #e0e0e0)',
                letterSpacing: '.02em',
              }}
            >
              New Workflow
            </h2>
            <div
              className="wz-sub"
              style={{
                fontSize: 10,
                color: 'var(--m-text-muted, #888)',
                marginTop: 2,
                fontFamily: 'var(--m-font-mono, monospace)',
                textTransform: 'uppercase',
                letterSpacing: '.1em',
              }}
            >
              CREATE A WORKFLOW DEFINITION · STEP {step} OF 4 —{' '}
              {currentStepLabel}
            </div>
          </div>
          <button
            className="wz-close"
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--m-text-muted, #888)',
              padding: 4,
              lineHeight: 1,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              width="16"
              height="16"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Step bar ── */}
        <StepBar step={step} />

        {/* ── Body ── */}
        <div
          className="wz-body"
          style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}
        >
          {step === 1 && (
            <DescribeStep
              activeStart={activeStart}
              onSelectStart={setActiveStart}
              chatHistory={chatHistory}
              chatInput={chatInput}
              chatPending={chatPending}
              onChatInput={setChatInput}
              onSend={handleSend}
              importRef={importRef}
              onImportChange={handleImportChange}
              importedFileName={importedFileName}
              yamlStatus={yamlStatus}
              workflowOptions={existingWorkflows ?? []}
              selectedWorkflowId={selectedWorkflowId}
              onSelectWorkflow={handleDuplicateSelect}
            />
          )}

          {step === 2 && <DesignStep yaml={yaml} />}

          {step === 3 && (
            <ConfigureStep
              nodes={nodeDrafts}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onUpdateNode={handleUpdateNode}
              onUpdateHermesTask={handleUpdateHermesTask}
              onAddNode={handleAddNode}
              onRemoveNode={handleRemoveNode}
            />
          )}

          {step === 4 && (
            <SaveStep
              id={id}
              name={name}
              description={description}
              source={source}
              yaml={yaml}
              yamlError={'error' in yamlParse ? yamlParse.error : null}
              serverError={serverError}
              isPending={upsert.isPending}
              onIdChange={setId}
              onNameChange={(nextName) => {
                setName(nextName)
                syncYamlFromDocument(buildDocument({ name: nextName }))
              }}
              onDescriptionChange={(nextDescription) => {
                setDescription(nextDescription)
                syncYamlFromDocument(
                  buildDocument({ description: nextDescription }),
                )
              }}
              onSourceChange={setSource}
              onYamlChange={handleYamlChange}
              onSubmit={() => {
                void handleSave()
              }}
            />
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="wz-foot"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: '1px solid var(--m-border, #2a2a2a)',
            flexShrink: 0,
          }}
        >
          <span
            className="wz-foot-step"
            style={{
              font: '500 10px var(--m-font-mono, monospace)',
              color: 'var(--m-text-faint, #444)',
              textTransform: 'uppercase',
              letterSpacing: '.14em',
            }}
          >
            Step {step} / 4
          </span>
          <div className="wz-nav" style={{ display: 'flex', gap: 8 }}>
            {step > 1 && (
              <button
                className="btn-mini"
                type="button"
                onClick={() => setStep((s) => s - 1)}
              >
                ← Back
              </button>
            )}
            {step < 4 && (
              <button
                className="btn-mini prim"
                type="button"
                onClick={() => setStep((s) => s + 1)}
              >
                Next →
              </button>
            )}
            {step === 4 && (
              <button
                className="btn-mini prim"
                type="button"
                style={{ minWidth: 130 }}
                disabled={!canSave}
                onClick={() => {
                  void handleSave()
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  width="11"
                  height="11"
                  style={{ marginRight: 5 }}
                >
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
        .plan-sidecard {
          border: 1px solid var(--m-border-subtle, #222);
          border-radius: 6px;
          background: var(--m-bg-deep, #0a0a0a);
          overflow: hidden;
        }
        .plan-sidecard-head {
          padding: 12px 14px;
          border-bottom: 1px solid var(--m-border-subtle, #222);
          font: 600 11px var(--m-font-mono, monospace);
          color: var(--m-green-500, #00ff41);
          text-transform: uppercase;
          letter-spacing: .1em;
        }
        .plan-sidecard-body {
          padding: 14px;
          font: 400 12px var(--m-font-sans, sans-serif);
          color: var(--m-text, #e0e0e0);
          line-height: 1.6;
        }
        .plan-sidecard-body p {
          margin: 0 0 10px;
        }
        .plan-sidecard-body ul {
          margin: 0;
          padding-left: 18px;
          color: var(--m-text-muted, #888);
        }
        .plan-sidecard-body li + li {
          margin-top: 6px;
        }
        .wizard-combobox {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .wizard-combobox-input {
          width: 100%;
          box-sizing: border-box;
        }
        .wizard-combobox-list {
          max-height: 220px;
          overflow-y: auto;
          border: 1px solid var(--m-border-subtle, #222);
          border-radius: 6px;
          background: var(--m-bg, #0d0d0d);
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .wizard-combobox-item {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
          width: 100%;
          padding: 8px 10px;
          border-radius: 5px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--m-text, #e0e0e0);
          text-align: left;
          cursor: pointer;
        }
        .wizard-combobox-item:hover,
        .wizard-combobox-item.sel {
          border-color: rgba(0,255,65,.3);
          background: rgba(0,255,65,.08);
        }
        .wizard-combobox-title {
          font: 600 11px var(--m-font-mono, monospace);
          color: var(--m-text, #e0e0e0);
        }
        .wizard-combobox-meta {
          font: 400 10px var(--m-font-sans, sans-serif);
          color: var(--m-text-muted, #888);
        }
        .wizard-combobox-empty {
          padding: 10px;
          color: var(--m-text-muted, #888);
          font: 400 11px var(--m-font-sans, sans-serif);
        }

        /* Configure step */
        .wz-config {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 14px;
          min-height: 420px;
        }
        .wz-config-list,
        .wz-config-editor {
          border: 1px solid var(--m-border-subtle, #222);
          border-radius: 8px;
          background: var(--m-bg-deep, #0a0a0a);
        }
        .wz-config-list {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .wz-config-editor {
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .wz-config-toolbar,
        .wz-config-editor-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }
        .wz-config-add {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 6px;
        }
        .wz-config-cards {
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow-y: auto;
        }
        .wz-node-card {
          width: 100%;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid var(--m-border-subtle, #222);
          background: var(--m-bg, #0d0d0d);
          color: var(--m-text, #e0e0e0);
          cursor: pointer;
          text-align: left;
        }
        .wz-node-card.sel {
          border-color: var(--m-green-500, #00ff41);
          box-shadow: 0 0 0 1px rgba(0,255,65,.15);
        }
        .wz-node-card-row,
        .wz-node-card-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .wz-node-card-id {
          font: 600 10px var(--m-font-mono, monospace);
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .wz-node-card-type {
          border: 1px solid currentColor;
          border-radius: 999px;
          padding: 2px 8px;
          font: 600 9px var(--m-font-mono, monospace);
          text-transform: uppercase;
          letter-spacing: .08em;
        }
        .wz-node-card-meta {
          margin-top: 8px;
          font: 400 10px var(--m-font-sans, sans-serif);
          color: var(--m-text-muted, #888);
        }
        .wz-config-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .wz-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
          font: 500 11px var(--m-font-mono, monospace);
          color: var(--m-text-muted, #888);
        }
        .wz-field-full {
          grid-column: 1 / -1;
        }
        .wz-check {
          display: flex;
          align-items: center;
          gap: 8px;
          font: 500 11px var(--m-font-sans, sans-serif);
          color: var(--m-text, #e0e0e0);
        }
        .wz-hermes-box {
          border-top: 1px solid var(--m-border-subtle, #222);
          padding-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .wz-empty-config {
          border: 1px dashed var(--m-border-subtle, #222);
          border-radius: 8px;
          padding: 18px;
          color: var(--m-text-ghost, #555);
          font: 400 12px var(--m-font-sans, sans-serif);
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
