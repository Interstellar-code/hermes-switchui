import { describe, expect, it } from 'vitest'
import type { GatewaySession } from '@/lib/gateway-api'
import { isChildWorkerSession, isWorkspaceChatSession } from './use-agent-view'

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
