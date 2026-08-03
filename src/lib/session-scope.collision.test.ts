// @vitest-environment jsdom
/**
 * The collision gate.
 *
 * Two Hermes profiles can legitimately hold the SAME session id (separate
 * `state.db` per profile home). Every layer that keys client state by that id
 * must therefore key by `profile::id`, or one profile's data is served into the
 * other profile's UI with no error.
 *
 * These tests fail if any of the three keyed layers can collide:
 *   - TanStack Query keys   (`chatQueryKeys`)
 *   - sessionStorage slots  (`run-persistence`)
 *   - chat-store maps       (queue / waiting / run-phase)
 *
 * They also pin the §2 DoD: with no profile selected every key is byte-identical
 * to the pre-profile bare key, so existing single-profile users are untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setSessionProfile } from './session-scope'
import { chatQueryKeys } from '@/screens/chat/chat-queries'
import {
  persistStreamingState,
  persistWaitingState,
  readQueuedMessages,
  restoreStreamingState,
  writeQueuedMessages,
} from '@/stores/run-persistence'
import { useChatStore } from '@/stores/chat-store'

const SHARED_ID = 'sess-collide-1'

/** Run `fn` with the ambient profile set, then restore unscoped. */
function withProfile<T>(profile: string | null, fn: () => T): T {
  setSessionProfile(profile)
  try {
    return fn()
  } finally {
    setSessionProfile(null)
  }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  setSessionProfile(null)
})

afterEach(() => {
  setSessionProfile(null)
})

describe('query keys cannot collide across profiles', () => {
  const builders: Array<[string, () => Array<unknown>]> = [
    ['session', () => chatQueryKeys.session(SHARED_ID)],
    ['history', () => chatQueryKeys.history(SHARED_ID, SHARED_ID)],
    ['historyByFriendlyId', () => chatQueryKeys.historyByFriendlyId(SHARED_ID)],
    ['delegations', () => chatQueryKeys.delegations(SHARED_ID)],
    ['delegationMessages', () => chatQueryKeys.delegationMessages(SHARED_ID)],
    ['sessions', () => chatQueryKeys.sessions],
    ['sessionsRaw', () => chatQueryKeys.sessionsRaw],
  ]

  for (const [name, build] of builders) {
    it(`${name} is distinct per profile`, () => {
      const neo = withProfile('neo', build)
      const trinity = withProfile('trinity', build)
      const unscoped = build()

      expect(JSON.stringify(neo)).not.toBe(JSON.stringify(trinity))
      expect(JSON.stringify(neo)).not.toBe(JSON.stringify(unscoped))
      expect(JSON.stringify(trinity)).not.toBe(JSON.stringify(unscoped))
    })

    it(`${name} is byte-identical to the bare key when unscoped`, () => {
      // Guards the §2 DoD. If a builder ever appends an unconditional profile
      // segment (e.g. a literal `null`), this breaks every existing cache entry.
      expect(build()).toEqual(withProfile(null, build))
      expect(build().every((seg) => typeof seg === 'string')).toBe(true)
      expect(JSON.stringify(build())).not.toContain('::')
    })
  }
})

describe('sessionStorage slots cannot collide across profiles', () => {
  it('keeps queued messages in separate slots', () => {
    withProfile('neo', () =>
      writeQueuedMessages(SHARED_ID, [{ id: 'from-neo' }]),
    )
    withProfile('trinity', () =>
      writeQueuedMessages(SHARED_ID, [{ id: 'from-trinity' }]),
    )

    expect(withProfile('neo', () => readQueuedMessages(SHARED_ID))).toEqual([
      { id: 'from-neo' },
    ])
    expect(withProfile('trinity', () => readQueuedMessages(SHARED_ID))).toEqual(
      [{ id: 'from-trinity' }],
    )
    // An unscoped session must not see either profile's queue.
    expect(readQueuedMessages(SHARED_ID)).toEqual([])
  })

  it('keeps streaming recovery state in separate slots', () => {
    withProfile('neo', () =>
      persistStreamingState(SHARED_ID, { runId: 'run-neo' }),
    )
    withProfile('trinity', () =>
      persistStreamingState(SHARED_ID, { runId: 'run-trinity' }),
    )

    expect(
      withProfile('neo', () => restoreStreamingState(SHARED_ID))?.runId,
    ).toBe('run-neo')
    expect(
      withProfile('trinity', () => restoreStreamingState(SHARED_ID))?.runId,
    ).toBe('run-trinity')
    expect(restoreStreamingState(SHARED_ID)).toBeNull()
  })

  it('leaves pre-existing bare-keyed entries readable as unscoped only', () => {
    // No migration: entries written before profiles existed are bare, which is
    // exactly what "unscoped" means. A scoped read must never see them.
    writeQueuedMessages(SHARED_ID, [{ id: 'legacy' }])
    expect(readQueuedMessages(SHARED_ID)).toEqual([{ id: 'legacy' }])
    expect(withProfile('neo', () => readQueuedMessages(SHARED_ID))).toEqual([])
  })

  it('keeps waiting state in separate slots', () => {
    withProfile('neo', () =>
      persistWaitingState(SHARED_ID, { since: Date.now(), runId: 'run-neo' }),
    )
    withProfile('trinity', () =>
      persistWaitingState(SHARED_ID, {
        since: Date.now(),
        runId: 'run-trinity',
      }),
    )
    const slots = Object.keys(sessionStorage).filter((k) =>
      k.startsWith('claude_waiting_'),
    )
    expect(slots).toHaveLength(2)
  })
})

