// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rekeySessionModel, switchModel } from './chat-composer-services'
import { useSessionModelStore } from '@/stores/session-model-store'

// ─── helpers ──────────────────────────────────────────────────────────────

function resetStore() {
  useSessionModelStore.setState({ models: {} })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── switchModel ────────────────────────────────────────────────────────────
//
// #348 task 4: switchModel used to PATCH /api/claude-proxy/api/config — a
// global gateway-config write with no profile scoping. Verified live against
// the running hermes-agent gateway that neither that endpoint nor the dead
// /api/model-switch helper (src/lib/gateway-api.ts) exist on the real API
// server (_http_route_table() in gateway/platforms/api_server.py has no such
// route — both 404, with and without a valid API key). switchModel is now
// purely client-local: these tests pin that it never touches the network and
// only ever writes into the per-session store.

describe('switchModel', () => {
  it('never calls fetch — no global gateway config write', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    switchModel('claude-sonnet-4-5', 'anthropic', 'session-1')

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('persists the resolved model into useSessionModelStore under sessionKey', () => {
    switchModel('claude-sonnet-4-5', 'anthropic', 'session-1')

    expect(useSessionModelStore.getState().getModel('session-1')).toBe(
      'anthropic/claude-sonnet-4-5',
    )
  })

  it('does not prefix the model when it already carries the provider', () => {
    switchModel('anthropic/claude-sonnet-4-5', 'anthropic', 'session-1')

    expect(useSessionModelStore.getState().getModel('session-1')).toBe(
      'anthropic/claude-sonnet-4-5',
    )
  })

  it('infers the provider from a slash-qualified model id when none is passed', () => {
    switchModel('ollama/llama3', undefined, 'session-1')

    expect(useSessionModelStore.getState().getModel('session-1')).toBe(
      'ollama/llama3',
    )
  })

  it('writes local-provider picks (ollama, atomic-chat) into the same session store — no separate global override', () => {
    switchModel('llama3', 'ollama', 'session-1')

    expect(useSessionModelStore.getState().getModel('session-1')).toBe(
      'ollama/llama3',
    )
  })

  it('does not write to the store when no sessionKey is given', () => {
    switchModel('claude-sonnet-4-5', 'anthropic', undefined)

    expect(useSessionModelStore.getState().models).toEqual({})
  })

  it('scopes writes to the given session only — does not affect other sessions', () => {
    switchModel('claude-sonnet-4-5', 'anthropic', 'session-1')
    switchModel('gpt-4o', 'openai', 'session-2')

    expect(useSessionModelStore.getState().getModel('session-1')).toBe(
      'anthropic/claude-sonnet-4-5',
    )
    expect(useSessionModelStore.getState().getModel('session-2')).toBe(
      'openai/gpt-4o',
    )
  })

  it('returns the resolved provider/model in the response', () => {
    const result = switchModel('claude-sonnet-4-5', 'anthropic', 'session-1')

    expect(result).toEqual({
      ok: true,
      resolved: { modelProvider: 'anthropic', model: 'claude-sonnet-4-5' },
    })
  })
})

// ─── rekeySessionModel ──────────────────────────────────────────────────────
//
// #348 task 5: a model picked before a new chat resolves to a real session
// id is persisted under a temporary key (e.g. the 'new' sentinel). Nothing
// moved it once the real key arrived, so the pick was silently dropped.

describe('rekeySessionModel', () => {
  it('moves the model from the stale key to the new key', () => {
    useSessionModelStore.getState().setModel('new', 'anthropic/claude-sonnet-4-5')

    rekeySessionModel('new', 'session-real-1')

    expect(useSessionModelStore.getState().getModel('session-real-1')).toBe(
      'anthropic/claude-sonnet-4-5',
    )
  })

  it('clears the stale key so it does not leak into the next new chat', () => {
    useSessionModelStore.getState().setModel('new', 'anthropic/claude-sonnet-4-5')

    rekeySessionModel('new', 'session-real-1')

    expect(useSessionModelStore.getState().getModel('new')).toBeUndefined()
  })

  it('does not overwrite a model already explicitly set on the new key', () => {
    useSessionModelStore.getState().setModel('new', 'anthropic/claude-sonnet-4-5')
    useSessionModelStore.getState().setModel('session-real-1', 'openai/gpt-4o')

    rekeySessionModel('new', 'session-real-1')

    expect(useSessionModelStore.getState().getModel('session-real-1')).toBe(
      'openai/gpt-4o',
    )
  })

  it('still clears the stale key even when the new key already had its own model', () => {
    useSessionModelStore.getState().setModel('new', 'anthropic/claude-sonnet-4-5')
    useSessionModelStore.getState().setModel('session-real-1', 'openai/gpt-4o')

    rekeySessionModel('new', 'session-real-1')

    expect(useSessionModelStore.getState().getModel('new')).toBeUndefined()
  })

  it('is a no-op when the stale key has no stored model', () => {
    rekeySessionModel('new', 'session-real-1')

    expect(useSessionModelStore.getState().models).toEqual({})
  })

  it('is a no-op when staleKey is undefined', () => {
    useSessionModelStore.getState().setModel('session-real-1', 'openai/gpt-4o')

    rekeySessionModel(undefined, 'session-real-1')

    expect(useSessionModelStore.getState().getModel('session-real-1')).toBe(
      'openai/gpt-4o',
    )
  })

  it('is a no-op when staleKey and newKey are the same session', () => {
    useSessionModelStore.getState().setModel('session-1', 'anthropic/claude-sonnet-4-5')

    rekeySessionModel('session-1', 'session-1')

    expect(useSessionModelStore.getState().getModel('session-1')).toBe(
      'anthropic/claude-sonnet-4-5',
    )
  })

  it('does not corrupt an unrelated session\'s model on ordinary navigation between two resolved sessions', () => {
    // Simulates navigating from an already-resolved session A to an
    // already-resolved session B — rekeySessionModel must only ever be
    // called from the onSessionResolved wrapper (chat-screen.tsx), which
    // fires exclusively on a new-chat -> real-session transition, never on
    // plain navigation between two existing sessions. This test pins the
    // primitive's own behavior in case it is ever called with two "real"
    // keys: session A's model must never migrate into session B's slot.
    useSessionModelStore.getState().setModel('session-a', 'anthropic/claude-sonnet-4-5')
    useSessionModelStore.getState().setModel('session-b', 'openai/gpt-4o')

    // Not called by chat-screen.tsx's wrapper in this scenario, but assert
    // the primitive itself would still respect an existing session-b value.
    rekeySessionModel('session-a', 'session-b')

    expect(useSessionModelStore.getState().getModel('session-b')).toBe(
      'openai/gpt-4o',
    )
  })
})
