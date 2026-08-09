import { describe, expect, it } from 'vitest'

import {
  activationNeedsRestart,
  canActivateRow,
  canCloneRow,
  canDeleteRow,
  canEditRow,
  canRenameRow,
  emptyStateVariant,
  nextGridIndex,
  profileToRow,
} from './profiles-screen'
import type { ProfileSummary } from '@/server/profiles-browser'

function summary(patch: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    name: 'custom-agent',
    path: '/home/u/.hermes/profiles/custom-agent',
    active: false,
    exists: true,
    skillCount: 0,
    sessionCount: 0,
    hasEnv: false,
    status: 'draft',
    ...patch,
  }
}

describe('profileToRow — P-06 / P-12 wiring', () => {
  it('takes status from the derived server field, not agent_ui.status', () => {
    const r = profileToRow(
      summary({ status: 'active', agent_ui: { status: 'draft' } }),
    )
    expect(r.status).toBe('active')
  })

  it('reports idle even when agent_ui claims the profile is active', () => {
    const r = profileToRow(
      summary({ status: 'idle', agent_ui: { status: 'active' } }),
    )
    expect(r.status).toBe('idle')
  })

  it('ignores the hardcoded built-in status and uses the derived one', () => {
    // BUILTIN_AGENTS marks all four built-ins `active`; only one profile can be.
    const r = profileToRow(summary({ name: 'neo', status: 'idle' }))
    expect(r.builtin).toBe(true)
    expect(r.status).toBe('idle')
  })

  it('takes lastRunAt from the derived field, not the inert agent_ui.last_run', () => {
    const r = profileToRow(
      summary({ lastRunAt: 1_700_000_000, agent_ui: { last_run: 42 } }),
    )
    expect(r.lastRunAt).toBe(1_700_000_000)
  })

  it('keeps lastRunAt in unix SECONDS (not milliseconds)', () => {
    // A seconds-scale value must stay seconds-scale — a ms/s mix-up here would
    // make `formatRelative` render "56y ago" for a run from this morning.
    const nowSeconds = Math.floor(Date.now() / 1000)
    const r = profileToRow(summary({ lastRunAt: nowSeconds }))
    expect(r.lastRunAt).toBe(nowSeconds)
  })

  it('falls back to null when the profile has never run', () => {
    expect(profileToRow(summary({ lastRunAt: null })).lastRunAt).toBeNull()
    expect(profileToRow(summary({})).lastRunAt).toBeNull()
  })

  it('surfaces the counts the list API already returned (G-02)', () => {
    const r = profileToRow(
      summary({ skillCount: 7, sessionCount: 3, hasEnv: true }),
    )
    expect(r.skillCount).toBe(7)
    expect(r.sessionCount).toBe(3)
    expect(r.hasEnv).toBe(true)
    expect(r.path).toBe('/home/u/.hermes/profiles/custom-agent')
  })

  it('still prefers agent_ui for presentation metadata', () => {
    const r = profileToRow(
      summary({ agent_ui: { glyph: 'ZZ', role: 'Tester', tier: 2, tags: ['qa'] } }),
    )
    expect(r).toMatchObject({ glyph: 'ZZ', role: 'Tester', tier: 2, tags: ['qa'] })
  })
})

describe('action gating — P-07', () => {
  const builtin = profileToRow(summary({ name: 'neo', status: 'idle' }))
  const custom = profileToRow(summary({ name: 'custom-agent', status: 'idle' }))
  const activeCustom = profileToRow(summary({ name: 'custom-agent', status: 'active' }))

  it('never offers rename or delete on a built-in — the server 403s both', () => {
    expect(canRenameRow(builtin)).toBe(false)
    expect(canDeleteRow(builtin)).toBe(false)
  })

  it('still offers edit and clone on a built-in', () => {
    expect(canEditRow(builtin)).toBe(true)
    expect(canCloneRow(builtin)).toBe(true)
  })

  it('offers rename and delete on a user-created profile', () => {
    expect(canRenameRow(custom)).toBe(true)
    expect(canDeleteRow(custom)).toBe(true)
  })

  it('offers activate only when the profile is not already active', () => {
    expect(canActivateRow(custom)).toBe(true)
    expect(canActivateRow(activeCustom)).toBe(false)
  })

  it('never offers delete on the active profile — the server rejects that too', () => {
    expect(canDeleteRow(activeCustom)).toBe(false)
  })

  it('offers nothing on the synthetic default row', () => {
    const def = profileToRow(summary({ name: 'default', status: 'active' }))
    expect(canActivateRow(def)).toBe(false)
    expect(canEditRow(def)).toBe(false)
    expect(canCloneRow(def)).toBe(false)
    expect(canRenameRow(def)).toBe(false)
    expect(canDeleteRow(def)).toBe(false)
  })

  it('gates on the derived status, not on a stale agent_ui.status', () => {
    const stale = profileToRow(
      summary({ name: 'custom-agent', status: 'idle', agent_ui: { status: 'active' } }),
    )
    expect(canActivateRow(stale)).toBe(true)
    expect(canDeleteRow(stale)).toBe(true)
  })
})

