// @vitest-environment node
/**
 * The contract this module exists to keep: the real `/api/profiles/list` shape
 * yields the four seeded built-ins with their glyph/tier/role intact, the
 * synthetic `default` row survives (the Agents screen drops it; an activation
 * picker must not), and no payload — however malformed — can throw or leave
 * the list with nothing marked active.
 */
import { describe, expect, it } from 'vitest'
import { activeProfileLabel, buildProfileChoices } from './profile-choices'

/**
 * The literal body this machine's `/api/profiles/list` returns: four seeded
 * built-ins plus the synthetic `default` row the server unshifts whenever
 * `~/.hermes/active_profile` is absent.
 */
const REAL_PAYLOAD = {
  activeProfile: 'default',
  profiles: [
    {
      name: 'default',
      path: '/home/user/.hermes',
      active: true,
      exists: true,
      model: 'auto',
      provider: 'manifest',
      skillCount: 0,
      sessionCount: 3,
      hasEnv: true,
    },
    {
      name: 'hermes-switch',
      path: '/home/user/.hermes/profiles/hermes-switch',
      active: false,
      exists: true,
      model: 'auto',
      provider: 'manifest',
      skillCount: 0,
      sessionCount: 0,
      hasEnv: false,
      description: 'Routes tasks across the Tier-2 archetypes.',
      agent_ui: {
        tier: 1,
        glyph: 'HS',
        role: 'Orchestrator',
        status: 'active',
        tags: ['orchestrator', 'router'],
        persona_id: null,
        last_run: null,
      },
    },
    {
      name: 'neo',
      path: '/home/user/.hermes/profiles/neo',
      active: false,
      exists: true,
      model: 'auto',
      skillCount: 0,
      sessionCount: 0,
      hasEnv: false,
      description: 'Implements features. Acts decisively.',
      agent_ui: { tier: 2, glyph: 'NE', role: 'Builder' },
    },
    {
      name: 'trinity',
      path: '/home/user/.hermes/profiles/trinity',
      active: false,
      exists: true,
      model: 'auto',
      skillCount: 0,
      sessionCount: 0,
      hasEnv: false,
      description: 'Debugs and traces. Verifies edges.',
      agent_ui: { tier: 2, glyph: 'TR', role: 'Investigator' },
    },
    {
      name: 'morpheus',
      path: '/home/user/.hermes/profiles/morpheus',
      active: false,
      exists: true,
      model: 'auto',
      skillCount: 0,
      sessionCount: 0,
      hasEnv: false,
      description: 'Designs and reviews. Long-term coherence.',
      agent_ui: { tier: 2, glyph: 'MO', role: 'Architect' },
    },
  ],
}

/**
 * What the server sends once a named profile *is* active: no synthetic row at
 * all, because it would duplicate that profile's identity in the Agents grid.
 */
const NAMED_ACTIVE_PAYLOAD = {
  activeProfile: 'neo',
  profiles: REAL_PAYLOAD.profiles.filter((row) => row.name !== 'default'),
}

