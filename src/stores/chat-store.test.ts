import { beforeEach, describe, expect, it } from 'vitest'

import {
  
  normalizeMessageQueueSessionKey,
  useChatStore
} from './chat-store'
import type {QueuedChatMessage} from './chat-store';
import type { ChatMessage } from '../screens/chat/types'

function textMessage(
  id: string,
  role: string,
  text: string,
  historyIndex: number,
): ChatMessage {
  return {
    id,
    role,
    timestamp: 1_700_000_000_000,
    __historyIndex: historyIndex,
    content: [{ type: 'text', text }],
  }
}

describe('chat-store history merge ordering', () => {
  it('preserves persisted history order when messages share a timestamp', () => {
    const messages: Array<ChatMessage> = [
      textMessage('m1', 'user', 'first question', 0),
      textMessage('m2', 'assistant', 'first answer', 1),
      textMessage('m3', 'user', 'follow-up', 2),
    ]

    const merged = useChatStore
      .getState()
      .mergeHistoryMessages('history-order-session', messages)

    expect(merged.map((message) => message.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('accepts local-store historyIndex as a persisted order hint', () => {
    const messages: Array<ChatMessage> = [
      {
        id: 'local-1',
        role: 'user',
        timestamp: 1_700_000_000_000,
        historyIndex: 0,
        content: [{ type: 'text', text: 'local question' }],
      },
      {
        id: 'local-2',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        historyIndex: 1,
        content: [{ type: 'text', text: 'local answer' }],
      },
      {
        id: 'local-3',
        role: 'user',
        timestamp: 1_700_000_000_000,
        historyIndex: 2,
        content: [{ type: 'text', text: 'local follow-up' }],
      },
    ]

    const merged = useChatStore
      .getState()
      .mergeHistoryMessages('local-history-order-session', messages)

    expect(merged.map((message) => message.id)).toEqual([
      'local-1',
      'local-2',
      'local-3',
    ])
  })
})

const queuedItem: QueuedChatMessage = {
  id: 'queued-1',
  text: 'queued hello',
  attachments: [],
}

describe('chat message queue state', () => {
  beforeEach(() => {
    useChatStore.setState({
      messageQueue: {},
      messageQueueActivity: {},
    })
  })

  it('normalizes empty queue session keys to main', () => {
    expect(normalizeMessageQueueSessionKey('   ')).toBe('main')
    expect(normalizeMessageQueueSessionKey(' session-1 ')).toBe('session-1')
  })

  it('records visible queue activity when enqueueing and dequeueing', () => {
    useChatStore.getState().enqueue(' session-1 ', queuedItem)

    expect(useChatStore.getState().messageQueue['session-1']).toEqual([
      queuedItem,
    ])
    expect(
      useChatStore.getState().messageQueueActivity['session-1'],
    ).toMatchObject({
      phase: 'queued',
      item: queuedItem,
    })

    expect(useChatStore.getState().dequeue('session-1')).toEqual(queuedItem)

    expect(useChatStore.getState().messageQueue['session-1']).toBeUndefined()
    expect(
      useChatStore.getState().messageQueueActivity['session-1'],
    ).toMatchObject({
      phase: 'sending',
      item: queuedItem,
    })
  })

  it('clears stale queue activity when the queue is cleared', () => {
    useChatStore.getState().enqueue('session-1', queuedItem)
    useChatStore.getState().clearQueue('session-1')

    expect(useChatStore.getState().messageQueue['session-1']).toBeUndefined()
    expect(
      useChatStore.getState().messageQueueActivity['session-1'],
    ).toBeUndefined()
  })
})

describe('chat session interrupted state (Track 1.2)', () => {
  beforeEach(() => {
    useChatStore.setState({
      interruptedSessionKeys: new Set(),
      waitingSessionKeys: new Set(),
      waitingSessionMeta: {},
    })
  })

  it('marks and clears interrupted sessions', () => {
    useChatStore.getState().setSessionInterrupted('session-A')
    expect(useChatStore.getState().isSessionInterrupted('session-A')).toBe(true)
    expect(useChatStore.getState().isSessionInterrupted('session-B')).toBe(
      false,
    )

    useChatStore.getState().clearSessionInterrupted('session-A')
    expect(useChatStore.getState().isSessionInterrupted('session-A')).toBe(
      false,
    )
  })

  it('is independent of waiting state', () => {
    useChatStore.getState().setSessionWaiting('session-A', 'run-1')
    useChatStore.getState().setSessionInterrupted('session-A')

    expect(useChatStore.getState().isSessionWaiting('session-A')).toBe(true)
    expect(useChatStore.getState().isSessionInterrupted('session-A')).toBe(true)

    useChatStore.getState().clearSessionWaiting('session-A')
    expect(useChatStore.getState().isSessionWaiting('session-A')).toBe(false)
    expect(useChatStore.getState().isSessionInterrupted('session-A')).toBe(true)
  })
})

describe('runPhase state machine (Track 2 / Phase 2.1)', () => {
  beforeEach(() => {
    useChatStore.setState({
      runPhase: new Map(),
      waitingSessionKeys: new Set(),
      waitingSessionMeta: {},
      interruptedSessionKeys: new Set(),
    })
  })

  it('starts at idle for unknown sessions', () => {
    expect(useChatStore.getState().getRunPhase('unknown')).toBe('idle')
    expect(useChatStore.getState().isRunPhaseBusy('unknown')).toBe(false)
  })

  it('setSessionWaiting transitions idle → streaming via liveness-snapshot', () => {
    useChatStore.getState().setSessionWaiting('s1', 'run-1')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('streaming')
    expect(useChatStore.getState().isRunPhaseBusy('s1')).toBe(true)
  })

  it('clearSessionWaiting transitions streaming → idle via liveness-clear', () => {
    useChatStore.getState().setSessionWaiting('s1', 'run-1')
    useChatStore.getState().clearSessionWaiting('s1')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('idle')
    expect(useChatStore.getState().isRunPhaseBusy('s1')).toBe(false)
  })

  it('setSessionInterrupted transitions idle → interrupted via predicate-clear', () => {
    useChatStore.getState().setSessionInterrupted('s1')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('interrupted')
    expect(useChatStore.getState().isRunPhaseBusy('s1')).toBe(false)
  })

  it('clearSessionInterrupted transitions interrupted → idle via predicate-clear', () => {
    useChatStore.getState().setSessionInterrupted('s1')
    useChatStore.getState().clearSessionInterrupted('s1')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('idle')
  })

  it('F2 fence: setRunPhase silently drops predicate-clear → streaming', () => {
    useChatStore.getState().setRunPhase('s1', 'streaming', 'predicate-clear')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('idle')
  })

  it('F2 fence: setRunPhase silently drops predicate-clear → sending', () => {
    useChatStore.getState().setRunPhase('s1', 'sending', 'predicate-clear')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('idle')
  })

  it('allows liveness-snapshot → streaming (Track 1.2 authority)', () => {
    useChatStore.getState().setRunPhase('s1', 'streaming', 'liveness-snapshot')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('streaming')
  })

  it('allows sse-event → streaming (Track 2 / Phase 2.1 happy path)', () => {
    useChatStore.getState().setRunPhase('s1', 'sending', 'active-send-set')
    useChatStore.getState().setRunPhase('s1', 'streaming', 'sse-event')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('streaming')
  })

  it('allows sse-complete → complete', () => {
    useChatStore
      .getState()
      .setRunPhase('s1', 'streaming', 'liveness-snapshot')
    useChatStore.getState().setRunPhase('s1', 'complete', 'sse-complete')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('complete')
    expect(useChatStore.getState().isRunPhaseBusy('s1')).toBe(false)
  })

  it('setRunPhase is idempotent for same-phase same-trigger', () => {
    useChatStore
      .getState()
      .setRunPhase('s1', 'streaming', 'liveness-snapshot')
    useChatStore
      .getState()
      .setRunPhase('s1', 'streaming', 'liveness-snapshot')
    expect(useChatStore.getState().getRunPhase('s1')).toBe('streaming')
  })
})