describe('chat-store maps cannot collide across profiles', () => {
  it('queues, waiting flags and run phase are per-profile', () => {
    const store = useChatStore.getState()

    withProfile('neo', () => {
      store.enqueue(SHARED_ID, {
        id: 'q-neo',
        text: 'from neo',
        attachments: [],
      })
      store.setSessionWaiting(SHARED_ID, 'run-neo')
    })

    withProfile('trinity', () => {
      expect(useChatStore.getState().dequeue(SHARED_ID)).toBeNull()
      expect(useChatStore.getState().isSessionWaiting(SHARED_ID)).toBe(false)
      expect(useChatStore.getState().getRunPhase(SHARED_ID)).toBe('idle')
    })

    // And unscoped must not inherit the scoped session's live-run state either.
    expect(useChatStore.getState().isSessionWaiting(SHARED_ID)).toBe(false)

    withProfile('neo', () => {
      expect(useChatStore.getState().isSessionWaiting(SHARED_ID)).toBe(true)
      expect(useChatStore.getState().dequeue(SHARED_ID)?.id).toBe('q-neo')
      useChatStore.getState().clearSessionWaiting(SHARED_ID)
    })
  })

  it('realtimeMessages and streamingState from processEvent are per-profile', () => {
    // processEvent is the single entry point chat-events/send-stream funnel
    // through — it must scope by activeScopeKey() itself, not rely on the
    // caller to have already scoped sessionKey.
    withProfile('neo', () => {
      useChatStore.getState().processEvent({
        type: 'message',
        sessionKey: SHARED_ID,
        message: { role: 'assistant', id: 'msg-neo', text: 'from neo' },
      })
      useChatStore.getState().processEvent({
        type: 'chunk',
        sessionKey: SHARED_ID,
        text: 'streaming from neo',
        fullReplace: true,
      })
    })

    withProfile('trinity', () => {
      useChatStore.getState().processEvent({
        type: 'message',
        sessionKey: SHARED_ID,
        message: { role: 'assistant', id: 'msg-trinity', text: 'from trinity' },
      })
      useChatStore.getState().processEvent({
        type: 'chunk',
        sessionKey: SHARED_ID,
        text: 'streaming from trinity',
        fullReplace: true,
      })
    })

    withProfile('neo', () => {
      const messages = useChatStore.getState().getRealtimeMessages(SHARED_ID)
      expect(messages).toHaveLength(1)
      expect(messages[0].text).toBe('from neo')
      expect(useChatStore.getState().getStreamingState(SHARED_ID)?.text).toBe(
        'streaming from neo',
      )
    })

    withProfile('trinity', () => {
      const messages = useChatStore.getState().getRealtimeMessages(SHARED_ID)
      expect(messages).toHaveLength(1)
      expect(messages[0].text).toBe('from trinity')
      expect(useChatStore.getState().getStreamingState(SHARED_ID)?.text).toBe(
        'streaming from trinity',
      )
    })

    // Unscoped must see neither profile's realtime data.
    expect(useChatStore.getState().getRealtimeMessages(SHARED_ID)).toEqual([])
    expect(useChatStore.getState().getStreamingState(SHARED_ID)).toBeNull()
  })
})
