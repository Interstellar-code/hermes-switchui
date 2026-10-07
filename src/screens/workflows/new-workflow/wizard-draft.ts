import {
  isMap,
  parseDocument,
  parse as parseYaml,
  stringify as stringifyYaml,
} from 'yaml'
import { inferNodeType } from './parse-dag'
import type { NodeType } from '../types'

export const YAML_TEMPLATE = `name: My Workflow
description: New workflow
nodes:
  - id: start
    prompt: "Hello"
`

export function slugify(raw: string): string {
  return raw
    .replace(/\.ya?ml$/i, '')
    .replace(/[^A-Za-z0-9_:.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
}

export function splitCsv(raw: string): Array<string> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export interface WizardHermesTaskDraft {
  skills: string
  agent_hint: string
  model_hint: string
}

export interface WizardNodeDraft {
  id: string
  type: NodeType
  phase: string
  depends_on: Array<string>
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

export interface WizardDocumentDraft {
  id: string
  name: string
  description: string
  topLevel: Record<string, unknown>
  nodes: Array<WizardNodeDraft>
}

export const NODE_TYPE_OPTIONS: Array<NodeType> = [
  'prompt',
  'command',
  'bash',
  'script',
  'approval',
  'loop',
  'cancel',
]

export const TOP_LEVEL_RESERVED_KEYS = new Set([
  'id',
  'name',
  'description',
  'nodes',
])
export const COMMON_NODE_KEYS = [
  'id',
  'phase',
  'depends_on',
  'model',
  'provider',
  'skills',
  'hermes_task',
]
export const VARIANT_NODE_KEYS = [
  'prompt',
  'command',
  'bash',
  'script',
  'runtime',
  'cancel',
  'approval',
  'loop',
]

export function createDefaultNodeDraft(
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

export function toNodeDraft(
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

export function toWorkflowDocumentDraft(
  yamlStr: string,
): WizardDocumentDraft | null {
  let parsed: unknown
  try {
    parsed = parseYaml(yamlStr)
  } catch {
    return null
  }
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

export function serializeNodeDraft(
  node: WizardNodeDraft,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...node.raw }
  for (const key of [...COMMON_NODE_KEYS, ...VARIANT_NODE_KEYS]) {
    delete next[key]
  }

  next.id = node.id.trim()
  if (node.phase.trim()) next.phase = node.phase.trim()
  if (node.depends_on.length > 0) next.depends_on = node.depends_on

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

export function serializeWorkflowYaml(doc: WizardDocumentDraft): string {
  const root: Record<string, unknown> = { ...doc.topLevel }
  root.name = doc.name.trim() || 'Workflow'
  root.description = doc.description.trim() || 'New workflow'
  root.nodes = doc.nodes.map((node) => serializeNodeDraft(node))
  return stringifyYaml(root, { lineWidth: 0 })
}

/**
 * Set top-level `name:` / `description:` in place (comments, key order and
 * unknown keys survive). Blank values get the same defaults as
 * serializeWorkflowYaml. Unparseable yaml is returned unchanged.
 */
export function setWorkflowField(
  yaml: string,
  key: 'name' | 'description',
  value: string,
): string {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0 || !isMap(doc.contents)) return yaml
  const fallback = key === 'name' ? 'Workflow' : 'New workflow'
  doc.set(key, value.trim() || fallback)
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

export function buildWorkflowFromPrompt(
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
