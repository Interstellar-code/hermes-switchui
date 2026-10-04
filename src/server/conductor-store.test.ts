import { beforeEach, describe, expect, it, vi } from 'vitest'
import { abortMission, getConductorSnapshot } from './conductor-store'

const { listRuns, listActiveNodeRuns, cancelRun } = vi.hoisted(() => ({
  listRuns: vi.fn(),
  listActiveNodeRuns: vi.fn(),
  cancelRun: vi.fn(),
}))

vi.mock('./workflow-engine/factory', () => ({
  getEngine: () => ({ listRuns, cancelRun, getRun: vi.fn() }),
}))
vi.mock('./workflow-engine/clients/plugin-client', () => ({
  PluginClient: class {
    listActiveNodeRuns = listActiveNodeRuns
  },
}))

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    workflow_id: 'wf',
    status: 'completed',
    current_phase: 'report',
    user_message: 'go',
    started_at: iso(120_000),
    completed_at: iso(60_000),
    last_heartbeat: iso(60_000),
    metadata: null,
    ...over,
  }
}

beforeEach(() => {
  listRuns.mockReset()
  listActiveNodeRuns.mockReset().mockResolvedValue([])
  cancelRun.mockReset()
})

describe('getConductorSnapshot', () => {
  it('gives finite elapsed and createdAt for ISO timestamps', async () => {
    listRuns.mockResolvedValue([run()])
    const { missions } = await getConductorSnapshot()
    expect(Number.isFinite(missions[0].createdAt)).toBe(true)
    expect(missions[0].elapsed).toBe('01:00')
    expect(missions[0].elapsed).not.toContain('NaN')
  })

  it('maps paused to waiting and pending to queued', async () => {
    listRuns.mockResolvedValue([
      run({ id: 'a', status: 'paused', completed_at: null }),
      run({ id: 'b', status: 'pending', completed_at: null }),
    ])
    const { missions, stats } = await getConductorSnapshot()
    expect(missions.map((m) => m.status)).toEqual(['waiting', 'queued'])
    expect(stats.needsYou).toBe(1)
  })

  it('does not NaN when completed_at is null on a finished run', async () => {
    listRuns.mockResolvedValue([run({ completed_at: null })])
    const { missions } = await getConductorSnapshot()
    expect(missions[0].elapsed).toMatch(/^\d\d:\d\d$/)
  })

  it('falls back to last_heartbeat for an unparseable started_at', async () => {
    listRuns.mockResolvedValue([run({ started_at: 'garbage' })])
    const { missions } = await getConductorSnapshot()
    expect(Number.isFinite(missions[0].createdAt)).toBe(true)
  })

  it('treats a numeric 0 started_at as missing', async () => {
    listRuns.mockResolvedValue([run({ started_at: 0 })])
    const { missions } = await getConductorSnapshot()
    expect(missions[0].createdAt).toBeGreaterThan(1e12)
  })

  it('groups by calendar day, not by hours', async () => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const ago = (ms: number) =>
      new Date(startOfToday.getTime() - ms).toISOString()
    listRuns.mockResolvedValue([
      run({ id: 'y', started_at: ago(60_000) }), // 23:59 yesterday
      run({ id: 'e', started_at: ago(2 * 86_400_000) }),
      run({
        id: 't',
        started_at: new Date(startOfToday.getTime() + 1000).toISOString(),
      }),
    ])
    const { missions } = await getConductorSnapshot()
    expect(Object.fromEntries(missions.map((m) => [m.id, m.dayGroup]))).toEqual(
      {
        y: 'yesterday',
        e: 'earlier',
        t: 'today',
      },
    )
  })

  it('reads triggerKind from kind, then type', async () => {
    listRuns.mockResolvedValue([
      run({
        id: 'k',
        metadata: { trigger: { kind: 'cron' }, inputs: { a: 1 } },
      }),
      run({ id: 't', metadata: { trigger: { type: 'chat' } } }),
      run({ id: 'n' }),
    ])
    const { missions } = await getConductorSnapshot()
    expect(missions.map((m) => m.triggerKind)).toEqual(['cron', 'chat', null])
    expect(missions[0].inputs).toEqual({ a: 1 })
    expect(missions[0].userMessage).toBe('go')
  })

  it('calls listRuns exactly once per snapshot and memoises within maxAge', async () => {
    listRuns.mockResolvedValue([run({ status: 'running', completed_at: null })])
    listActiveNodeRuns.mockResolvedValue([
      { status: 'running' },
      { status: 'waiting' },
    ])
    const first = await getConductorSnapshot()
    expect(listRuns).toHaveBeenCalledTimes(1)
    expect(first.stats).toMatchObject({ live: 1, nodesRunning: 1, tokens: '—' })
    await getConductorSnapshot(60_000)
    expect(listRuns).toHaveBeenCalledTimes(1)
    await getConductorSnapshot()
    expect(listRuns).toHaveBeenCalledTimes(2)
  })
})

describe('abortMission', () => {
  it('cancels the run via the engine', async () => {
    cancelRun.mockResolvedValue(undefined)
    await abortMission('r9')
    expect(cancelRun).toHaveBeenCalledWith('r9')
  })
})
