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
  activity: ActivityItem[]
  tools: ToolItem[]
  outputs: OutputItem[]
}

export interface FocusMission {
  traceId: string
  startedAt: string
  prompt: string
  stages: { label: string; state: 'done' | 'now' | 'pending' }[]
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

export const FOCUS_DATA: FocusData = {
  id: 'sage',
  initials: 'SG',
  name: 'sage',
  role: 'orchestrator',
  status: 'live',
  workerCount: 3,
  model: 'hermes-4-405b',
  profile: 'default',
  toolCount: 12,
  mission: {
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
  },
  activity: [
    { time: '11:08:42', tag: 'handoff', text: 'delegated summarise BenchLoop → drift' },
    { time: '11:08:31', tag: 'tool', text: 'list_files · /workspaces/hermes-switchui/.benchloop · 4ms' },
    { time: '11:08:14', tag: 'handoff', text: 'delegated scan PRs → neo' },
    { time: '11:07:52', tag: 'tool', text: 'github.search_pulls · 48 results · 312ms', done: true },
    { time: '11:06:02', text: 'plan finalised · 5 stages · est 06:10', done: true },
    { time: '11:04:00', text: 'mission accepted from user (rohit)', done: true },
  ],
  tools: [
    { ico: 'git', name: 'github.search', count: 12 },
    { ico: 'fs', name: 'list_files', count: 8 },
    { ico: 'fs', name: 'read_file', count: 21 },
    { ico: 'w', name: 'write_file', count: 3 },
    { ico: 'x', name: 'x.compose', count: 1 },
    { ico: 'db', name: 'memory.recall', count: 5 },
  ],
  outputs: [
    { type: 'file', name: 'PROJECT.md', meta: 'workspace root · committed by drift · 4.2 kb', time: '11:08' },
    { type: 'file', name: 'ARCHITECTURE.md', meta: 'workspace root · committed by drift · 8.1 kb', time: '11:08' },
    { type: 'artifact', name: 'launch-tweet.draft', meta: 'by neo · awaiting review · 178 chars', time: '11:07' },
    { type: 'data', name: 'benchloop-summary.json', meta: 'by drift · 12 runs · 2.6 kb', time: '11:06' },
  ],
}

export interface RoutingStep {
  num: number
  agent: string
  desc: string
  conf: string
  variant?: 'med'
}

export interface DispatchMetaItem {
  label: string
  value: string
  active?: boolean
}

export interface DispatchDataShape {
  composerPlaceholder: string
  meta: DispatchMetaItem[]
  routingPreview: {
    steps: RoutingStep[]
    estCost: string
    estTime: string
  }
}

export const DISPATCH_DATA: DispatchDataShape = {
  composerPlaceholder:
    "describe a mission for the team... e.g. 'scan blaze's market signals for divergences and draft a brief'",
  meta: [
    { label: 'priority', value: 'normal', active: true },
    { label: 'budget', value: '25k tok' },
    { label: 'deadline', value: '30m' },
    { label: '+ tags', value: '' },
  ],
  routingPreview: {
    steps: [
      { num: 1, agent: 'sage', desc: 'plan + decompose', conf: '98%' },
      { num: 2, agent: 'blaze', desc: 'scan signals · 6 series', conf: '94%' },
      { num: 3, agent: 'echo', desc: 'draft brief · 200 words', conf: '71%', variant: 'med' },
      { num: 4, agent: 'sage', desc: 'review + emit', conf: '96%' },
    ],
    estCost: '~8.4k tok',
    estTime: '~3:40',
  },
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

export const OUTPUTS: Array<TeamOutput> = [
  {
    id: 'o1',
    agent: 'drift',
    typeLabel: 'md',
    type: 'docs',
    name: 'PROJECT.md',
    preview: 'High-level scope and constraints for the hermes-switchui rewrite. Frozen routes, locked profiles, follow-ups…',
    time: '11:08',
    size: '4.2 kb',
  },
  {
    id: 'o2',
    agent: 'drift',
    typeLabel: 'md',
    type: 'docs',
    name: 'ARCHITECTURE.md',
    preview: 'Route/server map, gateway capabilities, MCP surface, queue topology, shared state contracts and side-effects…',
    time: '11:08',
    size: '8.1 kb',
  },
  {
    id: 'o3',
    agent: 'neo',
    typeLabel: 'draft',
    type: 'docs',
    name: 'launch-tweet.draft',
    preview: '"hermes-switchui v0.4 ships today: a control room for persistent agent teams. dispatch missions, watch them route, see…"',
    time: '11:07',
    size: '178 ch',
  },
  {
    id: 'o4',
    agent: 'drift',
    typeLabel: 'json',
    type: 'data',
    name: 'benchloop-summary.json',
    preview: '12 runs across PC1 nightly · p50 latency 612ms (-8%) · p99 1.4s · regression at run #1009 narrowed to scheduler…',
    time: '11:06',
    size: '2.6 kb',
  },
  {
    id: 'o5',
    agent: 'blaze',
    typeLabel: 'csv',
    type: 'data',
    name: 'market-signals-1106.csv',
    preview: 'BTC/ETH/SOL hourly bands · funding divergences flagged at 03:00 and 09:00 · Z > 2.4 on three pairs…',
    time: '10:54',
    size: '14 kb',
  },
  {
    id: 'o6',
    agent: 'echo',
    typeLabel: 'md',
    type: 'docs',
    name: 'standup-1106.md',
    preview: '3 wins · 2 blockers · 1 ask. neo merged #312, drift unblocked memory rewrite, water awaiting design tokens…',
    time: '10:31',
    size: '1.8 kb',
  },
  {
    id: 'o7',
    agent: 'pixel',
    typeLabel: 'png',
    type: 'media',
    name: 'conductor-frame-008.png',
    preview: 'Frame 8/24 of the conductor radar overlay · 1920×1080 · agents diffused, glow at 0.6 opacity…',
    time: '10:18',
    size: '312 kb',
  },
  {
    id: 'o8',
    agent: 'workspace',
    typeLabel: 'idx',
    type: 'data',
    name: '.hermes-index.bin',
    preview: 'Indexed 4,212 files across .hermes/kanban/workspaces. Embeddings refreshed for 188 changed paths…',
    time: '10:02',
    size: '2.1 mb',
  },
  {
    id: 'o9',
    agent: 'neo',
    typeLabel: 'ts',
    type: 'code',
    name: 'operations-layout.tsx',
    preview: 'Scaffolded M3 layout grid with team rail, focus panel, dispatch panel and outputs strip slots…',
    time: '09:55',
    size: '3.1 kb',
  },
  {
    id: 'o10',
    agent: 'blaze',
    typeLabel: 'py',
    type: 'code',
    name: 'signal-scanner.py',
    preview: 'Vectorised BTC/ETH/SOL hourly band scanner with Z-score threshold alerts and funding rate divergence flags…',
    time: '09:40',
    size: '6.8 kb',
  },
]

export const AGENTS: Array<Agent> = [
  {
    id: 'sage',
    initials: 'SG',
    name: 'sage',
    role: 'orchestrator',
    status: 'live',
    task: 'routing · planning q4 portfolio rebalance',
    capacityPct: 64,
    tokens: '2.4k',
    lastSeen: 'now',
  },
  {
    id: 'neo',
    initials: 'NE',
    name: 'neo',
    role: 'worker',
    status: 'live',
    task: 'scanning issue tracker · 14 PRs queued',
    capacityPct: 82,
    tokens: '1.1k',
    lastSeen: '4s',
  },
  {
    id: 'workspace',
    initials: 'WS',
    name: 'workspace',
    role: 'worker',
    status: 'live',
    task: 'indexing /Users/rohits/.hermes',
    capacityPct: 38,
    tokens: '820',
    lastSeen: '1m',
  },
  {
    id: 'pixel',
    initials: 'PX',
    name: 'pixel',
    role: 'worker',
    status: 'live',
    task: 'rendering preview frames · 12/24',
    capacityPct: 50,
    tokens: '680',
    lastSeen: 'now',
  },
  {
    id: 'echo',
    initials: 'EC',
    name: 'echo',
    role: 'worker',
    status: 'live',
    task: 'summarising standup notes',
    capacityPct: 24,
    tokens: '410',
    lastSeen: '3s',
  },
  {
    id: 'drift',
    initials: 'DR',
    name: 'drift',
    role: 'worker',
    status: 'blocked',
    task: 'awaiting review · PR #318',
    capacityPct: 100,
    capacityVariant: 'warn',
    tokens: null,
    lastSeen: '2m',
  },
  {
    id: 'blaze',
    initials: 'BL',
    name: 'blaze',
    role: 'worker',
    status: 'live',
    task: 'market signals · BTC/ETH/SOL',
    capacityPct: 70,
    tokens: '3.2k',
    lastSeen: 'now',
  },
  {
    id: 'nova',
    initials: 'NV',
    name: 'nova',
    role: 'worker',
    status: 'error',
    task: 'retry · MCP gateway timeout (3/5)',
    capacityPct: 12,
    capacityVariant: 'err',
    tokens: null,
    lastSeen: '9s',
  },
  {
    id: 'water',
    initials: 'WT',
    name: 'water',
    role: 'worker',
    status: 'idle',
    task: 'idle · awaiting dispatch',
    capacityPct: 0,
    tokens: null,
    lastSeen: '17m',
  },
]
