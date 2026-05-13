/**
 * mock-data.ts — Static fixture data for the Conductor UI (M5).
 * Replace with API queries in M6.
 */

import type { MissionStatus } from './mission-card'
// Note: MissionData uses the API Mission shape. 'ok' is legacy; use 'done'.

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export interface MissionData {
  id: string
  title: string
  sub: string
  status: MissionStatus
  elapsed: string
  tokens: string
  group: 'now' | 'earlier' | 'yesterday' | 'today'
}

export const MISSIONS: Array<MissionData> = [
  {
    id: 'sweep-prs',
    title: 'Sweep PRs + summarise BenchLoop',
    sub: 'routed by switch · 3 domains · 7 tasks',
    status: 'live',
    elapsed: '04:18',
    tokens: '8.4k',
    group: 'now',
  },
  {
    id: 'standup',
    title: 'Standup digest · 1106',
    sub: 'echo + sage · 3 stages',
    status: 'done',
    elapsed: '02:14',
    tokens: '3.1k',
    group: 'earlier',
  },
  {
    id: 'market-signals',
    title: 'Market signals · BTC/ETH/SOL',
    sub: 'blaze · 1 stage · 6 series',
    status: 'done',
    elapsed: '01:42',
    tokens: '2.8k',
    group: 'earlier',
  },
  {
    id: 'index-embeddings',
    title: 'Index .hermes/embeddings',
    sub: 'workspace · 4 stages · failed at 3',
    status: 'err',
    elapsed: '06:02',
    tokens: '12k',
    group: 'earlier',
  },
  {
    id: 'nightly-digest',
    title: 'Cron · nightly digest 0810',
    sub: 'cron_54fc55bce759 · 4 stages',
    status: 'done',
    elapsed: '04:21',
    tokens: '3.0k',
    group: 'earlier',
  },
  {
    id: 'pr-review-queue',
    title: 'PR review queue · #318 thru #331',
    sub: 'drift + neo · 14 PRs reviewed',
    status: 'done',
    elapsed: '14:08',
    tokens: '42k',
    group: 'yesterday',
  },
  {
    id: 'memory-rewrite',
    title: 'Memory rewrite · scratch → kanban',
    sub: 'drift · 7 stages',
    status: 'done',
    elapsed: '28:47',
    tokens: '88k',
    group: 'yesterday',
  },
  {
    id: 'mcp-gateway-probe',
    title: 'MCP gateway probe',
    sub: 'nova · 2 stages · timeout',
    status: 'err',
    elapsed: '00:42',
    tokens: '410',
    group: 'yesterday',
  },
]

// ---------------------------------------------------------------------------
// Worker lanes
// ---------------------------------------------------------------------------

export interface LaneBlock {
  className: string
  style: React.CSSProperties
  label: string
}

export interface LaneData {
  name: string
  role: string
  dotStatus: 'active' | 'idle' | 'error'
  blocks: Array<LaneBlock>
}

export const NOW_LEFT = '91%'

export const LANES: Array<LaneData> = [
  {
    name: 'sage',
    role: 'orch',
    dotStatus: 'active',
    blocks: [
      { className: 'run',      style: { left: '0%',  width: '8%'  }, label: 'plan' },
      { className: 'handoff',  style: { left: '9%',  width: '5%'  }, label: 'route' },
      { className: 'run',      style: { left: '15%', width: '6%'  }, label: 'handoff →' },
      { className: 'tool',     style: { left: '22%', width: '4%'  }, label: 'memory.recall' },
      { className: 'handoff',  style: { left: '27%', width: '4%'  }, label: 'handoff →' },
      { className: 'run live', style: { left: '82%', width: '9%'  }, label: 'monitor' },
    ],
  },
  {
    name: 'drift',
    role: 'w',
    dotStatus: 'active',
    blocks: [
      { className: 'tool',     style: { left: '18%', width: '6%'  }, label: 'list_files' },
      { className: 'run',      style: { left: '25%', width: '28%' }, label: 'benchloop.parse' },
      { className: 'tool',     style: { left: '54%', width: '5%'  }, label: 'read_file' },
      { className: 'run live', style: { left: '60%', width: '31%' }, label: 'summarise · 60%' },
    ],
  },
  {
    name: 'neo',
    role: 'w',
    dotStatus: 'active',
    blocks: [
      { className: 'tool',     style: { left: '30%', width: '7%'  }, label: 'github.search' },
      { className: 'run',      style: { left: '38%', width: '18%' }, label: 'scan PRs · 48' },
      { className: 'review',   style: { left: '57%', width: '8%'  }, label: 'classify' },
      { className: 'run live', style: { left: '66%', width: '25%' }, label: 'summarise · 12/48' },
    ],
  },
  {
    name: 'echo',
    role: 'w',
    dotStatus: 'idle',
    blocks: [
      { className: '', style: { left: '5%', width: '14%', opacity: 0.5 }, label: 'standup-1106' },
    ],
  },
  {
    name: 'blaze',
    role: 'w',
    dotStatus: 'active',
    blocks: [
      { className: 'run',      style: { left: '8%',  width: '22%' }, label: 'market signals' },
      { className: 'tool',     style: { left: '31%', width: '5%'  }, label: 'x.compose' },
      { className: 'run live', style: { left: '75%', width: '16%' }, label: 'draft tweet' },
    ],
  },
  {
    name: 'nova',
    role: 'w',
    dotStatus: 'error',
    blocks: [
      { className: 'tool',     style: { left: '40%', width: '5%'  }, label: 'mcp.gateway' },
      { className: 'err',      style: { left: '46%', width: '9%'  }, label: 'timeout · retry 3/5' },
      { className: 'err',      style: { left: '56%', width: '9%'  }, label: 'timeout · retry 4/5' },
      { className: 'err live', style: { left: '66%', width: '25%' }, label: 'awaiting backoff' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Stages (now-playing-strip phase pills)
// ---------------------------------------------------------------------------

export interface StageData {
  label: string
  state: 'done' | 'now' | 'pending'
}

export const STAGES: Array<StageData> = [
  { label: 'plan',    state: 'done' },
  { label: 'route',   state: 'done' },
  { label: 'execute', state: 'now' },
  { label: 'review',  state: 'pending' },
  { label: 'report',  state: 'pending' },
]

// ---------------------------------------------------------------------------
// Now playing
// ---------------------------------------------------------------------------

export interface NowPlayingData {
  elapsed: string
  missionId: string
  prompt: string
  routedBy: string
  domains: string
  taskCount: number
  estTime: string
  budgetTok: string
  usedTok: string
}

export const NOW_PLAYING: NowPlayingData = {
  elapsed: '04:18',
  missionId: 'T_67fc8810',
  prompt: 'ROUTED BY SWITCH · NEO TRINITY MORPHEUS · 7 TASKS · 18 MIN',
  routedBy: 'switch',
  domains: 'neo · trinity · morpheus',
  taskCount: 7,
  estTime: '18:00',
  budgetTok: '26k tok',
  usedTok: '8.4k',
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

export interface TopBarData {
  liveMissions: number
  elapsed: string
  workers: number
  tokens: string
}

export const TOP_BAR_DATA: TopBarData = {
  liveMissions: 1,
  elapsed: '04:18',
  workers: 5,
  tokens: '8.4k',
}
