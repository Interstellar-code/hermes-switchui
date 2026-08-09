import { describe, expect, it } from 'vitest'

import {
  EMPTY_GATEWAY_ONBOARDING,
  pendingGatewayTips,
  readGatewayOnboarding,
  shouldOfferProfileBuild,
} from './gateway-onboarding'

describe('readGatewayOnboarding', () => {
  it('reads the seen flags the gateway writes', () => {
    const state = readGatewayOnboarding({
      onboarding: {
        seen: { busy_input_prompt: true, profile_build_offered: true },
      },
    })
    expect(state.present).toBe(true)
    expect(state.seen.busy_input_prompt).toBe(true)
    expect(state.seen.profile_build_offered).toBe(true)
    expect(state.seen.tool_progress_prompt).toBe(false)
  })

  it('reads the profile_build mode, defaulting anything unknown to ask', () => {
    // `agent/onboarding.py:profile_build_mode` — only the literal "off" turns
    // the offer off; everything else is "ask".
    expect(
      readGatewayOnboarding({ onboarding: { profile_build: 'off' } })
        .profileBuild,
    ).toBe('off')
    expect(
      readGatewayOnboarding({ onboarding: { profile_build: 'OFF' } })
        .profileBuild,
    ).toBe('off')
    expect(
      readGatewayOnboarding({ onboarding: { profile_build: 'whatever' } })
        .profileBuild,
    ).toBe('ask')
    expect(readGatewayOnboarding({ onboarding: {} }).profileBuild).toBe('ask')
  })

  it('degrades to "nothing seen" on a gateway too old to write the block', () => {
    // Which is the behaviour we had before this module existed, so an old
    // gateway is not a regression — it just gets the full set of prompts.
    for (const config of [null, undefined, {}, { onboarding: 'yes' }, 42]) {
      expect(readGatewayOnboarding(config)).toEqual(EMPTY_GATEWAY_ONBOARDING)
    }
  })
})

describe('shouldOfferProfileBuild', () => {
  it('offers when the agent has not yet made the offer itself', () => {
    expect(shouldOfferProfileBuild(EMPTY_GATEWAY_ONBOARDING)).toBe(true)
  })

  it('stays quiet once the agent has already offered in conversation', () => {
    const state = readGatewayOnboarding({
      onboarding: { seen: { profile_build_offered: true } },
    })
    expect(shouldOfferProfileBuild(state)).toBe(false)
  })

  it('stays quiet when the user turned the offer off', () => {
    // Re-pitching it in a settings surface would override a choice already
    // made, which is worse than a double prompt.
    const state = readGatewayOnboarding({
      onboarding: { profile_build: 'off' },
    })
    expect(shouldOfferProfileBuild(state)).toBe(false)
  })
})

describe('pendingGatewayTips', () => {
  it('offers only the hints the gateway has not already shown', () => {
    const fresh = pendingGatewayTips(EMPTY_GATEWAY_ONBOARDING)
    expect(fresh.map((tip) => tip.id)).toEqual([
      'busy_input_prompt',
      'tool_progress_prompt',
      'openclaw_residue_cleanup',
    ])

    const seenSome = readGatewayOnboarding({
      onboarding: {
        seen: { busy_input_prompt: true, openclaw_residue_cleanup: true },
      },
    })
    expect(pendingGatewayTips(seenSome).map((tip) => tip.id)).toEqual([
      'tool_progress_prompt',
    ])
  })

  it('goes silent once the agent has taught all of them', () => {
    const state = readGatewayOnboarding({
      onboarding: {
        seen: {
          busy_input_prompt: true,
          tool_progress_prompt: true,
          openclaw_residue_cleanup: true,
        },
      },
    })
    expect(pendingGatewayTips(state)).toEqual([])
  })
})
