// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import { useDisplayMessages } from './use-display-messages'
import type { ChatMessage } from '../types'

function userMsg(text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { role: 'user', content: [{ type: 'text', text }], ...overrides }
}

function assistantMsg(
  text: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return { role: 'assistant', content: [{ type: 'text', text }], ...overrides }
}

function assistantToolCall(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'tc-1', name: 'bash' }],
    ...overrides,
  }
}

const QUEUED_MARKER = '[Queued messages while agent was busy]'

function queuedWrapper(inner: string): string {
  return `${QUEUED_MARKER}\n---\nQueued #1\n${inner}`
}

function renderDisplay(
  realtimeMessages: Array<ChatMessage>,
  opts: {
    activeIsRealtimeStreaming?: boolean
    realtimeStreamingThinking?: string
  } = {},
) {
  const { result } = renderHook(() =>
    useDisplayMessages({
      realtimeMessages,
      activeIsRealtimeStreaming: opts.activeIsRealtimeStreaming ?? false,
      activeToolCalls: [],
      realtimeStreamingThinking: opts.realtimeStreamingThinking ?? '',
    }),
  )
  return result.current.finalDisplayMessages
}

describe('useDisplayMessages', () => {
  beforeEach(() => {
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  // ── Phase 1: Filter ──────────────────────────────────────────────────

  it('filters out user messages starting with "A subagent task"', () => {
    const msgs = [
      userMsg('A subagent task was dispatched'),
      userMsg('Hello world'),
    ]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
    expect(result[0].content![0]).toMatchObject({ text: 'Hello world' })
  })

  it('filters out queued-wrapped user messages whose stripped text starts with "A subagent task"', () => {
    const msgs = [userMsg(queuedWrapper('A subagent task was dispatched'))]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(0)
  })

  it('keeps assistant messages with text content', () => {
    const msgs = [assistantMsg('I can help with that')]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
  })

  it('keeps assistant messages with tool calls only (no text)', () => {
    const msgs = [assistantToolCall()]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
  })

  it('keeps assistant messages with __streamToolCalls only', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [],
        __streamToolCalls: [{ id: 'x', name: 'bash', phase: 'calling' }],
      } as ChatMessage,
    ]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
  })

  it('drops assistant messages with no text and no tool calls', () => {
    const msgs = [{ role: 'assistant', content: [] } as ChatMessage]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(0)
  })

  it('keeps streaming assistant messages regardless of content', () => {
    const msgs = [
      { role: 'assistant', content: [], __streamingStatus: 'streaming' } as ChatMessage,
    ]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
  })

  it('drops messages with unknown roles', () => {
    const msgs = [{ role: 'system', content: [{ type: 'text', text: 'sys' }] } as ChatMessage]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(0)
  })

  // ── Phase 3: Deduplicate ─────────────────────────────────────────────

  it('deduplicates by primary key (same id → one message)', () => {
    const msgs = [
      assistantMsg('Hello', { id: 'msg-1' }),
      assistantMsg('Hello', { id: 'msg-1' }),
    ]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
  })

  it('deduplicates by alternate keys (clientId / client_id / nonce)', () => {
    const msgs = [
      userMsg('Hi', { clientId: 'c1' }),
      userMsg('Hi', { client_id: 'c1' }),
    ]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
  })

  it('deduplicates assistant messages with same text (shouldCollapseTextDuplicate)', () => {
    const msgs = [
      assistantMsg('I am helping', { id: 'a1' }),
      assistantMsg('I am helping', { id: 'a2' }),
    ]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
  })

  it('prefers server-confirmed message over optimistic duplicate (sort for dedup)', () => {
    const optimistic = userMsg('Same text', { __optimisticId: 'opt-abc' })
    const confirmed = userMsg('Same text', { id: 'real-1' })
    // Optimistic first in input — server version should still win
    const result = renderDisplay([optimistic, confirmed])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('real-1')
  })

  // ── Phase 4: Strip queued wrappers ───────────────────────────────────

  it('strips queued-wrapper markers from user messages', () => {
    const inner = 'My real question'
    const msgs = [userMsg(queuedWrapper(inner))]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
    expect(result[0].content![0]).toMatchObject({ text: inner })
  })

  it('does not strip content from assistant messages', () => {
    const text = queuedWrapper('keep me')
    const msgs = [assistantMsg(text, { id: 'a-1' })]
    const result = renderDisplay(msgs)
    expect(result).toHaveLength(1)
    // Assistant messages are not queued-wrapped; text passes through unchanged
    expect(result[0].content![0]).toMatchObject({ text })
  })

  // ── Phase 5: Inject streaming placeholder ────────────────────────────

  it('injects a streaming placeholder when actively streaming', () => {
    const msgs = [userMsg('Hello'), assistantMsg('Hi there', { id: 'a-1' })]
    const { result } = renderHook(() =>
      useDisplayMessages({
        realtimeMessages: msgs,
        activeIsRealtimeStreaming: true,
        activeToolCalls: [],
        realtimeStreamingThinking: 'thinking...',
      }),
    )
    const display = result.current.finalDisplayMessages
    const streaming = display.filter(
      (m) => m.__streamingStatus === 'streaming',
    )
    expect(streaming.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT inject a placeholder when not streaming', () => {
    const msgs = [userMsg('Hello'), assistantMsg('Hi there', { id: 'a-1' })]
    const result = renderDisplay(msgs, { activeIsRealtimeStreaming: false })
    expect(
      result.some((m) => m.__streamingStatus === 'streaming'),
    ).toBe(false)
  })

  it('reuses the current-turn assistant instead of injecting a duplicate streaming row', () => {
    const msgs = [userMsg('Hello'), assistantMsg('Response', { id: 'a-1' })]
    const { result } = renderHook(() =>
      useDisplayMessages({
        realtimeMessages: msgs,
        activeIsRealtimeStreaming: true,
        activeToolCalls: [],
        realtimeStreamingThinking: '',
      }),
    )
    const display = result.current.finalDisplayMessages
    const streaming = display.filter(
      (m) => m.__streamingStatus === 'streaming',
    )
    expect(display).toHaveLength(2)
    expect(streaming).toHaveLength(1)
    expect(streaming[0]).toMatchObject({ id: 'a-1' })
    expect(streaming[0].content?.[0]).toMatchObject({ text: 'Response' })
  })

  it('places a streaming placeholder after the last user when no assistant exists yet', () => {
    const msgs = [userMsg('Hello')]
    const { result } = renderHook(() =>
      useDisplayMessages({
        realtimeMessages: msgs,
        activeIsRealtimeStreaming: true,
        activeToolCalls: [],
        realtimeStreamingThinking: '',
      }),
    )
    const display = result.current.finalDisplayMessages
    expect(display).toHaveLength(2)
    expect(display[1]).toMatchObject({
      role: 'assistant',
      __optimisticId: 'streaming-current',
      __streamingStatus: 'streaming',
    })
  })

  it('replaces an existing streaming message rather than adding a duplicate', () => {
    const existing: ChatMessage = {
      role: 'assistant',
      content: [],
      __streamingStatus: 'streaming',
      __optimisticId: 'old-stream',
    }
    const msgs = [userMsg('Hi'), existing]
    const { result } = renderHook(() =>
      useDisplayMessages({
        realtimeMessages: msgs,
        activeIsRealtimeStreaming: true,
        activeToolCalls: [],
        realtimeStreamingThinking: 'new-thoughts',
      }),
    )
    const display = result.current.finalDisplayMessages
    const streaming = display.filter(
      (m) => m.__streamingStatus === 'streaming',
    )
    expect(streaming).toHaveLength(1)
  })

  // ── Stability ─────────────────────────────────────────────────────────

  it('returns stable array identity when deps do not change', () => {
    const msgs = [userMsg('Hello')]
    const stableToolCalls: Array<{ id: string; name: string; phase: string }> = []
    const { result, rerender } = renderHook(() =>
      useDisplayMessages({
        realtimeMessages: msgs,
        activeIsRealtimeStreaming: false,
        activeToolCalls: stableToolCalls,
        realtimeStreamingThinking: '',
      }),
    )
    const first = result.current.finalDisplayMessages
    rerender()
    expect(result.current.finalDisplayMessages).toBe(first)
  })
})
