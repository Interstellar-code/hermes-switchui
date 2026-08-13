import { describe, expect, it } from 'vitest'

import {
  buildChecklist,
  outstandingCount,
  outstandingRequiredCount,
} from './checklist'
import { ONBOARDING_DRAFT_VERSION } from './onboarding-storage'
import type { BuildChecklistInput } from './checklist'
import type { OnboardingDraft, OnboardingOutcome } from './onboarding-storage'
import type { ProfileServabilityResult } from './profile-servability'

function draft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    branch: 'main',
    stepId: 'plugins',
    providerId: 'anthropic',
    baseUrl: '',
    envKey: '',
    defaultModel: '',
    makeActive: true,
    themeId: null,
    skipped: [],
    completed: [],
    savedAt: 0,
    ...overrides,
  }
}

const FRESH: OnboardingOutcome = { kind: 'fresh' }

function input(
  overrides: Partial<BuildChecklistInput> = {},
): BuildChecklistInput {
  return {
    outcome: FRESH,
    draft: draft(),
    activeProvider: null,
    gatewayReachable: null,
    chatProven: false,
    agentCwd: null,
    agentCwdExplicit: false,
    pluginsTouched: false,
    profileTouched: false,
    memoryTouched: false,
    themeChosen: false,
    profileServability: null,
    ...overrides,
  }
}

function stateOf(items: ReturnType<typeof buildChecklist>, id: string) {
  return items.find((entry) => entry.id === id)?.state
}

