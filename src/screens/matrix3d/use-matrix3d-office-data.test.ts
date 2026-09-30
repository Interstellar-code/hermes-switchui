import { describe, expect, it } from 'vitest'
import {
  activeBubbleTextForPresence,
  formatSessionBadges,
  groupSessionBadges,
  idleLeisureAreaForAgent,
  inferActiveRoom,
  inferLiveMatch,
  mergePresence,
  scoreLiveMatch,
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
    isActive: false,
    activeSessionKey: null,
    activeSessionTitle: null,
    activeSessionLastActiveAt: null,
    activity: null,
    liveSessions: [],
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
          activeDelegatedLastActiveAt: Date.now(),
        }),
      ],
      [],
      [],
    )

    expect(presence[0]).toMatchObject({
      id: 'neo',
      effectiveStatus: 'working',
      activeSessionKey: '20260528_223630_d0344c',
    })
  })

  it('routes any agent by its state.db tool; local streaming still wins', () => {
    expect(inferActiveRoom(undefined, 'terminal').room).toBe('server')
    expect(
      inferActiveRoom(undefined, 'mcp_github_create_pull_request').room,
    ).toBe('github')
    expect(inferActiveRoom(undefined, 'web_search').room).toBe('desk')
    // No tool signal at all → desk (no hermes-switch console hardcode).
    expect(inferActiveRoom(undefined, null)).toEqual({
      room: 'desk',
      signal: 'no-tool-calls',
    })
    const streaming = {
      runId: 'r',
      text: '',
      thinking: '',
      lifecycleEvents: [],
      toolCalls: [
        { id: 't', name: 'run_vitest', phase: 'running', firstSeenAt: 1 },
      ],
    } as unknown as StreamingState
    expect(inferActiveRoom(streaming, 'terminal').room).toBe('qa')
  })

  it('groups live sub-sessions into badges by source', () => {
    const badges = groupSessionBadges([
      { id: 'a', source: 'subagent' },
      { id: 'b', source: 'delegate' },
      { id: 'a', source: 'subagent' },
      { id: 'c', source: 'a2a_fleet' },
      { id: 'd', source: 'kanban' },
      { id: 'e', source: 'cron' },
      { id: 'f', source: 'telegram' },
      { id: 'g', source: null },
    ])
    expect(badges).toEqual({ sub: 2, a2a: 1, kanban: 1, cron: 1 })
    expect(formatSessionBadges(badges)).toBe(
      'sub 2 · a2a 1 · kanban 1 · cron 1',
    )
    expect(formatSessionBadges({})).toBeNull()
  })

  it('puts gateway child sessions and live db sessions on the owner badge', () => {
    const [hermes] = mergePresence(
      [
        crew({
          id: 'hermes-switch',
          displayName: 'Hermes',
          isActive: true,
          activeSessionKey: 'parent-1',
          liveSessions: [
            { id: 'parent-1', source: 'telegram' },
            { id: 'cron-1', source: 'cron' },
            { id: 'child-1', source: 'subagent' },
          ],
        }),
      ],
      [],
      [
        activeAgent({ id: 'child-1', parentSessionId: 'parent-1' }),
        activeAgent({ id: 'child-2', parentSessionId: 'parent-1' }),
      ],
    )
    expect(hermes.badges).toEqual({ sub: 2, cron: 1 })
  })

  it('does not mark an agent working from counters or logs alone', () => {
    const [neo] = mergePresence(
      [
        crew({
          processAlive: true,
          gatewayState: 'running',
          assignedTaskCount: 3,
          lastSessionAt: Date.now() / 1000,
        }),
      ],
      [],
      [],
    )
    expect(neo.effectiveStatus).toBe('idle')
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
        effectiveStatus: 'working',
        activeSessionTitle: 'Investigate gateway health',
        isDelegating: false,
        activeSessionKey: 's1',
        activity: {
          sessionKey: 's1',
          description: 'terminal command running (111s elapsed)',
          at: null,
          tool: { name: 'terminal', argsPreview: 'pnpm test', at: Date.now() },
        },
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
      } as unknown as StreamingState,
    )

    expect(text).toBe('Running bash: pnpm vitest run matrix3d')
  })

  it('falls back to the active session title, not a model/status string', () => {
    const text = activeBubbleTextForPresence(
      {
        effectiveStatus: 'working',
        activeSessionTitle: `  Run backend audit ${'x'.repeat(80)}`,
        isDelegating: false,
        activeSessionKey: null,
        activity: null,
      },
      undefined,
    )

    expect(text?.startsWith('Run backend audit')).toBe(true)
    expect(text?.length).toBeLessThanOrEqual(60)
  })

  it('only says Delegating for a real running delegation (no hermes-switch hardcode)', () => {
    const [hermes] = mergePresence(
      [
        crew({
          id: 'hermes-switch',
          displayName: 'Hermes',
          isActive: true,
          activeSessionKey: 'parent-1',
          activeSessionTitle: 'Plan the release',
        }),
      ],
      [],
      [],
    )
    expect(activeBubbleTextForPresence(hermes, undefined)).toBe(
      'Plan the release',
    )

    const withChild = mergePresence(
      [
        crew({
          id: 'hermes-switch',
          displayName: 'Hermes',
          isActive: true,
          activeSessionKey: 'parent-1',
          activeSessionTitle: 'Plan the release',
        }),
        crew({
          activeDelegatedSessionKey: 'child-1',
          activeDelegatedParentSessionKey: 'parent-1',
          activeDelegatedTitle: 'Check gateway',
          activeDelegatedLastActiveAt: Date.now(),
        }),
      ],
      [],
      [],
    )
    expect(activeBubbleTextForPresence(withChild[0], undefined)).toBe(
      'Delegating: Plan the release',
    )
  })

  it('treats a stale delegated session as idle, not working', () => {
    const [neo] = mergePresence(
      [
        crew({
          activeDelegatedSessionKey: 'child-old',
          activeDelegatedParentSessionKey: 'parent-1',
          activeDelegatedTitle: 'Old work',
          activeDelegatedLastActiveAt: Date.now() - 3_600_000,
        }),
      ],
      [],
      [],
    )
    expect(neo.effectiveStatus).not.toBe('working')
    expect(neo.activeSessionKey).toBeNull()
  })

  it('never turns an unmatched live session into its own agent', () => {
    const child = activeAgent({
      id: 'child-9',
      name: '🎨 Roger — Frontend Developer',
      task: 'Something unrelated',
      parentSessionId: 'parent-1',
    })
    const byProfile = activeAgent({
      id: 'sess-42',
      name: 'Some session title',
      task: 'Something else',
      profile: 'trinity',
    })
    const orphan = activeAgent({
      id: 'orphan',
      name: 'Orphan session title',
      task: 'Nothing matches',
    })
    const presence = mergePresence(
      [
        crew({
          id: 'hermes-switch',
          displayName: 'Hermes',
          isActive: true,
          activeSessionKey: 'parent-1',
        }),
        crew({ id: 'trinity', displayName: 'Trinity' }),
      ],
      [],
      [child, byProfile, orphan],
    )

    expect(presence.map((p) => p.id)).toEqual(['hermes-switch', 'trinity'])
    expect(presence.map((p) => p.name)).toEqual(['Hermes', 'Trinity'])
    const [hermes, trinity] = presence
    expect(hermes.subSessionKeys).toContain('child-9')
    expect(hermes.isDelegating).toBe(true)
    expect(trinity.subSessionKeys).toEqual(['sess-42'])
  })

  it('bubble for non-local agents: db tool, then heartbeat, then title', () => {
    const base = {
      effectiveStatus: 'working' as const,
      activeSessionTitle: 'Nightly audit',
      isDelegating: false,
      activeSessionKey: 's1',
    }
    const activity = {
      sessionKey: 's1',
      description: 'terminal command running (111s elapsed)',
      at: null,
      tool: { name: 'terminal', argsPreview: 'pnpm test', at: 1_000_000 },
    }
    const now = 1_000_000 + 30_000
    expect(
      activeBubbleTextForPresence({ ...base, activity }, undefined, now),
    ).toBe('terminal: pnpm test')
    // A tool call older than ~60s is not current: fall back to the heartbeat.
    expect(
      activeBubbleTextForPresence(
        { ...base, activity },
        undefined,
        now + 60_000,
      ),
    ).toBe('terminal command running (111s elapsed)')
    // Empty (redacted/unsupported) args: tool name only.
    expect(
      activeBubbleTextForPresence(
        {
          ...base,
          activity: {
            ...activity,
            tool: { ...activity.tool, argsPreview: '' },
          },
        },
        undefined,
        now,
      ),
    ).toBe('terminal')
    expect(
      activeBubbleTextForPresence(
        { ...base, activity: { ...activity, tool: null } },
        undefined,
      ),
    ).toBe('terminal command running (111s elapsed)')
    expect(
      activeBubbleTextForPresence(
        { ...base, activity: { ...activity, tool: null, description: null } },
        undefined,
      ),
    ).toBe('Nightly audit')
    // Activity for a different (older) session is ignored.
    expect(
      activeBubbleTextForPresence(
        { ...base, activity: { ...activity, sessionKey: 'other' } },
        undefined,
      ),
    ).toBe('Nightly audit')
  })

  it('does not put the model or guessed progress in activity text', () => {
    const [neo] = mergePresence(
      [crew({ role: 'Infra health' })],
      [],
      [
        activeAgent({
          id: 'neo-session',
          name: 'Neo',
          task: 'Infra health checks for neo',
          model: 'auto',
          progress: 0,
        }),
      ],
    )
    expect(neo.lastActivity).not.toMatch(/auto|%/)
  })
})
