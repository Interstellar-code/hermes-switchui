import { describe, expect, it } from 'vitest'
import {
  isChildWorkerSession,
  isWorkspaceChatSession,
  mapSessionToActiveAgent,
} from './use-agent-view'
import type { GatewaySession } from '@/lib/gateway-api'

describe('useAgentView session payload regression', () => {
  it('does not classify inactive api chat history as a live workspace session', () => {
    const staleApiSession: GatewaySession = {
      key: 'api-986919d15946c11c',
      friendlyId: 'api-986919d15946c11c',
      kind: 'chat',
      status: 'idle',
      is_active: false,
      parentSessionId: null,
      preview: 'Make Matrix3D reflect status from one live source only',
      model: 'auto',
      tokenCount: 478_029,
      totalTokens: 478_029,
    }

    expect(isWorkspaceChatSession(staleApiSession)).toBe(false)
  })

  it('does not classify child worker sessions as workspace Hermes sessions', () => {
    const childSession: GatewaySession = {
      key: '20260515_082812_child',
      friendlyId: '20260515_082812_child',
      kind: 'chat',
      status: 'idle',
      is_active: true,
      parentSessionId: '20260515_082812_parent',
      preview: 'Infra health for Neo',
      model: 'auto',
    }

    expect(isChildWorkerSession(childSession)).toBe(true)
    expect(isWorkspaceChatSession(childSession)).toBe(false)
  })
})

describe('mapSessionToActiveAgent', () => {
  const now = Date.now()

  it('reports no progress when the gateway gives none (no fake 35%)', () => {
    const agent = mapSessionToActiveAgent(
      { key: 'k1', kind: 'chat', status: 'running', updatedAt: now },
      null,
    )
    expect(agent.progress).toBe(0)
  })

  it('passes through real progress', () => {
    const agent = mapSessionToActiveAgent(
      { key: 'k1', kind: 'agent', status: 'running', progress: 62 },
      null,
    )
    expect(agent.progress).toBe(62)
  })

  it('marks a stale child session idle and a fresh one running', () => {
    const base: GatewaySession = {
      key: 'child',
      kind: 'chat',
      status: 'idle',
      is_active: false,
      parentSessionId: 'parent',
      profile: 'neo',
    }
    const stale = mapSessionToActiveAgent(
      { ...base, updatedAt: now - 10 * 60_000 },
      null,
    )
    const fresh = mapSessionToActiveAgent(
      { ...base, updatedAt: now - 60_000 },
      null,
    )
    const active = mapSessionToActiveAgent(
      { ...base, is_active: true, updatedAt: now - 10 * 60_000 },
      null,
    )
    expect(stale.status).toBe('idle')
    expect(fresh.status).toBe('running')
    expect(active.status).toBe('running')
    expect(stale).toMatchObject({ profile: 'neo', parentSessionId: 'parent' })
  })
})