describe('buildChecklist', () => {
  it('lists the four required items first, and flags them as required', () => {
    const items = buildChecklist(input())
    expect(items.slice(0, 4).map((entry) => entry.id)).toEqual([
      'connect',
      'provider',
      'workspace',
      'chat',
    ])
    expect(items.slice(0, 4).every((entry) => entry.required)).toBe(true)
    expect(items.slice(4).some((entry) => entry.required)).toBe(false)
  })

  it('provider is done when there is an active provider', () => {
    const items = buildChecklist(input({ activeProvider: 'anthropic' }))
    expect(stateOf(items, 'provider')).toBe('done')
  })

  it('provider is todo, never skipped, even if listed in draft.skipped', () => {
    const items = buildChecklist(
      input({ draft: draft({ skipped: ['provider'] }), activeProvider: null }),
    )
    expect(stateOf(items, 'provider')).toBe('todo')
  })

  it('chat is blocked while there is no active provider', () => {
    expect(stateOf(buildChecklist(input()), 'chat')).toBe('blocked')
  })

  it('chat is todo once a provider exists, and done once a completion succeeds', () => {
    expect(
      stateOf(buildChecklist(input({ activeProvider: 'anthropic' })), 'chat'),
    ).toBe('todo')
    expect(
      stateOf(
        buildChecklist(
          input({ activeProvider: 'anthropic', chatProven: true }),
        ),
        'chat',
      ),
    ).toBe('done')
  })

  it('blocks every optional item until the chat has been settled', () => {
    // The same rule the step table enforces, applied to the list the dashboard
    // card renders: inviting a user to "set up memory" on an install that
    // cannot complete a sentence is the twelve-step wizard's mistake, smaller.
    const items = buildChecklist(input({ activeProvider: 'anthropic' }))
    for (const id of ['profile', 'memory', 'plugins', 'theme']) {
      expect(stateOf(items, id), id).toBe('blocked')
    }
  })

  it('unblocks the optional items once a completion has succeeded', () => {
    const items = buildChecklist(
      input({ activeProvider: 'anthropic', chatProven: true }),
    )
    for (const id of ['profile', 'memory', 'plugins', 'theme']) {
      expect(stateOf(items, id), id).toBe('todo')
    }
  })

  it('unblocks the optional items when the chat step was explicitly skipped', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        draft: draft({ skipped: ['chat'] }),
      }),
    )
    expect(stateOf(items, 'chat')).toBe('skipped')
    expect(stateOf(items, 'profile')).toBe('todo')
  })

  // ── connect ───────────────────────────────────────────────────────────────

  it('connect reports "not checked" rather than a failure when nothing probed', () => {
    const items = buildChecklist(input({ gatewayReachable: null }))
    expect(stateOf(items, 'connect')).toBe('todo')
    expect(items.find((entry) => entry.id === 'connect')?.detail).toContain(
      'Not checked',
    )
  })

  it('connect is done when the gateway answered', () => {
    expect(
      stateOf(buildChecklist(input({ gatewayReachable: true })), 'connect'),
    ).toBe('done')
  })

  // ── workspace ─────────────────────────────────────────────────────────────

  it('workspace is done only when terminal.cwd was set explicitly', () => {
    const fallback = buildChecklist(
      input({ agentCwd: '/home/tester', agentCwdExplicit: false }),
    )
    expect(stateOf(fallback, 'workspace')).toBe('todo')
    expect(
      fallback.find((entry) => entry.id === 'workspace')?.detail,
    ).toContain('Falling back to /home/tester')

    const explicit = buildChecklist(
      input({ agentCwd: '/srv/code', agentCwdExplicit: true }),
    )
    expect(stateOf(explicit, 'workspace')).toBe('done')
    expect(
      explicit.find((entry) => entry.id === 'workspace')?.detail,
    ).toContain('/srv/code')
  })

  // ── theme ─────────────────────────────────────────────────────────────────

  it('theme is done from the live signal alone, with nothing in completed', () => {
    // The completion record is only ever written by a wizard run. An install
    // that settled via the legacy flag or auto-detection carries
    // `completed: []` forever, so this item had no way to notice a theme.
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: true,
        themeChosen: true,
      }),
    )
    expect(stateOf(items, 'theme')).toBe('done')
    expect(items.find((entry) => entry.id === 'theme')?.detail).toBe('Chosen.')
  })

  it('theme still honours the completion record when no live signal exists', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: true,
        themeChosen: false,
        draft: draft({ completed: ['theme'] }),
      }),
    )
    expect(stateOf(items, 'theme')).toBe('done')
  })

  // ── the persisted record stands in for live probes ────────────────────────

  it('falls back to the completion record once the draft is gone', () => {
    const outcome: OnboardingOutcome = {
      kind: 'complete',
      at: 1,
      branch: 'main',
      skipped: ['theme'],
      completed: ['connect', 'chat', 'workspace', 'plugins'],
    }
    const items = buildChecklist(
      input({ outcome, draft: null, activeProvider: 'anthropic' }),
    )
    expect(stateOf(items, 'connect')).toBe('done')
    expect(stateOf(items, 'chat')).toBe('done')
    expect(stateOf(items, 'workspace')).toBe('done')
    expect(stateOf(items, 'plugins')).toBe('done')
    expect(stateOf(items, 'theme')).toBe('skipped')
  })

  it('prefers the draft over the completion record while a run is in flight', () => {
    const outcome: OnboardingOutcome = {
      kind: 'complete',
      at: 1,
      branch: 'main',
      skipped: [],
      completed: ['plugins'],
    }
    const items = buildChecklist(
      input({
        outcome,
        draft: draft({ completed: [], skipped: ['plugins'] }),
        activeProvider: 'anthropic',
        chatProven: true,
      }),
    )
    expect(stateOf(items, 'plugins')).toBe('skipped')
  })
})

