/**
 * conductor-store.ts — File-backed mission registry.
 * Missions stored at ~/.hermes/conductor/missions/<id>.json
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Mission {
  id: string
  title: string
  subtitle: string
  status: 'live' | 'done' | 'err'
  elapsed: string
  tokens: string
  action?: 'focus' | 'replay' | 'retry'
  dayGroup: 'now' | 'today' | 'yesterday'
  createdAt: number
}

function missionsDir(): string {
  return join(homedir(), '.hermes', 'conductor', 'missions')
}

async function ensureDir(): Promise<void> {
  await mkdir(missionsDir(), { recursive: true })
}

async function writeMission(mission: Mission): Promise<void> {
  await ensureDir()
  await writeFile(
    join(missionsDir(), `${mission.id}.json`),
    JSON.stringify(mission, null, 2),
    'utf-8',
  )
}

function computeDayGroup(createdAt: number): Mission['dayGroup'] {
  const now = Date.now()
  const diffMs = now - createdAt
  const diffH = diffMs / 1000 / 3600
  if (diffH < 1) return 'now'
  if (diffH < 24) return 'today'
  return 'yesterday'
}

function deriveAction(status: Mission['status']): Mission['action'] {
  if (status === 'live') return 'focus'
  if (status === 'done') return 'replay'
  return 'retry'
}

const SEED_MISSIONS: Array<Mission> = [
  { id: 'm_seed_01', title: 'Sweep PRs + summarise Bench results', subtitle: 'routed by switch · 3 domains · in progress', status: 'live', elapsed: '04:18', tokens: '8.4k', action: 'focus', dayGroup: 'now', createdAt: Date.now() - 4*60*1000 },
  { id: 'm_seed_02', title: 'Standup digest · 1106', subtitle: 'echo + sage · 3 stages', status: 'done', elapsed: '02:14', tokens: '3.1k', action: 'replay', dayGroup: 'today', createdAt: Date.now() - 2*60*60*1000 },
  { id: 'm_seed_03', title: 'Market signals · BTC/ETH/SOL', subtitle: 'blaze · 1 stage · 6 series', status: 'done', elapsed: '01:42', tokens: '2.8k', action: 'replay', dayGroup: 'today', createdAt: Date.now() - 3*60*60*1000 },
  { id: 'm_seed_04', title: 'Index .hermes/embeddings', subtitle: 'nightly digest · failed', status: 'err', elapsed: '00:48', tokens: '12k', action: 'retry', dayGroup: 'today', createdAt: Date.now() - 4*60*60*1000 },
  { id: 'm_seed_05', title: 'PR review queue', subtitle: 'github · scan 48 · classify 12/48', status: 'done', elapsed: '12:30', tokens: '6.2k', action: 'replay', dayGroup: 'today', createdAt: Date.now() - 5*60*60*1000 },
  { id: 'm_seed_06', title: 'Memory rewrite · scratchpad', subtitle: 'morpheus · 4 stages', status: 'done', elapsed: '08:15', tokens: '4.7k', action: 'replay', dayGroup: 'yesterday', createdAt: Date.now() - 28*60*60*1000 },
  { id: 'm_seed_07', title: 'MCP gateway probe', subtitle: 'neo · ping · capabilities', status: 'done', elapsed: '00:32', tokens: '512', action: 'replay', dayGroup: 'yesterday', createdAt: Date.now() - 30*60*60*1000 },
]

async function seedIfEmpty(): Promise<void> {
  const dir = missionsDir()
  let files: Array<string>
  try {
    files = await readdir(dir)
  } catch {
    files = []
  }
  if (files.filter((f) => f.endsWith('.json')).length === 0) {
    await Promise.all(SEED_MISSIONS.map((m) => writeMission(m)))
  }
}

export async function listMissions(): Promise<Array<Mission>> {
  await ensureDir()
  await seedIfEmpty()
  let files: Array<string>
  try {
    files = await readdir(missionsDir())
  } catch {
    return []
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'))
  const missions = await Promise.all(
    jsonFiles.map(async (f) => {
      try {
        const raw = await readFile(join(missionsDir(), f), 'utf-8')
        const m = JSON.parse(raw) as Mission
        // Re-derive dayGroup based on current time
        m.dayGroup = computeDayGroup(m.createdAt)
        return m
      } catch {
        return null
      }
    }),
  )

  return (missions.filter(Boolean) as Array<Mission>).sort(
    (a, b) => b.createdAt - a.createdAt,
  )
}

export async function getMission(id: string): Promise<Mission | null> {
  try {
    const raw = await readFile(join(missionsDir(), `${id}.json`), 'utf-8')
    const m = JSON.parse(raw) as Mission
    m.dayGroup = computeDayGroup(m.createdAt)
    return m
  } catch {
    return null
  }
}

export async function createMission(input: {
  title: string
  subtitle?: string
}): Promise<Mission> {
  const id = `m_${randomBytes(4).toString('hex')}`
  const now = Date.now()
  const mission: Mission = {
    id,
    title: input.title,
    subtitle: input.subtitle ?? 'routed by switch · 1 domain',
    status: 'live',
    elapsed: '00:00',
    tokens: '0',
    action: 'focus',
    dayGroup: 'now',
    createdAt: now,
  }
  await writeMission(mission)
  return mission
}

export async function abortMission(id: string): Promise<Mission> {
  const mission = await getMission(id)
  if (!mission) {
    throw new Error(`Mission ${id} not found`)
  }
  mission.status = 'err'
  mission.action = deriveAction('err')
  await writeMission(mission)
  return mission
}

export async function getConductorState(): Promise<{
  liveMissions: number
  elapsed: string
  workersActive: number
  tokensUsed: string
}> {
  const missions = await listMissions()
  const live = missions.filter((m) => m.status === 'live')

  // Compute elapsed for oldest live mission
  let elapsed = '00:00'
  if (live.length > 0) {
    const oldest = live.reduce((a, b) => (a.createdAt < b.createdAt ? a : b))
    const diffS = Math.floor((Date.now() - oldest.createdAt) / 1000)
    const mm = Math.floor(diffS / 60)
      .toString()
      .padStart(2, '0')
    const ss = (diffS % 60).toString().padStart(2, '0')
    elapsed = `${mm}:${ss}`
  }

  // Rough token sum (parse suffixes like '8.4k', '12k', '410')
  function parseTokens(t: string): number {
    const s = t.trim().toLowerCase()
    if (s.endsWith('k')) return parseFloat(s) * 1000
    return parseFloat(s) || 0
  }
  const totalTok = missions.reduce((sum, m) => sum + parseTokens(m.tokens), 0)
  const tokensUsed =
    totalTok >= 1000
      ? `${(totalTok / 1000).toFixed(1).replace(/\.0$/, '')}k`
      : String(Math.round(totalTok))

  return {
    liveMissions: live.length,
    elapsed,
    workersActive: live.length,
    tokensUsed,
  }
}
