// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useChatStore } from './chat-store'
import type { QueuedChatMessage } from './chat-store'
import { setSessionProfile } from '@/lib/session-scope'

/**
 * F3 — a queued send must never be written into a profile other than the one it
 * was composed under.
 *
 * The send path reads the ambient profile as it fires, which is consume time,
 * not enqueue time. Queue buckets are keyed by the composite scope, but
 * `activeScopeKey` is idempotent — a caller passing an already-scoped session
 * key reaches the same bucket whatever the ambient profile is, which is how a
 * `neo` message becomes reachable while `default` is ambient.
 */
const item: QueuedChatMessage = {
  id: 'queued-1',
  text: 'hello',
  attachments: [],
}

beforeEach(() => {
  // The queue falls back to sessionStorage when the in-memory bucket is
  // absent, so both have to be reset between cases.
  sessionStorage.clear()
  useChatStore.setState({ messageQueue: {}, messageQueueActivity: {} })
})

afterEach(() => {
  setSessionProfile(null)
})

describe('message queue profile capture', () => {
  it('stamps the enqueue-time profile onto the item', () => {
    setSessionProfile('neo')
    useChatStore.getState().enqueue('session-1', item)

    expect(useChatStore.getState().messageQueue['neo::session-1']).toEqual([
      { ...item, profile: 'neo' },
    ])
  })

  it('adds no profile key when unscoped', () => {
    useChatStore.getState().enqueue('session-1', item)

    expect(useChatStore.getState().messageQueue['session-1']).toEqual([item])
    expect(
      useChatStore.getState().messageQueue['session-1'][0],
    ).not.toHaveProperty('profile')
  })

  it('refuses to hand back a message composed under another profile', () => {
    setSessionProfile('neo')
    useChatStore.getState().enqueue('session-1', item)

    // The F1 hazard: the ambient profile is lost mid-conversation. The already
    // scoped key still resolves the bucket, so without the guard the message
    // drains here and the send writes it into the unscoped (active) profile.
    setSessionProfile(null)
    expect(useChatStore.getState().dequeue('neo::session-1')).toBeNull()
    expect(useChatStore.getState().messageQueue['neo::session-1']).toHaveLength(
      1,
    )

    // Back in scope, it drains normally — held, not lost.
    setSessionProfile('neo')
    expect(useChatStore.getState().dequeue('neo::session-1')).toEqual({
      ...item,
      profile: 'neo',
    })
  })

  it('refuses a cross-profile drain in the other direction', () => {
    useChatStore.getState().enqueue('session-1', item)
    setSessionProfile('neo')

    expect(useChatStore.getState().dequeue('session-1')).toBeNull()
  })

  it('drains legacy entries that predate profile stamping', () => {
    useChatStore.setState({ messageQueue: { 'session-1': [item] } })

    expect(useChatStore.getState().dequeue('session-1')).toEqual(item)
  })
})
