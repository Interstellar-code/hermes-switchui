// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseDelegationCompletion } from '../delegation-completion'
import {
  claimDelegationContinue,
  delegationContinueKey,
  isDelegationContinued,
  markDelegationContinued,
  shouldAutoContinue,
  useDelegationAutoContinue,
} from './use-delegation-auto-continue'
import type { ChatMessage } from '../types'

// Real ms timestamps: getMessageTimestamp reads small numbers as seconds.
const T = 1_790_000_000_000
const ENVELOPE =
  '[ASYNC DELEGATION BATCH COMPLETE — deleg_abc]\n— 1 subagent(s) —'

function card(timestamp: number, id = 'msg-9'): ChatMessage {
  const message: ChatMessage = {
    id,
    role: 'user',
    text: ENVELOPE,
    content: [{ type: 'text', text: ENVELOPE }],
    timestamp,
  }
  message.__delegationComplete = parseDelegationCompletion(message)!
  return message
}

const reply: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  timestamp: T + 5_000,
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('shouldAutoContinue', () => {
  const messages = [card(T + 2_000)]

  it('fires for a new last completion card when idle and enabled', () => {
    expect(
      shouldAutoContinue(messages, { enabledAt: T + 1_000, idle: true }),
    ).toBe(messages[0])
  })

  it('does not fire when disabled', () => {
    expect(
      shouldAutoContinue(messages, { enabledAt: undefined, idle: true }),
    ).toBeNull()
  })

  it('does not fire while a run / approval is pending', () => {
    expect(
      shouldAutoContinue(messages, { enabledAt: T + 1_000, idle: false }),
    ).toBeNull()
  })

  it('skips rows created before the toggle was enabled', () => {
    expect(
      shouldAutoContinue(messages, { enabledAt: T + 3_000, idle: true }),
    ).toBeNull()
  })

  it('does not fire once something follows the card', () => {
    expect(
      shouldAutoContinue([card(T + 2_000), reply], {
        enabledAt: T + 1_000,
        idle: true,
      }),
    ).toBeNull()
  })
})

describe('shouldAutoContinue: task-failure notices', () => {
  it('waits for the batch-complete row instead of a TASK FAILED notice', () => {
    const notice: ChatMessage = {
      id: 'msg-f',
      role: 'user',
      text: '[ASYNC DELEGATION TASK FAILED — deleg_abc, task 1/3]\nOne subagent…',
      timestamp: T + 2_000,
    }
    notice.__delegationComplete = parseDelegationCompletion(notice)!
    expect(
      shouldAutoContinue([notice], { enabledAt: T + 1_000, idle: true }),
    ).toBeNull()
  })
})

describe('claimDelegationContinue', () => {
  it('manual Continue loses to a claim already made by another tab', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    const key = delegationContinueKey('s1', card(T))
    expect(isDelegationContinued(key)).toBe(false)
    expect(await claimDelegationContinue(key)).toBe(true) // tab A
    expect(isDelegationContinued(key)).toBe(true) // tab B hides Continue
    expect(await claimDelegationContinue(key)).toBe(false) // tab B click
  })

  it('falls back to the localStorage claim when the lock request rejects', async () => {
    const request = vi.fn(() => Promise.reject(new Error('SecurityError')))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    expect(await claimDelegationContinue('k')).toBe(true)
    expect(await claimDelegationContinue('k')).toBe(false)
  })

  it('prunes claims older than 30 days', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    localStorage.setItem('deleg-continued:old', String(Date.now() - 31 * 864e5))
    localStorage.setItem('deleg-continued:new', String(Date.now()))
    localStorage.setItem('unrelated', '0')
    await claimDelegationContinue('deleg-continued:k')
    expect(localStorage.getItem('deleg-continued:old')).toBeNull()
    expect(localStorage.getItem('deleg-continued:new')).not.toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('0')
  })

  it('claims once via localStorage when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    expect(await claimDelegationContinue('k')).toBe(true)
    expect(await claimDelegationContinue('k')).toBe(false)
  })

  it('loses the claim when another tab holds the lock', async () => {
    const request = vi.fn(
      (_name: string, _opts: unknown, cb: (lock: unknown) => unknown) =>
        Promise.resolve(cb(null)),
    )
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    expect(await claimDelegationContinue('k')).toBe(false)
    expect(localStorage.getItem('k')).toBeNull()
    expect(request).toHaveBeenCalledWith(
      'k',
      { ifAvailable: true },
      expect.any(Function),
    )
  })

  it('treats a key set by another tab as already claimed', async () => {
    const request = vi.fn(
      (_name: string, _opts: unknown, cb: (lock: unknown) => unknown) =>
        Promise.resolve(cb({ name: 'k' })),
    )
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    localStorage.setItem('k', '1')
    expect(await claimDelegationContinue('k')).toBe(false)
  })
})

describe('useDelegationAutoContinue', () => {
  it('sends the nudge exactly once across re-renders and remounts', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    const sendNudge = vi.fn()
    const props = {
      sessionKey: 's1',
      messages: [card(T + 2_000)],
      enabledAt: T + 1_000,
      idle: true,
      sendNudge,
    }
    const first = renderHook((p) => useDelegationAutoContinue(p), {
      initialProps: props,
    })
    await waitFor(() => expect(sendNudge).toHaveBeenCalledTimes(1))
    first.rerender({ ...props, messages: [...props.messages] })
    first.unmount()
    // A reload / second tab sees the persisted claim.
    renderHook(() => useDelegationAutoContinue(props))
    await new Promise((r) => setTimeout(r, 0))
    expect(sendNudge).toHaveBeenCalledTimes(1)
    expect(
      localStorage.getItem(delegationContinueKey('s1', props.messages[0])),
    ).not.toBeNull()
  })

  it('does nothing when disabled, busy, or the row is old', async () => {
    const sendNudge = vi.fn()
    const base = {
      sessionKey: 's1',
      messages: [card(T + 2_000)],
      enabledAt: (T + 1_000) as number | undefined,
      idle: true,
      sendNudge,
    }
    renderHook(() =>
      useDelegationAutoContinue({ ...base, enabledAt: undefined }),
    )
    renderHook(() => useDelegationAutoContinue({ ...base, idle: false }))
    renderHook(() =>
      useDelegationAutoContinue({ ...base, enabledAt: T + 9_000 }),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(sendNudge).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('does not fire after the user already sent a message (claim on send)', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    const sendNudge = vi.fn()
    const messages = [card(T + 2_000)]
    // The composer send path marks the last card's key before sending.
    markDelegationContinued(delegationContinueKey('s1', messages[0]))
    renderHook(() =>
      useDelegationAutoContinue({
        sessionKey: 's1',
        messages,
        enabledAt: T + 1_000,
        idle: true,
        sendNudge,
      }),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(sendNudge).not.toHaveBeenCalled()
  })

  it('fires when the session goes idle with the card still last', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
    const sendNudge = vi.fn()
    const props = {
      sessionKey: 's1',
      messages: [card(T + 2_000)],
      enabledAt: T + 1_000,
      idle: false,
      sendNudge,
    }
    const hook = renderHook((p) => useDelegationAutoContinue(p), {
      initialProps: props,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(sendNudge).not.toHaveBeenCalled()
    hook.rerender({ ...props, idle: true })
    await waitFor(() => expect(sendNudge).toHaveBeenCalledTimes(1))
  })
})
