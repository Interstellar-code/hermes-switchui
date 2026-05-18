import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClaudeSession } from './hermes-api'
import {
  __resetOperationsReaders,
  __setOperationsReaders,
  CapabilityUnavailableError,
  getAgent,
  getState,
  listAgents,
  listOutputs,
  pauseAgent,
  resumeAgent,
  type NodeRunRow,
} from './operations-store'

const NOW = Date.now()

function makeNodeRun(over: Partial<NodeRunRow> = {}): NodeRunRow {
  return {
    id: 'nr-1',
    workflow_run_id: 'wr-1',
    dag_node_id: 'plan-node',
    node_type: 'execute',
    status: 'running',
    assigned_agent: 'sage',
    summary: 'planning q4 portfolio rebalance',
    error: null,
    started_at: NOW - 60_000,
    completed_at: null,
    artifact_refs: null,
    ...over,
  }
}

function makeSession(over: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: 'sess-1',
    title: 'neo session',
    is_active: true,
    started_at: Math.floor((NOW - 30_000) / 1000),
    last_active: Math.floor(NOW / 1000),
    input_tokens: 800,
    output_tokens: 300,
    preview: 'scanning issue tracker',
    ...over,
  }
}

describe('operations-store live projections', () => {
  afterEach(() => {
    __resetOperationsReaders()
  })

  it('returns empty arrays when gateway and engine are both offline', async () => {
    __setOperationsReaders({
      listSessions: async () => {
        throw new Error('gateway offline')
      },
      listNodeRuns: async () => {
        throw new Error('engine unavailable')
      },
    })

    await expect(listAgents()).resolves.toEqual([])
    await expect(listOutputs()).resolves.toEqual([])
    const state = await getState()
    expect(state.live).toBe(0)
    expect(state.total).toBe(0)
  })

  it('projects active node_runs as live agents and tags orchestrator role', async () => {
    __setOperationsReaders({
      listSessions: async () => [],
      listNodeRuns: async () => [
        makeNodeRun({ id: 'nr-orch', node_type: 'router', assigned_agent: 'sage' }),
        makeNodeRun({ id: 'nr-worker', node_type: 'execute', assigned_agent: 'neo' }),
        makeNodeRun({ id: 'nr-done', status: 'completed', assigned_agent: 'echo' }),
      ],
    })

    const agents = await listAgents()
    expect(agents).toHaveLength(2)
    const sage = agents.find((a) => a.id === 'nr-orch')!
    expect(sage.role).toBe('orchestrator')
    expect(sage.status).toBe('live')
    expect(sage.initials).toBe('SA')
    const neo = agents.find((a) => a.id === 'nr-worker')!
    expect(neo.role).toBe('worker')
  })

  it('maps node_run statuses to agent status', async () => {
    __setOperationsReaders({
      listSessions: async () => [],
      listNodeRuns: async () => [
        makeNodeRun({ id: 'a', status: 'running' }),
        makeNodeRun({ id: 'b', status: 'paused' }),
        makeNodeRun({ id: 'c', status: 'failed' }),
        makeNodeRun({ id: 'd', status: 'pending' }),
      ],
    })
    const agents = await listAgents()
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]))
    expect(byId.a.status).toBe('live')
    expect(byId.b.status).toBe('blocked')
    expect(byId.c.status).toBe('error')
    expect(byId.d.status).toBe('idle')
  })

  it('falls back to gateway sessions when no active node_runs', async () => {
    __setOperationsReaders({
      listSessions: async () => [makeSession()],
      listNodeRuns: async () => [],
    })
    const agents = await listAgents()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe('sess-1')
    expect(agents[0].status).toBe('live')
    expect(agents[0].tokens).toBe('1.1k')
  })

  it('listOutputs projects completed node_runs with artifact_refs', async () => {
    __setOperationsReaders({
      listSessions: async () => [],
      listNodeRuns: async () => [
        makeNodeRun({
          id: 'nr-done',
          status: 'completed',
          assigned_agent: 'drift',
          summary: 'wrote project doc',
          completed_at: NOW,
          artifact_refs: [
            { type: 'file', label: 'PROJECT.md', path: '/repo/PROJECT.md' },
          ],
        }),
        makeNodeRun({
          id: 'nr-summary',
          status: 'completed',
          assigned_agent: 'echo',
          summary: 'standup summary',
          completed_at: NOW - 1000,
          artifact_refs: null,
        }),
      ],
    })

    const outputs = await listOutputs()
    expect(outputs).toHaveLength(2)
    expect(outputs[0].name).toBe('PROJECT.md')
    expect(outputs[0].type).toBe('docs')
    expect(outputs[1].typeLabel).toBe('summary')
  })

  it('getAgent returns focus data for a known node_run', async () => {
    __setOperationsReaders({
      listSessions: async () => [],
      listNodeRuns: async () => [
        makeNodeRun({ id: 'nr-1' }),
        makeNodeRun({
          id: 'nr-2',
          dag_node_id: 'review',
          assigned_agent: 'drift',
          summary: 'review the plan',
        }),
      ],
    })

    const focus = await getAgent('nr-1')
    expect(focus).not.toBeNull()
    expect(focus!.mission.traceId).toBe('wr-1')
    expect(focus!.activity.length).toBeGreaterThan(0)
  })

  it('getAgent returns null when id is unknown', async () => {
    __setOperationsReaders({
      listSessions: async () => [],
      listNodeRuns: async () => [],
    })
    expect(await getAgent('missing')).toBeNull()
  })

  it('pauseAgent and resumeAgent throw CapabilityUnavailableError', async () => {
    await expect(pauseAgent('x')).rejects.toBeInstanceOf(CapabilityUnavailableError)
    await expect(resumeAgent('x')).rejects.toBeInstanceOf(CapabilityUnavailableError)
  })

  it('getState aggregates counts across projections', async () => {
    __setOperationsReaders({
      listSessions: async () => [
        makeSession({ id: 's1', input_tokens: 500, output_tokens: 500 }),
      ],
      listNodeRuns: async () => [
        makeNodeRun({ id: 'a', status: 'running' }),
        makeNodeRun({ id: 'b', status: 'failed' }),
        makeNodeRun({ id: 'c', status: 'pending' }),
      ],
    })
    const state = await getState()
    expect(state.live).toBeGreaterThanOrEqual(1)
    expect(state.errors24h).toBe(1)
    expect(state.total).toBe(4) // 3 node_runs + 1 session
    expect(state.tokenRate).toBe('1.0k')
  })
})

beforeEach(() => {
  __resetOperationsReaders()
})
