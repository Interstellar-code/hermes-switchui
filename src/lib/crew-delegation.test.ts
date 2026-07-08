import { describe, expect, it } from 'vitest'
import {
  assignDelegatedSessions,
  emptyDelegatedAssignment,
} from './crew-delegation'
import type { CrewOwnActivity, DelegatedChildSession } from './crew-delegation'

const CREW_IDS = ['hermes-switch', 'morpheus', 'neo', 'trinity']

function ownActivity(
  overrides: Record<string, Partial<CrewOwnActivity>> = {},
): Record<string, CrewOwnActivity> {
  const base: Record<string, CrewOwnActivity> = {}
  for (const id of CREW_IDS) {
    base[id] = {
      isActive: false,
      activeSessionKey: null,
      activeSessionTitle: null,
      activeSessionLastActiveAt: null,
      ...overrides[id],
    }
  }
  return base
}

function session(
  sessionKey: string,
  lastActiveAt: number,
  extra: Partial<DelegatedChildSession> = {},
): DelegatedChildSession {
  return {
    sessionKey,
    parentSessionKey: 'parent-1',
    title: `Task ${sessionKey}`,
    lastActiveAt,
    ...extra,
  }
}

describe('assignDelegatedSessions', () => {
  it('returns an empty map when there are no delegated sessions', () => {
    const result = assignDelegatedSessions(CREW_IDS, [], ownActivity())
    expect(result).toEqual({})
  })

  it('excludes hermes-switch from avatar assignment', () => {
    const result = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100)],
      ownActivity(),
    )
    expect(result['hermes-switch']).toBeUndefined()
    // tier-2 sorted by id: morpheus, neo, trinity → first session → morpheus
    expect(result.morpheus.activeDelegatedSessionKey).toBe('s1')
  })

  it('round-robins sessions across tier-2 members deterministically', () => {
    const result = assignDelegatedSessions(
      CREW_IDS,
      // intentionally out of order — sorted by sessionKey before assignment
      [session('s3', 300), session('s1', 100), session('s2', 200)],
      ownActivity(),
    )
    // sorted sessionKeys: s1, s2, s3 → morpheus, neo, trinity
    expect(result.morpheus.activeDelegatedSessionKey).toBe('s1')
    expect(result.neo.activeDelegatedSessionKey).toBe('s2')
    expect(result.trinity.activeDelegatedSessionKey).toBe('s3')
  })

  it('produces stable assignment regardless of input order', () => {
    const a = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100), session('s2', 200)],
      ownActivity(),
    )
    const b = assignDelegatedSessions(
      CREW_IDS,
      [session('s2', 200), session('s1', 100)],
      ownActivity(),
    )
    expect(a).toEqual(b)
  })

  it('skips members whose own db is active (own-activity precedence)', () => {
    const result = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100), session('s2', 200)],
      ownActivity({ morpheus: { isActive: true } }),
    )
    // morpheus is busy with its own session → eligible: neo, trinity
    // stable-index probe: slot 0 (morpheus) skipped → neo gets s1, trinity gets s2
    expect(result.morpheus).toBeUndefined()
    expect(result.neo.activeDelegatedSessionKey).toBe('s1')
    expect(result.trinity.activeDelegatedSessionKey).toBe('s2')
  })

  it('keeps stable assignment when a member flips isActive', () => {
    // 3 sessions, all three tier-2 members eligible
    const allActive = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100), session('s2', 200), session('s3', 300)],
      ownActivity(),
    )
    // sorted sessions: s1→morpheus, s2→neo, s3→trinity
    expect(allActive.morpheus.activeDelegatedSessionKey).toBe('s1')
    expect(allActive.neo.activeDelegatedSessionKey).toBe('s2')
    expect(allActive.trinity.activeDelegatedSessionKey).toBe('s3')

    // morpheus flips isActive — its slot is skipped but remaining slots stay anchored
    const morpheusActive = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100), session('s2', 200), session('s3', 300)],
      ownActivity({ morpheus: { isActive: true } }),
    )
    expect(morpheusActive.morpheus).toBeUndefined()
    // neo and trinity each get one session; neo gets s1 (next eligible after morpheus's slot),
    // trinity gets s2; s3 lands on neo again — most recent (300 > 100) wins
    expect(morpheusActive.neo.activeDelegatedSessionKey).toBe('s3')
    expect(morpheusActive.trinity.activeDelegatedSessionKey).toBe('s2')
  })

  it('returns empty when every tier-2 member is own-active', () => {
    const result = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100)],
      ownActivity({
        morpheus: { isActive: true },
        neo: { isActive: true },
        trinity: { isActive: true },
      }),
    )
    expect(result).toEqual({})
  })

  it('keeps the most recent session when several land on one member', () => {
    // Two tier-2 members busy → only trinity eligible → both sessions round-robin
    // onto trinity; the most recent (higher lastActiveAt) must win.
    const result = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100), session('s2', 500)],
      ownActivity({
        morpheus: { isActive: true },
        neo: { isActive: true },
      }),
    )
    expect(result.trinity.activeDelegatedSessionKey).toBe('s2')
    expect(result.trinity.activeDelegatedLastActiveAt).toBe(500)
  })

  it('wrap-around: most-recent lastActiveAt wins when a member receives 2 sessions', () => {
    // 4 sessions, 3 eligible tier-2 members (morpheus, neo, trinity)
    // s1→morpheus, s2→neo, s3→trinity, s4 wraps back to morpheus
    // s4.lastActiveAt (999) > s1.lastActiveAt (100) → morpheus keeps s4
    const result = assignDelegatedSessions(
      CREW_IDS,
      [session('s1', 100), session('s2', 200), session('s3', 300), session('s4', 999)],
      ownActivity(),
    )
    expect(result.morpheus.activeDelegatedSessionKey).toBe('s4')
    expect(result.morpheus.activeDelegatedLastActiveAt).toBe(999)
    expect(result.neo.activeDelegatedSessionKey).toBe('s2')
    expect(result.trinity.activeDelegatedSessionKey).toBe('s3')
  })

  it('carries through session metadata into the assignment', () => {
    const result = assignDelegatedSessions(
      CREW_IDS,
      [
        session('s1', 100, {
          parentSessionKey: 'root-42',
          title: 'GithubAwesome triage',
        }),
      ],
      ownActivity(),
    )
    expect(result.morpheus).toEqual({
      activeDelegatedSessionKey: 's1',
      activeDelegatedParentSessionKey: 'root-42',
      activeDelegatedTitle: 'GithubAwesome triage',
      activeDelegatedLastActiveAt: 100,
    })
  })
})

describe('emptyDelegatedAssignment', () => {
  it('returns an all-null assignment', () => {
    expect(emptyDelegatedAssignment()).toEqual({
      activeDelegatedSessionKey: null,
      activeDelegatedParentSessionKey: null,
      activeDelegatedTitle: null,
      activeDelegatedLastActiveAt: null,
    })
  })
})
