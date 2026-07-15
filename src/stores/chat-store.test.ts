import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isInternalSystemMessage } from '../screens/chat/internal-message-filter'
import {
  STREAMING_PERSIST_DEBOUNCE_MS,
  normalizeMessageQueueSessionKey,
  useChatStore,
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

describe('selectIsComposerBusy (Track 2 / Phase 2.2)', () => {
  beforeEach(() => {
    useChatStore.setState({
      runPhase: new Map(),
      waitingSessionKeys: new Set(),
      waitingSessionMeta: {},
      interruptedSessionKeys: new Set(),
    })
  })

  it('returns false for idle session with no signals', () => {
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(false)
  })

  it('returns true when runPhase is streaming', () => {
    useChatStore
      .getState()
      .setRunPhase('s1', 'streaming', 'liveness-snapshot')
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(true)
  })

  it('returns true when runPhase is sending', () => {
    useChatStore.getState().setRunPhase('s1', 'sending', 'active-send-set')
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(true)
  })

  it('returns true when refSignal.hasActiveSend is true', () => {
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: true },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(true)
  })

  it('returns true when derived.activeIsRealtimeStreaming is true', () => {
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: true, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(true)
  })

  it('returns true when derived.derivedIsStreaming is true', () => {
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: true },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(true)
  })

  it('returns true when pending.hasPendingSend is true', () => {
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: true, hasPendingGeneration: false },
      ),
    ).toBe(true)
  })

  it('returns true when pending.hasPendingGeneration is true', () => {
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: true },
      ),
    ).toBe(true)
  })

  it('returns false when runPhase is interrupted (non-busy terminal)', () => {
    useChatStore.getState().setSessionInterrupted('s1')
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(false)
  })

  it('returns false when runPhase is complete (non-busy terminal)', () => {
    useChatStore
      .getState()
      .setRunPhase('s1', 'streaming', 'liveness-snapshot')
    useChatStore.getState().setRunPhase('s1', 'complete', 'sse-complete')
    expect(
      useChatStore.getState().selectIsComposerBusy(
        's1',
        { hasActiveSend: false },
        { activeIsRealtimeStreaming: false, derivedIsStreaming: false },
        { hasPendingSend: false, hasPendingGeneration: false },
      ),
    ).toBe(false)
  })
})

