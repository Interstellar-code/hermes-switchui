// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Response.json mocks intentionally match the async browser API. */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEYS,
} from '../lib/onboarding-storage'
import { useOnboardingChecklist } from './use-onboarding-checklist'

const mockFetch = vi.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

/**
 * Route the hook's six probes by URL. Anything unlisted answers 404, which is
 * the same "no proof" path a real outage takes.
 */
function routeFetch(routes: Record<string, unknown>) {
  mockFetch.mockImplementation((input: string) => {
    const url = String(input)
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) return Promise.resolve(jsonResponse(body))
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
      text: async () => '',
    })
  })
}

/** Every probe answering as a fully-configured install — and no wizard record. */
const CONFIGURED_ROUTES: Record<string, unknown> = {
  '/api/claude-config': {
    providers: [],
    activeProvider: 'anthropic',
    config: { memory: { memory_enabled: true, provider: 'matrix-memory' } },
  },
  '/api/connection-status': { health: true, capabilities: { kanban: true } },
  '/api/agent-cwd': {
    ok: true,
    resolved: { path: '/srv/code', source: 'explicit-config' },
  },
  '/api/profiles/list': { activeProfile: 'hermes-switch' },
  '/api/sessions': { sessions: [{ messageCount: 6 }] },
  '/api/dashboard-proxy/api/dashboard/plugins/hub': {
    plugins: [
      { name: 'workflow-engine', runtime_status: 'enabled', source: 'bundled' },
      { name: 'a2a_fleet', runtime_status: 'enabled', source: 'bundled' },
      { name: 'personas', runtime_status: 'enabled', source: 'bundled' },
      { name: 'mcp_lazy', runtime_status: 'enabled', source: 'bundled' },
      { name: 'projects', runtime_status: 'enabled', source: 'bundled' },
    ],
  },
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    )
  }
}

