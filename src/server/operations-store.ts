/**
 * operations-store.ts — Live projections of the Operations UI from
 * Hermes gateway sessions and the workflow-engine node_runs store.
 *
 * No seeded mocks. If the gateway is offline or the workflow engine is
 * unavailable, projections return empty arrays / zeroed state. Callers
 * never see a thrown error from listAgents()/listOutputs()/getState().
 *
 * Field mapping (Agent):
 *   id          ← node_run.id OR session.id
 *   name        ← node_run.assigned_agent / node.dag_node_id OR session.title/id
 *   initials    ← first 2 chars of name uppercased
 *   role        ← 'orchestrator' for fanout/router node_types, else 'worker'
 *   status      ← live | idle | blocked | error  (mapped from node_run.status / session.is_active)
 *   task        ← node_run.summary / dag_node_id  OR  session preview/title
 *   capacityPct ← null today (gateway does not expose). UI displays 0.
 *   tokens      ← session.input+output_tokens when present, else null
 *   lastSeen    ← humanised heartbeat / last_active
 *
 * Outputs are projected from the latest completed node_runs that carry
 * `artifact_refs`. Falls back to the most recent completed node_runs
 * with a non-null `summary`.
 */

import type { ClaudeSession } from './hermes-api'

// ---------------------------------------------------------------------------
// Types — kept stable so UI components don't need to change shape.
// ---------------------------------------------------------------------------

export type AgentStatus = 'live' | 'idle' | 'blocked' | 'error'
export type AgentRole = 'orchestrator' | 'worker'

export interface Agent {
  id: string
  initials: string
  name: string
  role: AgentRole
  status: AgentStatus
  task: string
  capacityPct: number
  capacityVariant?: 'warn' | 'err'
  tokens: string | null
  lastSeen: string
}

export interface FocusMission {
  traceId: string
  startedAt: string
  prompt: string
  stages: Array<{ label: string; state: 'done' | 'now' | 'pending' }>
  elapsed: string
}

export interface ActivityItem {
  time: string
  tag?: 'tool' | 'handoff'
  text: string
  done?: boolean
}

export interface ToolItem {
  ico: string
  name: string
  count: number
}

export interface OutputItem {
  type: 'file' | 'artifact' | 'data'
  name: string
  meta: string
  time: string
}

export interface FocusData {
  id: string
  initials: string
  name: string
  role: string
  status: AgentStatus
  workerCount: number
  model: string
  profile: string
  toolCount: number
  mission: FocusMission
  activity: Array<ActivityItem>
  tools: Array<ToolItem>
  outputs: Array<OutputItem>
}

export type OutputType = 'code' | 'docs' | 'data' | 'media'

export interface TeamOutput {
  id: string
  agent: string
  typeLabel: string
  type: OutputType
  name: string
  preview: string
  time: string
  size: string
}

export interface OperationsState {
  live: number
  total: number
  tokenRate: string
  queue: number
  errors24h: number
  spark: Array<number>
}

export interface Dispatch {
  id: string
  prompt: string
  mode: string
  priority: string
  budget: string
  deadline: string
  tags: Array<string>
  createdAt: number
}

export const EMPTY_STATE: OperationsState = {
  live: 0,
  total: 0,
  tokenRate: '0',
  queue: 0,
  errors24h: 0,
  spark: [],
}

// ---------------------------------------------------------------------------
// Source readers (injectable so the test suite can stub them out).
// ---------------------------------------------------------------------------

export interface SourceReaders {
  /** List active/recent sessions from the Hermes gateway. */
  listSessions: () => Promise<Array<ClaudeSession>>
  /** List recent node_runs from the workflow engine. */
  listNodeRuns: () => Promise<Array<NodeRunRow>>
}

/** Minimal shape we need from a workflow-engine node_run row. */
export interface NodeRunRow {
  id: string
  workflow_run_id: string
  dag_node_id: string
  node_type: string
  status:
    | 'pending'
    | 'ready'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'skipped'
  assigned_agent: string | null
  summary: string | null
  error: string | null
  started_at: number | null
  completed_at: number | null
  artifact_refs:
    | string
    | Array<{ type?: string; label?: string; url?: string; path?: string }>
    | null
}

async function defaultListSessions(): Promise<Array<ClaudeSession>> {
  try {
    const { listSessions } = await import('./hermes-api')
    return await listSessions(50, 0)
  } catch {
    return []
  }
}