describe('emptyStateVariant — P-14', () => {
  it('says "no agents yet" only when there are genuinely no rows', () => {
    expect(emptyStateVariant(0)).toBe('no-agents')
  })

  it('says "no matches" when rows exist but the filter excluded them all', () => {
    expect(emptyStateVariant(1)).toBe('no-matches')
    expect(emptyStateVariant(12)).toBe('no-matches')
  })

  it('regression: a fresh install of only built-ins is not "no agents yet"', () => {
    // The old branch counted `tier === 3` rows, so four Tier-1/2 built-ins and
    // a non-matching search produced "No agents yet — create your first agent".
    const builtinsOnly = ['hermes-switch', 'neo', 'trinity', 'morpheus'].map((name) =>
      profileToRow(summary({ name })),
    )
    expect(builtinsOnly.every((r) => r.tier < 3)).toBe(true)
    expect(emptyStateVariant(builtinsOnly.length)).toBe('no-matches')
  })
})

describe('activationNeedsRestart — attach the prompt to the mismatch, not the click (W3)', () => {
  it('needs no restart when the multiplexer already serves the activated profile', () => {
    expect(
      activationNeedsRestart(
        { mode: 'multiplex', servedProfiles: ['default', 'neo'] },
        'neo',
      ),
    ).toBe(false)
  })

  it('needs a restart when multiplexed but this profile is not yet in the roster', () => {
    expect(
      activationNeedsRestart(
        { mode: 'multiplex', servedProfiles: ['default'] },
        'neo',
      ),
    ).toBe(true)
  })

  it('needs no restart re-activating the profile a single gateway already runs', () => {
    expect(
      activationNeedsRestart(
        { mode: 'single', servingProfile: 'hermes-switch' },
        'hermes-switch',
      ),
    ).toBe(false)
  })

  it('needs a restart when a single gateway is running a different profile', () => {
    expect(
      activationNeedsRestart(
        { mode: 'single', servingProfile: 'hermes-switch' },
        'neo',
      ),
    ).toBe(true)
  })

  it('fails closed (needs restart) when topology is unknown', () => {
    expect(activationNeedsRestart({ mode: 'unknown' }, 'neo')).toBe(true)
  })

  it('fails closed (needs restart) when the scope payload itself is missing', () => {
    expect(activationNeedsRestart(null, 'neo')).toBe(true)
    expect(activationNeedsRestart(undefined, 'neo')).toBe(true)
  })

  it('treats a missing servedProfiles array as empty, not as "everything served"', () => {
    expect(activationNeedsRestart({ mode: 'multiplex' }, 'neo')).toBe(true)
  })
})

describe('nextGridIndex — arrow keys across the card grid (P-16)', () => {
  // A 3-wide grid holding 8 cards:
  //   0 1 2
  //   3 4 5
  //   6 7
  const COUNT = 8
  const COLS = 3
  const move = (from: number, key: string) =>
    nextGridIndex(from, COUNT, COLS, key)

  it('steps along a row', () => {
    expect(move(0, 'ArrowRight')).toBe(1)
    expect(move(1, 'ArrowLeft')).toBe(0)
  })

  it('steps between rows by a full row width', () => {
    expect(move(1, 'ArrowDown')).toBe(4)
    expect(move(4, 'ArrowUp')).toBe(1)
  })

  it('clamps at the edges rather than wrapping', () => {
    // Wrapping would jump the eye across the whole grid; standing still is the
    // honest answer at a boundary.
    expect(move(0, 'ArrowLeft')).toBe(0)
    expect(move(0, 'ArrowUp')).toBe(0)
    expect(move(2, 'ArrowUp')).toBe(2)
    expect(move(COUNT - 1, 'ArrowRight')).toBe(COUNT - 1)
    expect(move(COUNT - 1, 'ArrowDown')).toBe(COUNT - 1)
  })

  it('lands on the last card when the row below is short', () => {
    // Index 5 is above an empty cell; the nearest real target is the last card.
    expect(move(5, 'ArrowDown')).toBe(7)
  })

  it('jumps to the ends with Home and End', () => {
    expect(move(4, 'Home')).toBe(0)
    expect(move(4, 'End')).toBe(COUNT - 1)
  })

  it('does not move for a key it does not own', () => {
    expect(move(4, 'Enter')).toBe(4)
    expect(move(4, 'a')).toBe(4)
  })

  it('survives a degenerate grid', () => {
    expect(nextGridIndex(0, 0, 3, 'ArrowRight')).toBe(0)
    expect(nextGridIndex(0, 1, 0, 'ArrowDown')).toBe(0)
    expect(nextGridIndex(0, 4, 1, 'ArrowDown')).toBe(1)
  })

  it('reaches every card on a full 96-card page', () => {
    // Tab alone needs 96 stops to cross the grid; arrows need 4 down + 11 right.
    let index = 0
    for (let i = 0; i < 4; i++) index = nextGridIndex(index, 96, 12, 'ArrowDown')
    for (let i = 0; i < 11; i++) index = nextGridIndex(index, 96, 12, 'ArrowRight')
    expect(index).toBe(59)
    expect(nextGridIndex(index, 96, 12, 'End')).toBe(95)
  })
})