describe('useOnboardingChecklist', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ providers: [], activeProvider: null }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is not ready before the first client read, then settles with a fresh install', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.items).toHaveLength(8)
    // Fresh install: no active provider, nothing skipped or completed. The
    // chat item is blocked (no provider) and every optional item is blocked
    // behind it, so only connect, provider and workspace are outstanding.
    expect(result.current.outstanding).toBe(3)
  })

  it('re-reads when the onboarding-complete event fires', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(
      result.current.items.find((item) => item.id === 'plugins')?.state,
    ).toBe('blocked')

    window.localStorage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: Date.now(),
        branch: 'main',
        // 'chat' among the skipped is what unblocks the optional band — the
        // gate settles either by succeeding or by being explicitly skipped.
        skipped: ['chat', 'theme', 'plugins'],
      }),
    )
    window.dispatchEvent(new Event(ONBOARDING_COMPLETE_EVENT))

    // 'plugins' flips from 'todo' to 'skipped' — outstandingCount treats
    // both as outstanding, so asserting on item state (rather than the raw
    // count) is what actually proves the event triggered a re-read.
    await waitFor(() =>
      expect(
        result.current.items.find((item) => item.id === 'plugins')?.state,
      ).toBe('skipped'),
    )
  })

  it('re-reads on a cross-tab storage event for a watched key', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    window.localStorage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: Date.now(),
        branch: 'main',
        skipped: ['chat'],
        completed: ['theme'],
      }),
    )
    window.dispatchEvent(
      new StorageEvent('storage', { key: ONBOARDING_KEYS.outcome }),
    )

    // 'theme' flips from 'todo' to 'done' off the completion record alone —
    // both the proof that the storage event triggered a re-read, and the proof
    // that a finished step stays finished once the draft has been cleared.
    await waitFor(() =>
      expect(
        result.current.items.find((item) => item.id === 'theme')?.state,
      ).toBe('done'),
    )
  })

  it('clears the badge entirely after a completed full run', async () => {
    // The regression this pins: `chatProven`, `pluginsTouched`,
    // `profileTouched` and `memoryTouched` are hardcoded false out here (they
    // are live in-wizard probes), the draft is deleted on finish, and
    // `writeOnboardingComplete` used to persist only `skipped`. A user who
    // completed everything was left with a permanent count on the sidebar nav
    // and "Setup Wizard (N left)" in the command palette, with no way to clear
    // it.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ providers: [], activeProvider: 'anthropic' }),
    })
    window.localStorage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: Date.now(),
        branch: 'main',
        skipped: [],
        completed: [
          'connect',
          'workspace',
          'chat',
          'profile',
          'memory',
          'plugins',
          'theme',
        ],
      }),
    )

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.outstanding).toBe(0))
    expect(result.current.items.every((item) => item.state === 'done')).toBe(
      true,
    )
  })

  // ── live probes, on installs that never walked the wizard ─────────────────

  it('clears the whole list from live probes alone, with no completion record', async () => {
    // The regression this pins. `completed` is written only by a wizard run
    // walking its own steps, and `use-onboarding-gate.ts`'s `readGateOutcome`
    // synthesises `completed: []` for every install that settled on the legacy
    // flag or on auto-detection. Those installs can configure a profile, a
    // memory provider, a working directory and a theme through the real
    // screens and — before the probes below existed — the card still reported
    // all of it as outstanding, permanently.
    routeFetch(CONFIGURED_ROUTES)
    window.localStorage.setItem('claude-theme', 'matrix')

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.ready).toBe(true))
    const states = Object.fromEntries(
      result.current.items.map((item) => [item.id, item.state]),
    )
    expect(states).toEqual({
      connect: 'done',
      provider: 'done',
      workspace: 'done',
      chat: 'done',
      profile: 'done',
      memory: 'done',
      plugins: 'done',
      theme: 'done',
    })
    expect(result.current.outstanding).toBe(0)
  })

  it('reads the theme straight out of localStorage, not the completion record', async () => {
    // 'on a theme' and 'never picked one' used to be indistinguishable out
    // here: the item only ever consulted `completed.has('theme')`.
    routeFetch(CONFIGURED_ROUTES)

    const { result, rerender } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.items.find((i) => i.id === 'theme')?.state).toBe(
      'todo',
    )

    window.localStorage.setItem('claude-theme', 'claude-slate-light')
    window.dispatchEvent(new StorageEvent('storage', { key: 'claude-theme' }))
    rerender()

    await waitFor(() =>
      expect(result.current.items.find((i) => i.id === 'theme')?.state).toBe(
        'done',
      ),
    )
  })

  it('ignores an unrecognised theme id the same as no theme at all', async () => {
    routeFetch({ ...CONFIGURED_ROUTES })
    window.localStorage.setItem('claude-theme', 'not-a-real-theme')

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.items.find((i) => i.id === 'theme')?.state).toBe(
      'todo',
    )
  })

  it('reads the default profile as "not chosen", never as done', async () => {
    // An absent `~/.hermes/active_profile` pointer *is* `default` — the state
    // this optional item exists to offer a change from.
    routeFetch({
      ...CONFIGURED_ROUTES,
      '/api/profiles/list': { activeProfile: 'default' },
    })

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.items.find((i) => i.id === 'profile')?.state).toBe(
      'todo',
    )
  })

  it('does not count a named memory provider under a disabled memory block', async () => {
    routeFetch({
      ...CONFIGURED_ROUTES,
      '/api/claude-config': {
        activeProvider: 'anthropic',
        config: {
          memory: { memory_enabled: false, provider: 'matrix-memory' },
        },
      },
    })

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.items.find((i) => i.id === 'memory')?.state).toBe(
      'todo',
    )
  })

  it('does not accept an empty session, or one with a single turn, as chat proof', async () => {
    routeFetch({
      ...CONFIGURED_ROUTES,
      '/api/sessions': { sessions: [{ messageCount: 0 }, { messageCount: 1 }] },
    })

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.items.find((i) => i.id === 'chat')?.state).toBe(
      'todo',
    )
  })

  it('leaves a core plugin that is off as outstanding', async () => {
    routeFetch({
      ...CONFIGURED_ROUTES,
      '/api/connection-status': {
        health: true,
        // kanban is not a hub plugin, so only the capability flag can speak
        // for it — and it says the Tasks screen is dark.
        capabilities: { kanban: false },
      },
    })

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.items.find((i) => i.id === 'plugins')?.state).toBe(
      'todo',
    )
  })

  // ── failure paths: never a false "done" ───────────────────────────────────

  it('degrades every item to outstanding when every probe fails', async () => {
    // A rejected fetch, not a 404 — the harshest case, and the one that used
    // to be the only behaviour this hook had.
    mockFetch.mockRejectedValue(new Error('network down'))
    window.localStorage.setItem('claude-theme', 'matrix')

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.ready).toBe(true))
    const byId = Object.fromEntries(
      result.current.items.map((item) => [item.id, item]),
    )
    // Nothing may claim to be done off a probe that never answered. The theme
    // is the exception on purpose: it is a localStorage read, not a fetch, so
    // a network outage cannot make it forget.
    expect(byId.provider.state).toBe('todo')
    expect(byId.workspace.state).toBe('todo')
    expect(byId.connect.state).toBe('todo')
    // "Could not check" — never an accusation that the gateway is down.
    expect(byId.connect.detail).toContain('Not checked')
    expect(byId.chat.state).toBe('blocked')
    for (const id of ['profile', 'memory', 'plugins']) {
      expect(byId[id].state, id).toBe('blocked')
    }
    // `stateFor` checks done before blocked, deliberately, and the theme was
    // genuinely picked — so it reads done even inside the blocked optional
    // band. Nothing that depended on a probe does.
    expect(byId.theme.state).toBe('done')
  })

  it('reports the gateway as down only when the probe actually says so', async () => {
    routeFetch({
      ...CONFIGURED_ROUTES,
      '/api/connection-status': { health: false },
    })

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    const connect = result.current.items.find((i) => i.id === 'connect')
    expect(connect?.state).toBe('todo')
    expect(connect?.detail).toContain('not responding')
  })

  it('keeps a completed wizard run authoritative when the probes cannot answer', async () => {
    // The persisted record is still the fallback: probes that fail must not
    // resurrect a badge the user already cleared by finishing the wizard.
    mockFetch.mockRejectedValue(new Error('network down'))
    window.localStorage.setItem(
      ONBOARDING_KEYS.outcome,
      JSON.stringify({
        kind: 'complete',
        at: Date.now(),
        branch: 'main',
        skipped: [],
        completed: [
          'connect',
          'workspace',
          'chat',
          'profile',
          'memory',
          'plugins',
          'theme',
        ],
      }),
    )

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    // 'provider' has no persisted stand-in — it is the one item with only a
    // live signal — so it is the only thing left outstanding.
    expect(
      result.current.items
        .filter((item) => item.state !== 'done')
        .map((item) => item.id),
    ).toEqual(['provider'])
  })

  it('stays not-ready until the probes settle, so no wrong count is painted', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch.mockImplementation((input: string) =>
      String(input).includes('/api/claude-config')
        ? gate.then(() =>
            jsonResponse({ activeProvider: 'anthropic', config: {} }),
          )
        : Promise.resolve(jsonResponse({})),
    )

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })

    // localStorage has already been read by now; the probe has not answered.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current.ready).toBe(false)
    expect(result.current.items).toHaveLength(0)
    expect(result.current.outstanding).toBe(0)

    release?.()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.items).toHaveLength(8)
  })

  it('ignores storage events for unrelated keys', async () => {
    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    const before = result.current.items

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'some-unrelated-key' }),
    )

    // Give any (wrongly-triggered) re-read a tick to land, then assert the
    // snapshot reference is unchanged.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current.items).toBe(before)
  })
})