async function defaultListNodeRuns(): Promise<Array<NodeRunRow>> {
  try {
    const { getWorkflowEngine } = await import('./workflow-engine')
    const engine = await getWorkflowEngine()
    // The store exposes a per-run lister; we widen here by enumerating runs.
    const runs = engine.store.listWorkflowRuns({ limit: 50 }) as Array<{
      id: string
    }>
    const all: Array<NodeRunRow> = []
    for (const r of runs) {
      const rows = engine.store.listNodeRuns(r.id) as Array<NodeRunRow>
      for (const row of rows) all.push(row)
    }
    return all
  } catch {
    return []
  }
}

let _readers: SourceReaders = {
  listSessions: defaultListSessions,
  listNodeRuns: defaultListNodeRuns,
}

/** Replace the readers — used by tests. */
export function __setOperationsReaders(readers: Partial<SourceReaders>): void {
  _readers = { ..._readers, ...readers }
}

/** Restore the production readers (default gateway + workflow-engine). */
export function __resetOperationsReaders(): void {
  _readers = {
    listSessions: defaultListSessions,
    listNodeRuns: defaultListNodeRuns,
  }
}

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

function makeInitials(name: string): string {
  const clean = (name || '').trim()
  if (clean.length === 0) return '··'
  const parts = clean.split(/\s+/)
  if (parts.length > 1 && parts[0].length > 0 && parts[1].length > 0) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase()
}

const ORCHESTRATOR_NODE_TYPES = new Set([
  'fanout',
  'router',
  'router_decision',
  'orchestrator',
  'plan',
  'subgraph',
])

function nodeRoleFor(nodeType: string): AgentRole {
  return ORCHESTRATOR_NODE_TYPES.has(nodeType.toLowerCase()) ? 'orchestrator' : 'worker'
}

function nodeStatusToAgent(
  s: NodeRunRow['status'],
): AgentStatus {
  switch (s) {
    case 'running':
      return 'live'
    case 'paused':
      return 'blocked'
    case 'failed':
      return 'error'
    case 'pending':
    case 'ready':
      return 'idle'
    default:
      return 'idle'
  }
}

function sessionStatus(session: ClaudeSession): AgentStatus {
  if (session.end_reason === 'error') return 'error'
  const active =
    session.is_active === true ||
    (!!session.last_active &&
      !session.ended_at &&
      Date.now() - (session.last_active ?? 0) * 1000 < 5 * 60 * 1000)
  return active ? 'live' : 'idle'
}

function humaniseAgo(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 5) return 'now'
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