describe('buildProfileChoices', () => {
  it('reads the four seeded built-ins with glyph, tier and role intact', () => {
    const byName = new Map(
      buildProfileChoices(REAL_PAYLOAD).map((choice) => [choice.name, choice]),
    )

    expect(byName.get('hermes-switch')).toMatchObject({
      label: 'Hermes Switch',
      glyph: 'HS',
      tier: 1,
      role: 'Orchestrator',
      isBuiltin: true,
      isDefault: false,
    })
    expect(byName.get('neo')).toMatchObject({
      label: 'Neo',
      glyph: 'NE',
      tier: 2,
      role: 'Builder',
      isBuiltin: true,
    })
    expect(byName.get('trinity')).toMatchObject({
      glyph: 'TR',
      tier: 2,
      role: 'Investigator',
    })
    expect(byName.get('morpheus')).toMatchObject({
      glyph: 'MO',
      tier: 2,
      role: 'Architect',
    })
    expect(byName.get('neo')?.model).toBe('auto')
  })

  it("keeps the synthetic default row and marks it active on activeProfile: 'default'", () => {
    // The Agents screen filters this row out. Doing that here would render
    // four cards with none marked active on every install that has never
    // written `~/.hermes/active_profile` — the common case, and this machine.
    const choices = buildProfileChoices(REAL_PAYLOAD)
    const active = choices.filter((choice) => choice.isActive)

    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({
      name: 'default',
      label: 'Default',
      isDefault: true,
      isBuiltin: false,
      tier: null,
    })
    expect(active[0].description).toMatch(/root ~\/\.hermes\/config\.yaml/)
    expect(choices).toHaveLength(5)
  })

  it('treats an absent activeProfile as default, and still offers the card', () => {
    // No pointer file → the gateway runs the root config, so an omitted
    // `activeProfile` means exactly the same thing as `'default'`.
    for (const payload of [
      { profiles: NAMED_ACTIVE_PAYLOAD.profiles },
      { profiles: NAMED_ACTIVE_PAYLOAD.profiles, activeProfile: '' },
      { profiles: NAMED_ACTIVE_PAYLOAD.profiles, activeProfile: '   ' },
    ]) {
      const choices = buildProfileChoices(payload)
      const active = choices.filter((choice) => choice.isActive)
      expect(active).toHaveLength(1)
      expect(active[0].name).toBe('default')
      expect(active[0].isDefault).toBe(true)
      // Synthesised, since the server only emits the row when it is active.
      expect(choices).toHaveLength(5)
    }
  })

  it('marks the named profile active and still lists Default as a choice', () => {
    const choices = buildProfileChoices(NAMED_ACTIVE_PAYLOAD)
    expect(
      choices.filter((choice) => choice.isActive).map((c) => c.name),
    ).toEqual(['neo'])
    // Switching *back* to the root config has to remain reachable.
    expect(choices.some((choice) => choice.isDefault)).toBe(true)
  })

  it('orders the active choice first, then tier 1, then tier 2, then the rest', () => {
    expect(buildProfileChoices(REAL_PAYLOAD).map((c) => c.name)).toEqual([
      'default',
      'hermes-switch',
      'neo',
      'trinity',
      'morpheus',
    ])

    expect(
      buildProfileChoices(NAMED_ACTIVE_PAYLOAD).map((c) => c.name),
    ).toEqual(['neo', 'hermes-switch', 'trinity', 'morpheus', 'default'])
  })

  it('keeps the API order stable within a band', () => {
    const choices = buildProfileChoices({
      activeProfile: 'default',
      profiles: [
        { name: 'zeta', agent_ui: { tier: 2 } },
        { name: 'alpha', agent_ui: { tier: 2 } },
        { name: 'omega', agent_ui: { tier: 3 } },
      ],
    })
    expect(choices.map((c) => c.name)).toEqual([
      'default',
      'zeta',
      'alpha',
      'omega',
    ])
  })

  it('falls back to a monogram, no tier and no role for an unknown profile', () => {
    const choices = buildProfileChoices({
      activeProfile: 'default',
      profiles: [{ name: 'my-custom-agent' }],
    })
    const custom = choices.find((choice) => choice.name === 'my-custom-agent')
    expect(custom).toMatchObject({
      label: 'my-custom-agent',
      glyph: 'MY',
      tier: null,
      role: null,
      description: '',
      model: null,
      isBuiltin: false,
    })
  })

  it("prefers the profile's own agent_ui over the builtin defaults", () => {
    const choices = buildProfileChoices({
      activeProfile: 'default',
      profiles: [
        {
          name: 'neo',
          description: 'Rewritten by the user.',
          model: 'anthropic/claude-x',
          agent_ui: { tier: 3, glyph: 'NX', role: 'Renamed' },
        },
      ],
    })
    expect(choices.find((c) => c.name === 'neo')).toMatchObject({
      glyph: 'NX',
      tier: 3,
      role: 'Renamed',
      description: 'Rewritten by the user.',
      model: 'anthropic/claude-x',
      isBuiltin: true,
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not json'],
    ['a number', 7],
    ['an array', []],
    ['an empty object', {}],
    ['a 401 body', { error: 'Unauthorized' }],
    ['a 500 body', { error: 'Failed to list profiles', profiles: [] }],
    ['garbage-shaped fields', { profiles: 'nope', activeProfile: 42 }],
    ['null rows', { profiles: [null, 3, {}, { name: '' }] }],
    ['a nameless row', { profiles: [{ path: '/x', active: true }] }],
  ])('degrades to a sane list on %s, and never throws', (_label, payload) => {
    const choices = buildProfileChoices(payload)
    expect(choices.length).toBeGreaterThanOrEqual(1)
    expect(choices.some((choice) => choice.isDefault)).toBe(true)
    // Something is always running, so something is always marked.
    expect(choices.filter((choice) => choice.isActive)).toHaveLength(1)
  })

  it('falls back to Default when the pointer names a profile that is gone', () => {
    const choices = buildProfileChoices({
      activeProfile: 'deleted-agent',
      profiles: [{ name: 'neo', agent_ui: { tier: 2 } }],
    })
    expect(choices.filter((c) => c.isActive).map((c) => c.name)).toEqual([
      'default',
    ])
  })

  it('never emits the same profile twice', () => {
    const choices = buildProfileChoices({
      activeProfile: 'default',
      profiles: [{ name: 'neo' }, { name: 'neo' }, { name: 'default' }],
    })
    expect(choices.map((c) => c.name)).toEqual(['default', 'neo'])
  })
})

describe('activeProfileLabel', () => {
  it('names the active choice', () => {
    expect(activeProfileLabel(buildProfileChoices(REAL_PAYLOAD))).toBe(
      'Default',
    )
    expect(activeProfileLabel(buildProfileChoices(NAMED_ACTIVE_PAYLOAD))).toBe(
      'Neo',
    )
  })

  it('is null when nothing has landed yet', () => {
    expect(activeProfileLabel([])).toBeNull()
  })
})
