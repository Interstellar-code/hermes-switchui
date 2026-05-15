import { describe, expect, it } from 'vitest'
import { inferLiveMatch, scoreLiveMatch } from './use-matrix3d-office-data'

describe('scoreLiveMatch', () => {
  it('prefers the live session whose task text describes the crew agent', () => {
    const roster = {
      id: 'neo',
      displayName: 'Neo',
      role: 'Infra health',
    }

    const matchingSession = {
      id: '20260515_004611_da9981af',
      name: '🎨 Roger — Frontend Developer',
      task: 'Infra health. GREEN on gateway, logs, disk, Hindsight.',
      model: 'auto',
      status: 'running',
    }

    const unrelatedSession = {
      id: '20260515_004611_xxxxxxxx',
      name: '🏗️ Sally — Backend Architect',
      task: 'Documenting dashboard routes and page ownership.',
      model: 'auto',
      status: 'running',
    }

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

    const matchingSession = {
      id: '20260515_004611_trinity',
      name: 'Trinity',
      task: 'Hindsight deep dive. 16,450 facts, 1.08M links.',
      model: 'auto',
      status: 'running',
    }

    const score = scoreLiveMatch(roster, matchingSession)
    expect(score).toBeGreaterThan(0)
  })

  it('does not bind the active Hermes workspace chat to a mentioned crew profile', () => {
    const neo = {
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
    }

    const activeHermesChat = {
      id: '20260515_082812_543c16ef',
      name: 'Hermes Switch UI',
      task: 'All three are back: Neo infra health, Trinity deep dive, Morpheus architecture.',
      model: 'auto',
      status: 'running',
      progress: 35,
      startedAtMs: Date.now(),
      tokenCount: 256_596,
      estimatedCost: 0,
      isLive: true,
    }

    expect(inferLiveMatch(neo, [activeHermesChat])).toBeNull()
  })
})