function formatHhmm(ms: number | null | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function compactTokens(n: number | null | undefined): string | null {
  if (n == null || n <= 0) return null
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function parseArtifactRefs(
  raw: NodeRunRow['artifact_refs'],
): Array<{ type?: string; label?: string; url?: string; path?: string }> {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw) as Array<{
      type?: string
      label?: string
      url?: string
      path?: string
    }>
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function outputTypeFor(name: string, hintedType?: string): OutputType {
  const t = (hintedType ?? '').toLowerCase()
  if (t === 'code' || t === 'docs' || t === 'data' || t === 'media') return t
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp'].includes(ext)) return 'code'
  if (['md', 'mdx', 'txt', 'rst', 'draft'].includes(ext)) return 'docs'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'media'
  return 'data'
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function nodeRunToAgent(row: NodeRunRow): Agent {
  const name = row.assigned_agent ?? row.dag_node_id ?? row.id
  const status = nodeStatusToAgent(row.status)
  const lastTs = row.completed_at ?? row.started_at ?? null
  const task = row.summary ?? row.dag_node_id ?? ''
  return {
    id: row.id,
    initials: makeInitials(name),
    name,
    role: nodeRoleFor(row.node_type),
    status,
    task,
    capacityPct: 0,
    capacityVariant: status === 'error' ? 'err' : status === 'blocked' ? 'warn' : undefined,
    tokens: null,
    lastSeen: lastTs ? humaniseAgo(Date.now() - lastTs) : '—',
  }
}

function sessionToAgent(session: ClaudeSession): Agent {
  const name = session.title?.trim() || session.id
  const status = sessionStatus(session)
  const tokens = compactTokens(
    (session.input_tokens ?? 0) + (session.output_tokens ?? 0),
  )
  const lastSec = session.last_active ?? session.started_at ?? null
  return {
    id: session.id,
    initials: makeInitials(name),
    name,
    role: 'worker',
    status,
    task: session.preview?.trim() || session.title?.trim() || 'session active',
    capacityPct: 0,
    capacityVariant: status === 'error' ? 'err' : undefined,
    tokens,
    lastSeen: lastSec ? humaniseAgo(Date.now() - lastSec * 1000) : '—',
  }
}

/**
 * List agents = active node_runs UNION live sessions.
 * Node runs whose status is terminal (completed/cancelled/skipped) are excluded.
 */
export async function listAgents(): Promise<Array<Agent>> {
  const [sessions, nodeRuns] = await Promise.all([
    safe(_readers.listSessions),
    safe(_readers.listNodeRuns),
  ])

  const active = nodeRuns.filter(
    (n) => n.status !== 'completed' && n.status !== 'cancelled' && n.status !== 'skipped',
  )
  const nodeAgents = active.map(nodeRunToAgent)
  const seenIds = new Set(nodeAgents.map((a) => a.id))

  const sessionAgents = sessions
    .filter((s) => !seenIds.has(s.id))
    .map(sessionToAgent)

  return [...nodeAgents, ...sessionAgents]
}

/**
 * Get the focus view for a single agent.
 * Tries node_runs first (richer activity), then falls back to gateway session.
 */
export async function getAgent(id: string): Promise<FocusData | null> {
  const [sessions, nodeRuns] = await Promise.all([
    safe(_readers.listSessions),
    safe(_readers.listNodeRuns),
  ])

  const node = nodeRuns.find((n) => n.id === id)
  if (node) {
    return nodeRunToFocusData(node, nodeRuns)
  }

  const session = sessions.find((s) => s.id === id)
  if (session) {
    return sessionToFocusData(session)
  }
  return null
}

function nodeRunToFocusData(row: NodeRunRow, all: Array<NodeRunRow>): FocusData {
  const agent = nodeRunToAgent(row)
  // Sibling rows in the same workflow_run feed the activity feed.
  const siblings = all
    .filter((n) => n.workflow_run_id === row.workflow_run_id)
    .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))

  const activity: Array<ActivityItem> = siblings.slice(0, 12).map((n) => ({
    time: formatHhmm(n.started_at),
    tag: n.assigned_agent && n.id !== row.id ? 'handoff' : 'tool',
    text:
      n.summary ?? `${n.node_type} · ${n.assigned_agent ?? n.dag_node_id} · ${n.status}`,
    done: n.status === 'completed',
  }))

  const outputs: Array<OutputItem> = siblings
    .flatMap((n) => parseArtifactRefs(n.artifact_refs).map((ref) => ({ n, ref })))
    .slice(0, 8)
    .map(({ n, ref }) => ({
      type:
        ref.type === 'file' || ref.type === 'artifact' || ref.type === 'data'
          ? (ref.type as OutputItem['type'])
          : 'artifact',
      name: ref.label ?? ref.path ?? ref.url ?? 'artifact',
      meta: `${n.assigned_agent ?? n.dag_node_id} · ${ref.url ?? ref.path ?? ''}`.trim(),
      time: formatHhmm(n.completed_at ?? n.started_at),
    }))

  return {
    id: agent.id,
    initials: agent.initials,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    workerCount: siblings.length,
    model: 'unknown',
    profile: 'default',
    toolCount: 0,
    mission: {
      traceId: row.workflow_run_id,
      startedAt: formatHhmm(row.started_at),
      prompt: row.summary ?? row.dag_node_id,
      stages: [
        { label: 'plan', state: row.status === 'pending' ? 'now' : 'done' },
        { label: 'route', state: row.status === 'ready' ? 'now' : 'pending' },
        { label: 'execute', state: row.status === 'running' ? 'now' : 'pending' },
        { label: 'review', state: 'pending' },
        { label: 'report', state: row.status === 'completed' ? 'done' : 'pending' },
      ],
      elapsed: row.started_at ? humaniseAgo(Date.now() - row.started_at) : '—',
    },
    activity,
    tools: [],
    outputs,
  }
}

function sessionToFocusData(session: ClaudeSession): FocusData {
  const agent = sessionToAgent(session)
  return {
    id: agent.id,
    initials: agent.initials,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    workerCount: 0,
    model: session.model ?? 'unknown',
    profile: 'default',
    toolCount: session.tool_call_count ?? 0,
    mission: {
      traceId: session.id,
      startedAt: session.started_at ? formatHhmm(session.started_at * 1000) : '—',
      prompt: session.preview ?? session.title ?? '',
      stages: [
        { label: 'plan', state: 'done' },
        { label: 'route', state: 'done' },
        { label: 'execute', state: agent.status === 'live' ? 'now' : 'pending' },
        { label: 'review', state: 'pending' },
        { label: 'report', state: session.ended_at ? 'done' : 'pending' },
      ],
      elapsed: session.started_at
        ? humaniseAgo(Date.now() - session.started_at * 1000)
        : '—',
    },
    activity: [],
    tools: [],
    outputs: [],
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export async function listOutputs(): Promise<Array<TeamOutput>> {
  const nodeRuns = await safe(_readers.listNodeRuns)
  const completed = nodeRuns
    .filter((n) => n.status === 'completed')
    .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0))

  const out: Array<TeamOutput> = []
  for (const n of completed) {
    const refs = parseArtifactRefs(n.artifact_refs)
    if (refs.length > 0) {
      for (const ref of refs) {
        const name = ref.label ?? ref.path ?? ref.url ?? 'artifact'
        const type = outputTypeFor(name, ref.type)
        out.push({
          id: `${n.id}:${name}`,
          agent: n.assigned_agent ?? n.dag_node_id,
          typeLabel: ref.type ?? type,
          type,
          name,
          preview: n.summary ?? '',
          time: formatHhmm(n.completed_at),
          size: '—',
        })
      }
    } else if (n.summary) {
      out.push({
        id: n.id,
        agent: n.assigned_agent ?? n.dag_node_id,
        typeLabel: 'summary',
        type: 'docs',
        name: `${n.dag_node_id}.summary`,
        preview: n.summary,
        time: formatHhmm(n.completed_at),
        size: `${n.summary.length} ch`,
      })
    }
    if (out.length >= 20) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Aggregate state
// ---------------------------------------------------------------------------

export async function getState(): Promise<OperationsState> {
  const agents = await listAgents()
  const sessions = await safe(_readers.listSessions)
  const live = agents.filter((a) => a.status === 'live').length
  const errors24h = agents.filter((a) => a.status === 'error').length
  const queue = agents.filter((a) => a.status === 'idle').length
  const tokens = sessions.reduce(
    (acc, s) => acc + (s.input_tokens ?? 0) + (s.output_tokens ?? 0),
    0,
  )
  return {
    live,
    total: agents.length,
    tokenRate: compactTokens(tokens) ?? '0',
    queue,
    errors24h,
    spark: [],
  }
}

// ---------------------------------------------------------------------------
// Mutations — pause/resume/dispatch/createAgent
//
// pause / resume map to gateway capabilities. Today the Hermes gateway has no
// generic "pause session" endpoint, so both calls return { available: false }
// with HTTP 501 from the route handler. The store throws a sentinel so the
// route can convert.
// ---------------------------------------------------------------------------

export class CapabilityUnavailableError extends Error {
  constructor(capability: string) {
    super(`Capability '${capability}' not available on this gateway`)
    this.name = 'CapabilityUnavailableError'
  }
}

export async function pauseAgent(_id: string): Promise<never> {
  throw new CapabilityUnavailableError('session-pause')
}

export async function resumeAgent(_id: string): Promise<never> {
  throw new CapabilityUnavailableError('session-resume')
}

export async function createAgent(input: {
  name: string
  role: AgentRole
  task: string
}): Promise<Agent> {
  // Spawning a long-lived agent isn't yet exposed by the gateway; we surface
  // a placeholder Agent so the UI can optimistically render until a proper
  // gateway endpoint lands. No persistent state is created.
  const initials = makeInitials(input.name)
  return {
    id: `pending-${Date.now().toString(36)}`,
    initials,
    name: input.name,
    role: input.role,
    status: 'idle',
    task: input.task || 'idle · awaiting dispatch',
    capacityPct: 0,
    tokens: null,
    lastSeen: 'now',
  }
}

export async function createDispatch(input: {
  prompt: string
  mode?: string
  priority?: string
  budget?: string
  deadline?: string
  tags?: Array<string>
}): Promise<Dispatch> {
  // Best-effort: ask the gateway to create a session and post the prompt.
  // Any failure here just surfaces the dispatch record locally with a
  // synthetic id; the route handler reports {ok:true} either way.
  let id = `d_${Math.random().toString(36).slice(2, 10)}`
  try {
    const { createSession, sendChat } = await import('./hermes-api')
    const session = await createSession({ title: input.prompt.slice(0, 60) })
    await sendChat(session.id, input.prompt)
    id = session.id
  } catch {
    // gateway offline — return synthetic id so the UI doesn't error out.
  }
  return {
    id,
    prompt: input.prompt,
    mode: input.mode ?? 'auto',
    priority: input.priority ?? 'normal',
    budget: input.budget ?? '25k tok',
    deadline: input.deadline ?? '30m',
    tags: input.tags ?? [],
    createdAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function safe<T>(fn: () => Promise<Array<T>>): Promise<Array<T>> {
  try {
    return await fn()
  } catch {
    return []
  }
}
