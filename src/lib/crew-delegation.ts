/**
 * Pure (server-independent) assignment of anonymous delegated child sessions to
 * tier-2 crew members for the Matrix3D office.
 *
 * `delegate_task` tool-call args carry NO agent identity (verified 2026-06-10),
 * so delegated work runs as anonymous child sessions inside the hermes-switch
 * profile's own state.db. We can no longer attribute a child session to a named
 * crew member; instead we deterministically round-robin the active child
 * sessions across the tier-2 avatars (everyone except `hermes-switch`).
 *
 * Rules:
 *  - Tier-2 members = all crew except `hermes-switch`, sorted by id (stable).
 *  - A member whose OWN db shows recent activity (`isActive`) keeps its own
 *    session and is skipped for avatar assignment.
 *  - Active delegated sessions are sorted by sessionKey (stable), then
 *    round-robin assigned across the remaining members.
 *  - When several sessions land on the same member, the most recent (highest
 *    lastActiveAt) wins.
 */

export type CrewOwnActivity = {
  isActive: boolean
  activeSessionKey: string | null
  activeSessionTitle: string | null
  activeSessionLastActiveAt: number | null
}

export type DelegatedChildSession = {
  sessionKey: string
  parentSessionKey: string | null
  title: string | null
  lastActiveAt: number
}

export type DelegatedAssignment = {
  activeDelegatedSessionKey: string | null
  activeDelegatedParentSessionKey: string | null
  activeDelegatedTitle: string | null
  activeDelegatedLastActiveAt: number | null
}

export const HERMES_SWITCH_ID = 'hermes-switch'

export function emptyDelegatedAssignment(): DelegatedAssignment {
  return {
    activeDelegatedSessionKey: null,
    activeDelegatedParentSessionKey: null,
    activeDelegatedTitle: null,
    activeDelegatedLastActiveAt: null,
  }
}

/**
 * Deterministically assign active delegated child sessions to tier-2 crew
 * members. Returns a map of crew id → assignment (only members that received a
 * session appear in the map).
 */
export function assignDelegatedSessions(
  crewIds: Array<string>,
  delegatedSessions: Array<DelegatedChildSession>,
  ownActivity: Record<string, CrewOwnActivity>,
): Record<string, DelegatedAssignment> {
  const tierTwo = crewIds
    .filter((id) => id !== HERMES_SWITCH_ID)
    .sort((a, b) => a.localeCompare(b))

  const result: Record<string, DelegatedAssignment> = {}

  const sortedSessions = [...delegatedSessions].sort((a, b) =>
    a.sessionKey.localeCompare(b.sessionKey),
  )

  if (sortedSessions.length === 0) return result

  // Stable index: iterate over the full sorted tier-two list (not just eligible)
  // so that a member toggling isActive doesn't shift every downstream assignment.
  // Members that are own-active keep their slot in the modulo ring but receive
  // no delegated assignment — we simply skip assigning to them and probe forward
  // to the next non-active member deterministically.
  let probe = 0 // position in tierTwo (full list, stable anchor)
  for (const session of sortedSessions) {
    // Find the next eligible slot starting from position (probe % tierTwo.length)
    let found = false
    for (let attempt = 0; attempt < tierTwo.length; attempt++) {
      const candidateId = tierTwo[(probe + attempt) % tierTwo.length]
      if (!ownActivity[candidateId].isActive) {
        const hadExisting = Object.hasOwn(result, candidateId)
        const existing = hadExisting ? result[candidateId] : undefined
        // When several sessions land on the same member, keep the most recent.
        if (
          !hadExisting ||
          (existing && existing.activeDelegatedLastActiveAt < session.lastActiveAt)
        ) {
          result[candidateId] = {
            activeDelegatedSessionKey: session.sessionKey,
            activeDelegatedParentSessionKey: session.parentSessionKey,
            activeDelegatedTitle: session.title,
            activeDelegatedLastActiveAt: session.lastActiveAt,
          }
        }
        // Advance probe past this slot for the next session
        probe = (probe + attempt + 1) % tierTwo.length
        found = true
        break
      }
    }
    if (!found) {
      // All tier-two members are own-active — nothing to assign
      break
    }
  }

  return result
}
