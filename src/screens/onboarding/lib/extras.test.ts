import { describe, expect, it } from 'vitest'

import { buildExtras } from './extras'
import {
  EMPTY_GATEWAY_ONBOARDING,
  readGatewayOnboarding,
} from './gateway-onboarding'
import type { BuildExtrasInput } from './extras'

function input(overrides: Partial<BuildExtrasInput> = {}): BuildExtrasInput {
  return {
    gateway: EMPTY_GATEWAY_ONBOARDING,
    activeProfileName: null,
    activeMemoryProvider: null,
    enabledPluginCount: 0,
    corePluginCount: 0,
    themeLabel: null,
    ...overrides,
  }
}

describe('buildExtras', () => {
  it('gives every card a reason rather than only a label', () => {
    // The old wizard asked a first-time user to "choose an agent profile" with
    // no statement of what a profile was for.
    for (const card of buildExtras(input())) {
      expect(card.reason.length, card.id).toBeGreaterThan(20)
      expect(card.docs, card.id).toMatch(/^https:\/\//)
    }
  })

  it('covers the four the docs put after the first chat, plus theme', () => {
    expect(buildExtras(input()).map((card) => card.id)).toEqual([
      'profile',
      'memory',
      'plugins',
      'mcp',
      'skills',
      'theme',
    ])
  })

  it('reports what is already true, so a card can be skipped at a glance', () => {
    const cards = buildExtras(
      input({
        activeProfileName: 'Neo',
        activeMemoryProvider: 'Matrix Memory',
        enabledPluginCount: 2,
        corePluginCount: 5,
      }),
    )
    const byId = Object.fromEntries(cards.map((card) => [card.id, card]))
    expect(byId.profile.state).toContain('Neo')
    expect(byId.memory.state).toContain('Matrix Memory')
    expect(byId.plugins.state).toBe('2 of 5 enabled.')
  })

  it('suppresses the memory card once the agent has offered it in conversation', () => {
    const gateway = readGatewayOnboarding({
      onboarding: { seen: { profile_build_offered: true } },
    })
    const memory = buildExtras(input({ gateway })).find(
      (card) => card.id === 'memory',
    )
    expect(memory?.suppressedBy).toContain('already offered')
  })

  it('suppresses it differently when the user turned the offer off', () => {
    const gateway = readGatewayOnboarding({
      onboarding: { profile_build: 'off' },
    })
    const memory = buildExtras(input({ gateway })).find(
      (card) => card.id === 'memory',
    )
    expect(memory?.suppressedBy).toContain('onboarding.profile_build: off')
  })

  it('offers the memory card normally on a gateway that has said nothing', () => {
    const memory = buildExtras(input()).find((card) => card.id === 'memory')
    expect(memory?.suppressedBy).toBeUndefined()
  })

  it('routes the cards this wizard owns to steps, and the rest to screens', () => {
    const byId = Object.fromEntries(
      buildExtras(input()).map((card) => [card.id, card]),
    )
    expect(byId.profile.goTo).toBe('profile')
    expect(byId.memory.goTo).toBe('memory')
    expect(byId.plugins.goTo).toBe('plugins')
    expect(byId.theme.goTo).toBe('theme')
    // MCP and skills have no wizard step; they leave for the workspace route.
    expect(byId.mcp.goTo).toBeNull()
    expect(byId.mcp.href).toBe('/mcp')
    expect(byId.skills.goTo).toBeNull()
    expect(byId.skills.href).toBe('/skills')
  })
})