describe('buildChecklist — profile servability', () => {
  const UNREACHABLE_SINGLE: ProfileServabilityResult = {
    kind: 'unreachable',
    unreachable: ['hermes-switch'],
    detail:
      'Only "default" is reachable right now. This gateway is not ' +
      'multiplexed, so "hermes-switch" would be refused the moment you ' +
      'tried to send to them.',
    remediation:
      'Run `hermes config set gateway.multiplex_profiles true`, then ' +
      'restart the gateway so one process can reach every profile.',
  }
  const UNREACHABLE_MULTIPLEX: ProfileServabilityResult = {
    kind: 'unreachable',
    unreachable: ['morpheus'],
    detail: 'Multiplexing is on, but "morpheus" isn\'t in the served list.',
    remediation: 'Check the gateway startup log for "morpheus".',
  }
  const INDETERMINATE: ProfileServabilityResult = {
    kind: 'indeterminate',
    detail:
      '2 agent profiles exist on disk, but whether every one of them is ' +
      'reachable could not be determined: the gateway topology probe failed.',
  }

  it('multi-profile + non-multiplex warns with the profile named and remediation inline', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: true,
        profileServability: UNREACHABLE_SINGLE,
      }),
    )
    const profile = items.find((item) => item.id === 'profile')
    expect(profile?.detail).toContain('Only "default" is reachable right now')
    expect(profile?.detail).toContain('"hermes-switch"')
    expect(profile?.detail).toContain(
      'hermes config set gateway.multiplex_profiles true',
    )
    // A warning, not a hard blocker: still optional, still not `blocked` on
    // its own account (only `optionalBlocked` — the pre-existing chat gate —
    // may force that).
    expect(profile?.required).toBe(false)
    expect(profile?.state).toBe('todo')
  })

  it('downgrades an already-touched profile back to todo when it turns out unreachable', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: true,
        profileTouched: true,
        profileServability: UNREACHABLE_SINGLE,
      }),
    )
    expect(items.find((item) => item.id === 'profile')?.state).toBe('todo')
  })

  it('single profile + non-multiplex stays silent (profileServability: null)', () => {
    const items = buildChecklist(
      input({ activeProvider: 'anthropic', chatProven: true }),
    )
    const profile = items.find((item) => item.id === 'profile')
    expect(profile?.detail).toBe('Optional — the default profile works.')
    expect(profile?.state).toBe('todo')
  })

  it('multiplex with every disk profile served stays silent ({ kind: "ok" })', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: true,
        profileTouched: true,
        profileServability: { kind: 'ok' },
      }),
    )
    const profile = items.find((item) => item.id === 'profile')
    expect(profile?.detail).toBe('Chosen.')
    expect(profile?.state).toBe('done')
  })

  it('warns when multiplex is on but a disk profile is missing from served_profiles', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: true,
        profileServability: UNREACHABLE_MULTIPLEX,
      }),
    )
    const profile = items.find((item) => item.id === 'profile')
    expect(profile?.detail).toContain('Multiplexing is on')
    expect(profile?.detail).toContain('"morpheus"')
    expect(profile?.state).toBe('todo')
  })

  it('reports an indeterminate probe as a non-committal message, not a misconfiguration accusation', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: true,
        profileServability: INDETERMINATE,
      }),
    )
    const profile = items.find((item) => item.id === 'profile')
    expect(profile?.detail).toContain('could not be determined')
    expect(profile?.detail).not.toMatch(/misconfigur/i)
    // No remediation command is asserted here on purpose: `indeterminate`
    // never claims a fix, only that the answer is unknown.
    expect(profile?.detail).not.toContain('multiplex_profiles true')
  })

  it('still respects the chat gate: a servability warning cannot unblock the item early', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        chatProven: false,
        profileServability: UNREACHABLE_SINGLE,
      }),
    )
    expect(items.find((item) => item.id === 'profile')?.state).toBe('blocked')
  })
})

describe('outstandingCount', () => {
  it('counts todo and skipped, never blocked', () => {
    // A blocked item is not a task the user is behind on, and counting it
    // produced a sidebar badge that could never reach zero.
    const items = buildChecklist(input())
    expect(items.some((entry) => entry.state === 'blocked')).toBe(true)
    expect(outstandingCount(items)).toBe(
      items.filter(
        (entry) => entry.state === 'todo' || entry.state === 'skipped',
      ).length,
    )
  })

  it('reaches zero when everything is done', () => {
    const items = buildChecklist(
      input({
        activeProvider: 'anthropic',
        gatewayReachable: true,
        chatProven: true,
        agentCwdExplicit: true,
        pluginsTouched: true,
        profileTouched: true,
        memoryTouched: true,
        draft: draft({ completed: ['theme'] }),
      }),
    )
    expect(outstandingCount(items)).toBe(0)
    expect(outstandingRequiredCount(items)).toBe(0)
  })
})

describe('outstandingRequiredCount', () => {
  it('counts only the four the docs call required, including blocked ones', () => {
    // Unlike `outstandingCount`, a blocked *required* item absolutely counts:
    // "you cannot do this yet" is precisely why setup is not finished.
    const items = buildChecklist(input())
    expect(outstandingRequiredCount(items)).toBe(4)
  })
})
