// @vitest-environment jsdom
/**
 * P4 — the client half of the profile-scope join.
 *
 * The server fails closed on `body.profile`, but only for a profile it was
 * actually told about. If the client stops sending it, every guard P1 built
 * goes unreachable and the send silently lands in whichever profile the
 * gateway is running. These tests exist to fail loudly if that regresses.
 */
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineClarifyCard } from './components/inline-clarify-card'
import { useStreamingMessage } from './hooks/use-streaming-message'
import type { PendingClarify } from '@/stores/chat-store'
import { PROFILE_REFUSAL_PREFIX, setSessionProfile } from '@/lib/session-scope'

/** Minimal duck-typed stand-in for a streaming Response that ends at once. */
function emptyStreamResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: () => Promise.resolve({ done: true, value: undefined }),
      }),
    },
  }
}

function refusedResponse(status: number, error: string) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify({ ok: false, error })),
  }
}

function sentBody(call: number = 0): Record<string, unknown> {
  const [, init] = vi.mocked(fetch).mock.calls[call] as [
    string,
    { body: string },
  ]
  return JSON.parse(init.body) as Record<string, unknown>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setSessionProfile(null)
})

describe('send-stream carries the scoped profile', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyStreamResponse()))
  })

  it('puts the ambient profile in the request body when scoped', async () => {
    setSessionProfile('neo')
    const { result } = renderHook(() => useStreamingMessage())

    await result.current.startStreaming({
      sessionKey: 'abc123',
      friendlyId: 'abc123',
      message: 'hi',
    })

    expect(fetch).toHaveBeenCalledWith('/api/send-stream', expect.anything())
    expect(sentBody().profile).toBe('neo')
    expect(sentBody().sessionKey).toBe('abc123')
  })

  it('omits the profile key entirely when unscoped', async () => {
    const { result } = renderHook(() => useStreamingMessage())

    await result.current.startStreaming({
      sessionKey: 'abc123',
      friendlyId: 'abc123',
      message: 'hi',
    })

    expect('profile' in sentBody()).toBe(false)
  })

  it('sends "default" like any other profile — never as unscoped', async () => {
    setSessionProfile('default')
    const { result } = renderHook(() => useStreamingMessage())

    await result.current.startStreaming({
      sessionKey: 'abc123',
      friendlyId: 'abc123',
      message: 'hi',
    })

    expect(sentBody().profile).toBe('default')
  })
})

describe('concurrent sends across profiles do not bleed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyStreamResponse()))
  })

  it('captures each send’s own ambient profile even when the profile switches before the first send resolves', async () => {
    // Two independent composer instances (two tabs/panes), each firing a send
    // for a different profile. The ambient profile flips between the two
    // calls, before either `fetch` has settled. If `startStreaming` ever
    // read the ambient profile lazily (after an await) instead of capturing
    // it synchronously up front, the second call's profile switch would leak
    // into the first call's already-in-flight request body.
    const neoPane = renderHook(() => useStreamingMessage())
    const trinityPane = renderHook(() => useStreamingMessage())

    setSessionProfile('neo')
    const neoSend = neoPane.result.current.startStreaming({
      sessionKey: 'session-neo',
      friendlyId: 'session-neo',
      message: 'from neo',
    })

    // Flip the ambient profile before the neo send's fetch has resolved.
    setSessionProfile('trinity')
    const trinitySend = trinityPane.result.current.startStreaming({
      sessionKey: 'session-trinity',
      friendlyId: 'session-trinity',
      message: 'from trinity',
    })

    await Promise.all([neoSend, trinitySend])

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    const neoCall = sentBody(0)
    const trinityCall = sentBody(1)

    expect(neoCall.sessionKey).toBe('session-neo')
    expect(neoCall.profile).toBe('neo')

    expect(trinityCall.sessionKey).toBe('session-trinity')
    expect(trinityCall.profile).toBe('trinity')
  })
})

describe('typed refusals reach the user', () => {
  it('surfaces a single-mode 409 as a refusal, not a transport failure', async () => {
    const message =
      'Profile "neo" cannot be targeted: the gateway is not running in multiplex mode.'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(refusedResponse(409, message)),
    )
    setSessionProfile('neo')

    const onError = vi.fn()
    const { result } = renderHook(() => useStreamingMessage({ onError }))

    await result.current.startStreaming({
      sessionKey: 'abc123',
      friendlyId: 'abc123',
      message: 'hi',
    })

    expect(onError).toHaveBeenCalledTimes(1)
    const shown = onError.mock.calls[0][0] as string
    // Actionable: the reason survives, and it is marked as "nothing was sent"
    // so the UI can distinguish a refusal from a failure.
    expect(shown).toContain(PROFILE_REFUSAL_PREFIX)
    expect(shown).toContain(message)
  })

  it('surfaces a 404 (profile not served) the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          refusedResponse(404, 'Profile "ghost" is not served by this gateway'),
        ),
    )
    setSessionProfile('ghost')

    const onError = vi.fn()
    const { result } = renderHook(() => useStreamingMessage({ onError }))
    await result.current.startStreaming({
      sessionKey: 'abc123',
      friendlyId: 'abc123',
      message: 'hi',
    })

    expect(onError.mock.calls[0][0] as string).toContain(PROFILE_REFUSAL_PREFIX)
  })

  it('leaves an unscoped 404 as a plain failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(refusedResponse(404, 'session not found')),
    )

    const onError = vi.fn()
    const { result } = renderHook(() => useStreamingMessage({ onError }))
    await result.current.startStreaming({
      sessionKey: 'abc123',
      friendlyId: 'abc123',
      message: 'hi',
    })

    const shown = onError.mock.calls[0][0] as string
    expect(shown).not.toContain(PROFILE_REFUSAL_PREFIX)
    expect(shown).toContain('session not found')
  })
})

describe('clarify / interaction respond carry the scoped profile', () => {
  const clarify = (interactionId?: string): PendingClarify => ({
    clarifyId: 'clarify-1',
    interactionId,
    question: 'Pick one',
    choices: ['First'],
    runId: 'run-1',
    requestedAt: 1,
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('scopes an interaction respond', () => {
    setSessionProfile('neo')
    render(
      <InlineClarifyCard clarify={clarify('interaction-1')} sessionKey="s1" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /First/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(sentBody()).toEqual({ answer: 'First', profile: 'neo' })
  })

  it('scopes a clarify resume', () => {
    setSessionProfile('neo')
    render(<InlineClarifyCard clarify={clarify()} sessionKey="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /First/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(sentBody()).toEqual({
      clarify_id: 'clarify-1',
      answer: 'First',
      profile: 'neo',
    })
  })

  it('stays byte-identical when unscoped', () => {
    render(
      <InlineClarifyCard clarify={clarify('interaction-1')} sessionKey="s1" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /First/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    const [, init] = vi.mocked(fetch).mock.calls[0] as [
      string,
      { body: string },
    ]
    expect(init.body).toBe(JSON.stringify({ answer: 'First' }))
  })
})
