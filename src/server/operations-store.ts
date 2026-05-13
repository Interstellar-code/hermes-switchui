/**
 * operations-store.ts — File-backed operations registry.
 * Data stored at ~/.hermes/operations/
 *   agents/<id>.json
 *   outputs/<id>.json
 *   state.json
 *   dispatches/<id>.json
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
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
  status: 'live' | 'idle' | 'blocked' | 'error'
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

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function opsDir(): string {
  return join(homedir(), '.hermes', 'operations')
}
function agentsDir(): string {
  return join(opsDir(), 'agents')
}
function outputsDir(): string {
  return join(opsDir(), 'outputs')
}
function dispatchesDir(): string {
  return join(opsDir(), 'dispatches')
}
function statePath(): string {
  return join(opsDir(), 'state.json')
}

async function ensureDirs(): Promise<void> {
  await Promise.all([
    mkdir(agentsDir(), { recursive: true }),
    mkdir(outputsDir(), { recursive: true }),
    mkdir(dispatchesDir(), { recursive: true }),
  ])
}

// ---------------------------------------------------------------------------
// Seed data (mirrors mock-data.ts values)
// ---------------------------------------------------------------------------

const SEED_AGENTS: Array<Agent> = [
  { id: 'sage', initials: 'SG', name: 'sage', role: 'orchestrator', status: 'live', task: 'routing · planning q4 portfolio rebalance', capacityPct: 64, tokens: '2.4k', lastSeen: 'now' },
  { id: 'neo', initials: 'NE', name: 'neo', role: 'worker', status: 'live', task: 'scanning issue tracker · 14 PRs queued', capacityPct: 82, tokens: '1.1k', lastSeen: '4s' },
  { id: 'workspace', initials: 'WS', name: 'workspace', role: 'worker', status: 'live', task: 'indexing /Users/rohits/.hermes', capacityPct: 38, tokens: '820', lastSeen: '1m' },
  { id: 'pixel', initials: 'PX', name: 'pixel', role: 'worker', status: 'live', task: 'rendering preview frames · 12/24', capacityPct: 50, tokens: '680', lastSeen: 'now' },
  { id: 'echo', initials: 'EC', name: 'echo', role: 'worker', status: 'live', task: 'summarising standup notes', capacityPct: 24, tokens: '410', lastSeen: '3s' },
  { id: 'drift', initials: 'DR', name: 'drift', role: 'worker', status: 'blocked', task: 'awaiting review · PR #318', capacityPct: 100, capacityVariant: 'warn', tokens: null, lastSeen: '2m' },
  { id: 'blaze', initials: 'BL', name: 'blaze', role: 'worker', status: 'live', task: 'market signals · BTC/ETH/SOL', capacityPct: 70, tokens: '3.2k', lastSeen: 'now' },
  { id: 'nova', initials: 'NV', name: 'nova', role: 'worker', status: 'error', task: 'retry · MCP gateway timeout (3/5)', capacityPct: 12, capacityVariant: 'err', tokens: null, lastSeen: '9s' },
  { id: 'water', initials: 'WT', name: 'water', role: 'worker', status: 'idle', task: 'idle · awaiting dispatch', capacityPct: 0, tokens: null, lastSeen: '17m' },
]

const SEED_OUTPUTS: Array<TeamOutput> = [
  { id: 'o1', agent: 'drift', typeLabel: 'md', type: 'docs', name: 'PROJECT.md', preview: 'High-level scope and constraints for the hermes-switchui rewrite. Frozen routes, locked profiles, follow-ups…', time: '11:08', size: '4.2 kb' },
  { id: 'o2', agent: 'drift', typeLabel: 'md', type: 'docs', name: 'ARCHITECTURE.md', preview: 'Route/server map, gateway capabilities, MCP surface, queue topology, shared state contracts and side-effects…', time: '11:08', size: '8.1 kb' },
  { id: 'o3', agent: 'neo', typeLabel: 'draft', type: 'docs', name: 'launch-tweet.draft', preview: '"hermes-switchui v0.4 ships today: a control room for persistent agent teams. dispatch missions, watch them route, see…"', time: '11:07', size: '178 ch' },
  { id: 'o4', agent: 'drift', typeLabel: 'json', type: 'data', name: 'benchloop-summary.json', preview: '12 runs across PC1 nightly · p50 latency 612ms (-8%) · p99 1.4s · regression at run #1009 narrowed to scheduler…', time: '11:06', size: '2.6 kb' },
  { id: 'o5', agent: 'blaze', typeLabel: 'csv', type: 'data', name: 'market-signals-1106.csv', preview: 'BTC/ETH/SOL hourly bands · funding divergences flagged at 03:00 and 09:00 · Z > 2.4 on three pairs…', time: '10:54', size: '14 kb' },
  { id: 'o6', agent: 'echo', typeLabel: 'md', type: 'docs', name: 'standup-1106.md', preview: '3 wins · 2 blockers · 1 ask. neo merged #312, drift unblocked memory rewrite, water awaiting design tokens…', time: '10:31', size: '1.8 kb' },
  { id: 'o7', agent: 'pixel', typeLabel: 'png', type: 'media', name: 'conductor-frame-008.png', preview: 'Frame 8/24 of the conductor radar overlay · 1920×1080 · agents diffused, glow at 0.6 opacity…', time: '10:18', size: '312 kb' },
  { id: 'o8', agent: 'workspace', typeLabel: 'idx', type: 'data', name: '.hermes-index.bin', preview: 'Indexed 4,212 files across .hermes/kanban/workspaces. Embeddings refreshed for 188 changed paths…', time: '10:02', size: '2.1 mb' },
  { id: 'o9', agent: 'neo', typeLabel: 'ts', type: 'code', name: 'operations-layout.tsx', preview: 'Scaffolded M3 layout grid with team rail, focus panel, dispatch panel and outputs strip slots…', time: '09:55', size: '3.1 kb' },
  { id: 'o10', agent: 'blaze', typeLabel: 'py', type: 'code', name: 'signal-scanner.py', preview: 'Vectorised BTC/ETH/SOL hourly band scanner with Z-score threshold alerts and funding rate divergence flags…', time: '09:40', size: '6.8 kb' },
]

const SEED_STATE: OperationsState = {
  live: 6,
  total: 9,
  tokenRate: '14.2k',
  queue: 3,
  errors24h: 2,
  spark: [22, 18, 20, 14, 16, 9, 12, 6, 10, 4, 8, 3, 7],
}

// Shared mission/activity/tools/outputs used for all agent focus panels in M6
const SHARED_MISSION: FocusMission = {
  traceId: 't_49b85d13',
  startedAt: '11:04',
  prompt: 'Sweep open PRs in hermes-switchui, summarise BenchLoop runs from PC1, draft a launch tweet.',
  stages: [
    { label: 'plan', state: 'done' },
    { label: 'route', state: 'done' },
    { label: 'execute · 3/5', state: 'now' },
    { label: 'review', state: 'pending' },
    { label: 'report', state: 'pending' },
  ],
  elapsed: '04:18',
}

const SHARED_ACTIVITY: Array<ActivityItem> = [
  { time: '11:08:42', tag: 'handoff', text: 'delegated summarise BenchLoop → drift' },
  { time: '11:08:31', tag: 'tool', text: 'list_files · /workspaces/hermes-switchui/.benchloop · 4ms' },
  { time: '11:08:14', tag: 'handoff', text: 'delegated scan PRs → neo' },
  { time: '11:07:52', tag: 'tool', text: 'github.search_pulls · 48 results · 312ms', done: true },
  { time: '11:06:02', text: 'plan finalised · 5 stages · est 06:10', done: true },
  { time: '11:04:00', text: 'mission accepted from user (rohit)', done: true },
]

const SHARED_TOOLS: Array<ToolItem> = [
  { ico: 'git', name: 'github.search', count: 12 },
  { ico: 'fs', name: 'list_files', count: 8 },
  { ico: 'fs', name: 'read_file', count: 21 },
  { ico: 'w', name: 'write_file', count: 3 },
  { ico: 'x', name: 'x.compose', count: 1 },
  { ico: 'db', name: 'memory.recall', count: 5 },
]

const SHARED_OUTPUTS: Array<OutputItem> = [
  { type: 'file', name: 'PROJECT.md', meta: 'workspace root · committed by drift · 4.2 kb', time: '11:08' },
  { type: 'file', name: 'ARCHITECTURE.md', meta: 'workspace root · committed by drift · 8.1 kb', time: '11:08' },
  { type: 'artifact', name: 'launch-tweet.draft', meta: 'by neo · awaiting review · 178 chars', time: '11:07' },
  { type: 'data', name: 'benchloop-summary.json', meta: 'by drift · 12 runs · 2.6 kb', time: '11:06' },
]

function agentToFocusData(agent: Agent): FocusData {
  return {
    id: agent.id,
    initials: agent.initials,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    workerCount: 3,
    model: 'hermes-4-405b',
    profile: 'default',
    toolCount: 12,
    mission: SHARED_MISSION,
    activity: SHARED_ACTIVITY,
    tools: SHARED_TOOLS,
    outputs: SHARED_OUTPUTS,
  }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seedIfEmpty(): Promise<void> {
  let agentFiles: Array<string>
  try {
    agentFiles = await readdir(agentsDir())
  } catch {
    agentFiles = []
  }
  if (agentFiles.filter((f) => f.endsWith('.json')).length > 0) return

  await Promise.all([
    ...SEED_AGENTS.map((a) =>
      writeFile(join(agentsDir(), `${a.id}.json`), JSON.stringify(a, null, 2), 'utf-8'),
    ),
    ...SEED_OUTPUTS.map((o) =>
      writeFile(join(outputsDir(), `${o.id}.json`), JSON.stringify(o, null, 2), 'utf-8'),
    ),
    writeFile(statePath(), JSON.stringify(SEED_STATE, null, 2), 'utf-8'),
  ])
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<Array<Agent>> {
  await ensureDirs()
  await seedIfEmpty()
  let files: Array<string>
  try {
    files = await readdir(agentsDir())
  } catch {
    return []
  }
  const agents = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => {
        try {
          const raw = await readFile(join(agentsDir(), f), 'utf-8')
          return JSON.parse(raw) as Agent
        } catch {
          return null
        }
      }),
  )
  return agents.filter(Boolean) as Array<Agent>
}

export async function getAgent(id: string): Promise<FocusData | null> {
  await ensureDirs()
  await seedIfEmpty()
  try {
    const raw = await readFile(join(agentsDir(), `${id}.json`), 'utf-8')
    const agent = JSON.parse(raw) as Agent
    return agentToFocusData(agent)
  } catch {
    return null
  }
}

export async function pauseAgent(id: string): Promise<Agent> {
  const raw = await readFile(join(agentsDir(), `${id}.json`), 'utf-8')
  const agent = JSON.parse(raw) as Agent
  agent.status = 'idle'
  await writeFile(join(agentsDir(), `${id}.json`), JSON.stringify(agent, null, 2), 'utf-8')
  return agent
}

export async function resumeAgent(id: string): Promise<Agent> {
  const raw = await readFile(join(agentsDir(), `${id}.json`), 'utf-8')
  const agent = JSON.parse(raw) as Agent
  agent.status = 'live'
  await writeFile(join(agentsDir(), `${id}.json`), JSON.stringify(agent, null, 2), 'utf-8')
  return agent
}

export async function listOutputs(): Promise<Array<TeamOutput>> {
  await ensureDirs()
  await seedIfEmpty()
  let files: Array<string>
  try {
    files = await readdir(outputsDir())
  } catch {
    return []
  }
  const outputs = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => {
        try {
          const raw = await readFile(join(outputsDir(), f), 'utf-8')
          return JSON.parse(raw) as TeamOutput
        } catch {
          return null
        }
      }),
  )
  return (outputs.filter(Boolean) as Array<TeamOutput>).sort((a, b) => a.id.localeCompare(b.id))
}

export async function getState(): Promise<OperationsState> {
  await ensureDirs()
  await seedIfEmpty()
  try {
    const raw = await readFile(statePath(), 'utf-8')
    return JSON.parse(raw) as OperationsState
  } catch {
    return SEED_STATE
  }
}

export async function createAgent(input: {
  name: string
  role: AgentRole
  task: string
}): Promise<Agent> {
  await ensureDirs()
  await seedIfEmpty()
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const uid = randomBytes(2).toString('hex')
  const id = `${slug}-${uid}`
  const nameParts = input.name.split(/\s+/)
  const initials = nameParts
    .map((w) => (w.length > 0 ? w[0].toUpperCase() : ''))
    .join('')
    .slice(0, 2)
    .padEnd(2, input.name.length > 1 ? input.name[1].toUpperCase() : 'X')
  const agent: Agent = {
    id,
    initials,
    name: input.name,
    role: input.role,
    status: 'idle',
    task: input.task || 'idle · awaiting dispatch',
    capacityPct: 0,
    tokens: null,
    lastSeen: 'now',
  }
  await writeFile(join(agentsDir(), `${id}.json`), JSON.stringify(agent, null, 2), 'utf-8')
  return agent
}

export async function createDispatch(input: {
  prompt: string
  mode?: string
  priority?: string
  budget?: string
  deadline?: string
  tags?: Array<string>
}): Promise<Dispatch> {
  await ensureDirs()
  await seedIfEmpty()
  const id = `d_${randomBytes(4).toString('hex')}`
  const dispatch: Dispatch = {
    id,
    prompt: input.prompt,
    mode: input.mode ?? 'auto',
    priority: input.priority ?? 'normal',
    budget: input.budget ?? '25k tok',
    deadline: input.deadline ?? '30m',
    tags: input.tags ?? [],
    createdAt: Date.now(),
  }
  await writeFile(
    join(dispatchesDir(), `${id}.json`),
    JSON.stringify(dispatch, null, 2),
    'utf-8',
  )
  return dispatch
}