describe('processEvent realtime ordering (issue #221 part 1)', () => {
  beforeEach(() => {
    useChatStore.setState({ realtimeMessages: new Map() })
  })

  function userMessageEvent(
    sessionKey: string,
    id: string,
    text: string,
    timestamp: number,
  ) {
    return {
      type: 'message' as const,
      sessionKey,
      message: {
        id,
        role: 'user',
        timestamp,
        content: [{ type: 'text' as const, text }],
      } as ChatMessage,
    }
  }

  it('appends in-order messages without disturbing order', () => {
    const sk = 'order-inorder'
    useChatStore.getState().processEvent(userMessageEvent(sk, 'a', 'first', 1000))
    useChatStore
      .getState()
      .processEvent(userMessageEvent(sk, 'b', 'second', 2000))
    useChatStore.getState().processEvent(userMessageEvent(sk, 'c', 'third', 3000))

    const ids = (useChatStore.getState().realtimeMessages.get(sk) ?? []).map(
      (m) => m.id,
    )
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('re-sorts when an out-of-order (older) message arrives last', () => {
    const sk = 'order-outoforder'
    useChatStore.getState().processEvent(userMessageEvent(sk, 'a', 'first', 1000))
    useChatStore.getState().processEvent(userMessageEvent(sk, 'c', 'third', 3000))
    // This one is chronologically between a and c but arrives last.
    useChatStore
      .getState()
      .processEvent(userMessageEvent(sk, 'b', 'second', 2000))

    const ids = (useChatStore.getState().realtimeMessages.get(sk) ?? []).map(
      (m) => m.id,
    )
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('debounced streaming persist (issue #221 part 2/3)', () => {
  const STREAMING_PREFIX = 'claude_streaming_'

  // This test file runs in the node environment (no jsdom), so sessionStorage
  // is not defined. The run-persistence adapter no-ops when it is undefined,
  // so provide a minimal in-memory shim to observe persist behavior.
  function makeMemoryStorage(): Storage {
    const map = new Map<string, string>()
    return {
      get length() {
        return map.size
      },
      clear: () => map.clear(),
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      removeItem: (k: string) => {
        map.delete(k)
      },
      setItem: (k: string, v: string) => {
        map.set(k, String(v))
      },
    }
  }

  beforeEach(() => {
    useChatStore.setState({ streamingState: new Map() })
    vi.stubGlobal('sessionStorage', makeMemoryStorage())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function chunkEvent(sessionKey: string, text: string) {
    return {
      type: 'chunk' as const,
      sessionKey,
      runId: 'run-1',
      text,
    }
  }

  it('does not persist synchronously per chunk; flushes after debounce', () => {
    const sk = 'persist-debounce'
    useChatStore.getState().processEvent(chunkEvent(sk, 'hel'))
    useChatStore.getState().processEvent(chunkEvent(sk, 'hello'))

    // Nothing written yet — the per-session debounce timer is still pending.
    expect(sessionStorage.getItem(`${STREAMING_PREFIX}${sk}`)).toBeNull()

    vi.advanceTimersByTime(STREAMING_PERSIST_DEBOUNCE_MS + 5)

    const raw = sessionStorage.getItem(`${STREAMING_PREFIX}${sk}`)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string) as { text?: string }
    // Latest accumulated text wins (trailing debounce).
    expect(parsed.text).toBe('hello')
  })

  it('cancels the pending persist on stream done (state removed, not resurrected)', () => {
    const sk = 'persist-done'
    useChatStore.getState().processEvent(chunkEvent(sk, 'partial'))
    expect(sessionStorage.getItem(`${STREAMING_PREFIX}${sk}`)).toBeNull()

    useChatStore.getState().processEvent({
      type: 'done',
      sessionKey: sk,
      state: 'final',
      runId: 'run-1',
      message: {
        id: 'final-1',
        role: 'assistant',
        timestamp: 1000,
        content: [{ type: 'text', text: 'partial complete' }],
      },
    })

    // Advancing past the debounce window must NOT write streaming state back —
    // done() cancelled the pending timer and removed the key.
    vi.advanceTimersByTime(STREAMING_PERSIST_DEBOUNCE_MS + 50)
    expect(sessionStorage.getItem(`${STREAMING_PREFIX}${sk}`)).toBeNull()
  })

  it('cancels the pending persist on clearSession', () => {
    const sk = 'persist-clear'
    useChatStore.getState().processEvent(chunkEvent(sk, 'partial'))
    useChatStore.getState().clearSession(sk)

    vi.advanceTimersByTime(STREAMING_PERSIST_DEBOUNCE_MS + 50)
    expect(sessionStorage.getItem(`${STREAMING_PREFIX}${sk}`)).toBeNull()
  })
})

describe('pending clarify deduplication', () => {
  it('preserves richer fields when a duplicate event omits them', () => {
    const processEvent = useChatStore.getState().processEvent
    processEvent({
      type: 'clarify',
      clarifyId: 'clarify-1',
      interactionId: 'clarify-1',
      sessionKey: 'session-1',
      question: 'Choose a deployment',
      choices: ['Staging', 'Production'],
      kind: 'choice',
    })
    processEvent({
      type: 'interaction',
      clarifyId: 'clarify-1',
      interactionId: 'clarify-1',
      sessionKey: 'session-1',
      question: 'Choose a deployment',
      choices: null,
    })

    expect(useChatStore.getState().pendingClarify['session-1']).toMatchObject({
      question: 'Choose a deployment',
      choices: ['Staging', 'Production'],
      kind: 'choice',
    })
  })
})

describe('delegation stream events', () => {
  it('merges subagent progress by stable subagent id', () => {
    const processEvent = useChatStore.getState().processEvent
    processEvent({
      type: 'delegation', kind: 'start', subagentId: 'sa-0-abc', goal: 'Inspect repo',
      childSessionId: 'child-1', depth: 0, sessionKey: 'session-1',
    })
    processEvent({
      type: 'delegation', kind: 'tool', subagentId: 'sa-0-abc', toolName: 'read_file',
      text: 'Reading package.json', toolCount: 1, sessionKey: 'session-1',
    })

    expect(useChatStore.getState().streamingState.get('session-1')?.delegations).toHaveLength(1)
    expect(useChatStore.getState().streamingState.get('session-1')?.delegations[0]).toMatchObject({
      subagentId: 'sa-0-abc', goal: 'Inspect repo', childSessionId: 'child-1',
      kind: 'tool', toolName: 'read_file', text: 'Reading package.json', toolCount: 1,
    })
  })
})

describe('isInternalSystemMessage (issue #221 part 4)', () => {
  it('matches every entry from the chat-store filter list', () => {
    expect(
      isInternalSystemMessage('Pre-compaction memory flush triggered'),
    ).toBe(true)
    expect(
      isInternalSystemMessage('please Store durable memories now for me'),
    ).toBe(true)
    expect(
      isInternalSystemMessage(
        'note: APPEND new content only and do not overwrite existing',
      ),
    ).toBe(true)
    expect(isInternalSystemMessage('A subagent task has finished')).toBe(true)
    expect(
      isInternalSystemMessage('[Queued announce messages] batch 1'),
    ).toBe(true)
    expect(
      isInternalSystemMessage('Summarize this naturally for the user please'),
    ).toBe(true)
    expect(
      isInternalSystemMessage(
        'Stats: runtime 5s for sessionKey agent:main-1',
      ),
    ).toBe(true)
  })

  it('matches mid-string for entries that previously used startsWith in the realtime path', () => {
    // The use-realtime path used startsWith for these — the union now uses
    // includes so neither path regresses.
    expect(
      isInternalSystemMessage('prefix text Store durable memories now'),
    ).toBe(true)
    expect(
      isInternalSystemMessage(
        'context: APPEND new content only and do not overwrite',
      ),
    ).toBe(true)
    expect(
      isInternalSystemMessage('Please Summarize this naturally for the user'),
    ).toBe(true)
  })

  it('does not match ordinary user prose', () => {
    expect(isInternalSystemMessage('')).toBe(false)
    expect(isInternalSystemMessage('how do I store durable data?')).toBe(false)
    expect(
      isInternalSystemMessage('what is the runtime of this function?'),
    ).toBe(false)
    expect(
      isInternalSystemMessage('Stats: runtime 5s'), // missing sessionKey agent:
    ).toBe(false)
  })
})
