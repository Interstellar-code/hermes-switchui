import { describe, expect, it } from 'vitest'
import {
  activeBubbleTextForPresence,
  idleLeisureAreaForAgent,
  inferLiveMatch,
  mergePresence,
  scoreLiveMatch,
  shouldRouteWorkingAgentToConsole,
} from './use-matrix3d-office-data'
import type { ActiveAgent } from '@/hooks/use-agent-view'
import type { CrewStatusAgent } from '@/lib/workspace-agents'
import type { StreamingState } from '@/stores/chat-store'

function crew(overrides: Partial<CrewStatusAgent>): CrewStatusAgent {
  return {
    id: 'neo',
    displayName: 'Neo',
    role: 'Profile',
    profileFound: true,
    gatewayState: 'unknown',
    processAlive: false,
    platforms: {},
    model: 'auto',
    provider: 'manifest',
    lastSessionTitle: null,
    lastSessionAt: null,
    sessionCount: 0,
    messageCount: 0,
    toolCallCount: 0,
    totalTokens: 0,
    estimatedCostUsd: null,
    cronJobCount: 0,
    assignedTaskCount: 0,
    activeDelegatedSessionKey: null,
    activeDelegatedParentSessionKey: null,
    activeDelegatedTitle: null,
    activeDelegatedLastActiveAt: null,
    ...overrides,
  }
}

function activeAgent(overrides: Partial<ActiveAgent>): ActiveAgent {
  return {
    id: '20260515_004611_da9981af',
    name: 'Hermes Switch UI',
    task: 'Investigating Matrix3D.',
    model: 'auto',
    status: 'running',
    progress: 0,
    startedAtMs: Date.now(),
    tokenCount: 0,
    estimatedCost: 0,
    isLive: true,
    ...overrides,
  }
}

describe('scoreLiveMatch', () => {
  it('prefers the live session whose task text describes the crew agent', () => {
    const roster = {
      id: 'neo',
      displayName: 'Neo',
      role: 'Infra health',
    }

    const matchingSession = activeAgent({
      id: '20260515_004611_da9981af',
      name: '🎨 Roger — Frontend Developer',
      task: 'Infra health. GREEN on gateway, logs, disk, Hindsight.',
      model: 'auto',
      status: 'running',
    })

    const unrelatedSession = activeAgent({
      id: '20260515_004611_xxxxxxxx',
      name: '🏗️ Sally — Backend Architect',
      task: 'Documenting dashboard routes and page ownership.',
      model: 'auto',
      status: 'running',
    })

    expect(scoreLiveMatch(roster, matchingSession)).toBeGreaterThan(
      scoreLiveMatch(roster, unrelatedSession),
    )
  })

  it('still rewards an exact live name match when present', () => {
    const roster = {
      id: 'trinity',
      displayName: 'Trinity',
      role: 'Hindsight deep dive',
    }

    const matchingSession = activeAgent({
      id: '20260515_004611_trinity',
      name: 'Trinity',
      task: 'Hindsight deep dive. 16,450 facts, 1.08M links.',
      model: 'auto',
      status: 'running',
    })

    const score = scoreLiveMatch(roster, matchingSession)
    expect(score).toBeGreaterThan(0)
  })

  it('does not bind the active Hermes workspace chat to a mentioned crew profile', () => {
    const neo = crew({})

    const activeHermesChat = activeAgent({
      id: '20260515_082812_543c16ef',
      name: 'Hermes Switch UI',
      task: 'All three are back: Neo infra health, Trinity deep dive, Morpheus architecture.',
      model: 'auto',
      status: 'running',
      progress: 35,
      tokenCount: 256_596,
    })

    expect(inferLiveMatch(neo, [activeHermesChat])).toBeNull()
  })

  it('marks a crew agent working when it has an active delegated child session', () => {
    const presence = mergePresence(
      [
        crew({
          activeDelegatedSessionKey: '20260528_223630_d0344c',
          activeDelegatedParentSessionKey: '20260528_222204_9ec629da',
          activeDelegatedTitle:
            'Go through the Hermes gateway/logs from the last 24 hours',
          activeDelegatedLastActiveAt: Date.now() / 1000,
        }),
      ],
      [],
      [],
      {},
      {},
    )

    expect(presence[0]).toMatchObject({
      id: 'neo',
      effectiveStatus: 'working',
      activeSessionKey: '20260528_223630_d0344c',
      activityScore: 5,
    })
  })

  it('routes only the hermes-switch profile to the console computer override', () => {
    expect(shouldRouteWorkingAgentToConsole({ id: 'hermes-switch' })).toBe(true)
    expect(shouldRouteWorkingAgentToConsole({ id: 'neo' })).toBe(false)
    expect(shouldRouteWorkingAgentToConsole({ id: 'trinity' })).toBe(false)
    expect(shouldRouteWorkingAgentToConsole({ id: 'morpheus' })).toBe(false)
  })

  it('rotates idle agents through the four leisure areas', () => {
    const areas = new Set(
      Array.from({ length: 4 }, (_, bucket) =>
        idleLeisureAreaForAgent('neo', bucket),
      ),
    )

    expect(areas).toEqual(new Set(['pingpong', 'sofa', 'gym', 'recreation']))
  })

  it('uses live tool activity for active Matrix3D speech bubbles', () => {
    const text = activeBubbleTextForPresence(
      {
        id: 'neo',
        effectiveStatus: 'working',
        lastActivity: 'Investigate gateway health',
        activeSessionKey: 'session-neo',
      },
      {
        runId: 'run-1',
        text: '',
        thinking: '',
        lifecycleEvents: [],
        toolCalls: [
          {
            id: 'tool-1',
            name: 'bash',
            phase: 'running',
            args: { command: 'pnpm vitest run matrix3d' },
            firstSeenAt: 100,
          },
        ],
      } satisfies StreamingState,
    )

    expect(text).toBe('Running bash: pnpm vitest run matrix3d')
  })

  it('describes Hermes active fallback as delegation instead of static working text', () => {
    const text = activeBubbleTextForPresence(
      {
        id: 'hermes-switch',
        effectiveStatus: 'working',
        lastActivity: 'Run backend audit with three delegated agents',
        activeSessionKey: 'session-hermes',
      },
      undefined,
    )

    expect(text).toBe('Delegating: Run backend audit with three delegated agents')
  })
})
