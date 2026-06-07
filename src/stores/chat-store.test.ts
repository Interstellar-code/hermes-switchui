import { beforeEach, describe, expect, it } from 'vitest'

import {
  normalizeMessageQueueSessionKey,
  useChatStore,
  type QueuedChatMessage,
} from './chat-store'
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
