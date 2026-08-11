// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatMessageList,
  buildDisplayEntries,
  computeCollapsedHeadCount,
  getTrailingToolOnlyTurnSummary,
  isThinkingIndicatorSurfaceVisible,
} from './chat-message-list'
import type { ChatMessage } from '../types'

// Shared across every describe block below — `configurable: true` lets this
// run more than once safely regardless of test declaration order (jsdom's
// `window` is shared across all tests in this file).
function ensureMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

afterEach(cleanup)

function textMessage(
  id: string,
  role: 'user' | 'assistant',
  text: string,
): ChatMessage {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    timestamp: 1,
  }
}

function toolOnlyAssistant(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: `${id}-tool`,
        name: 'terminal',
        arguments: {},
      },
    ],
    timestamp: 2,
  }
}

describe('buildDisplayEntries', () => {
  it('does not attach trailing persisted tool-only assistant messages to the last text reply', () => {
    const entries = buildDisplayEntries([
      textMessage('u1', 'user', 'show issues'),
      textMessage('a1', 'assistant', 'Open issues: 2'),
      toolOnlyAssistant('a2'),
      toolOnlyAssistant('a3'),
    ])

    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.message.id)).toEqual(['u1', 'a1'])
    expect(entries[1].attachedToolMessages).toHaveLength(0)
  })

  it('does not crash when a tool result arrives before any display entry exists', () => {
    const entries = buildDisplayEntries([
      {
        id: 't1',
        role: 'toolResult',
        toolCallId: 'a2-tool',
        toolName: 'terminal',
        content: [{ type: 'text', text: 'ok' }],
        timestamp: 1,
      },
      toolOnlyAssistant('a2'),
      textMessage('a3', 'assistant', 'Done.'),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.message.id).toBe('a3')
    expect(entries[0]?.attachedToolMessages.map((message) => message.id)).toEqual([
      't1',
      'a2',
    ])
  })
})

describe('getTrailingToolOnlyTurnSummary', () => {
  it('detects hidden trailing tool-only messages after the final assistant response', () => {
    const summary = getTrailingToolOnlyTurnSummary([
      textMessage('u1', 'user', 'show issues'),
      textMessage('a1', 'assistant', 'Open issues: 2'),
      toolOnlyAssistant('a2'),
      {
        id: 't1',
        role: 'toolResult',
        toolCallId: 'a2-tool',
        toolName: 'terminal',
        content: [{ type: 'text', text: 'ok' }],
        timestamp: 3,
      },
      toolOnlyAssistant('a3'),
    ])

    expect(summary).toEqual({
      count: 3,
      toolNames: ['terminal'],
      hasFinalAssistantText: true,
    })
  })

  it('returns null when the thread already ends with assistant text', () => {
    const summary = getTrailingToolOnlyTurnSummary([
      textMessage('u1', 'user', 'show issues'),
      toolOnlyAssistant('a2'),
      textMessage('a1', 'assistant', 'Done.'),
    ])

    expect(summary).toBeNull()
  })
})

describe('isThinkingIndicatorSurfaceVisible', () => {
  it('places the response activity indicator beside the Hermes avatar', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/screens/chat/components/chat-message-list.tsx',
      ),
      'utf8',
    )

    expect(source).toContain('aria-label="Hermes is responding"')
    expect(source).toContain('<AssistantAvatar size={28} />')
    expect(source).toContain('<span className="thinking-dot thinking-dot-1" />')
  })

  it('reports the local thinking grace indicator as an active send boundary', () => {
    expect(
      isThinkingIndicatorSurfaceVisible({
        showTypingIndicator: true,
        isCompacting: false,
        liveToolActivityCount: 0,
        isStreaming: false,
        hasStreamingText: false,
        activeToolCallCount: 0,
      }),
    ).toBe(true)
  })

  it('stops reporting the detached indicator once assistant text is visible', () => {
    expect(
      isThinkingIndicatorSurfaceVisible({
        showTypingIndicator: true,
        isCompacting: false,
        liveToolActivityCount: 1,
        isStreaming: true,
        hasStreamingText: true,
        activeToolCallCount: 1,
      }),
    ).toBe(false)
  })
})

describe('computeCollapsedHeadCount', () => {
  it('does not collapse short threads (returns 0 at or below threshold)', () => {
    expect(
      computeCollapsedHeadCount({
        totalEntries: 80,
        expanded: false,
        searchActive: false,
        threshold: 80,
        keepTail: 60,
      }),
    ).toBe(0)
  })

  it('collapses the head of long threads, keeping the tail rendered', () => {
    expect(
      computeCollapsedHeadCount({
        totalEntries: 200,
        expanded: false,
        searchActive: false,
        threshold: 80,
        keepTail: 60,
      }),
    ).toBe(140)
  })

  it('renders everything once the head is expanded', () => {
    expect(
      computeCollapsedHeadCount({
        totalEntries: 200,
        expanded: true,
        searchActive: false,
        threshold: 80,
        keepTail: 60,
      }),
    ).toBe(0)
  })

  it('never collapses while a message search is active', () => {
    expect(
      computeCollapsedHeadCount({
        totalEntries: 500,
        expanded: false,
        searchActive: true,
        threshold: 80,
        keepTail: 60,
      }),
    ).toBe(0)
  })

  it('uses default threshold/keepTail when not provided', () => {
    // default threshold 80, keepTail 60 → 81 entries hides 21 head
    expect(
      computeCollapsedHeadCount({
        totalEntries: 81,
        expanded: false,
        searchActive: false,
      }),
    ).toBe(21)
  })
})

describe('ChatMessageList', () => {
  it('does not crash while waiting with no visible entries yet', () => {
    ensureMatchMedia()

    expect(() =>
      render(
        <ChatMessageList
          messages={[]}
          loading={false}
          empty={false}
          waitingForResponse
          pinToTop={false}
          pinGroupMinHeight={0}
          headerHeight={0}
        />,
      ),
    ).not.toThrow()
  })
})

// Task #9 regression guard. The fix moved approval-kind clarifies to a new
// surface owned entirely by ChatScreen (see chat-screen.approval-surface
// .contract.test.ts) — it deliberately does NOT touch how ChatMessageList
// handles the `clarifyCard` prop, so NON-approval clarifies must keep
// rendering exactly as they did before: attached to the last assistant
// message, hidden when toolDisplayMode is 'hidden', absent when there is no
// assistant message to anchor to. These tests pin that unchanged behavior
// down with real renders so a future edit here can't silently change it.
describe('ChatMessageList clarifyCard placement (non-approval, unchanged by task #9)', () => {
  function assistantThread(): Array<ChatMessage> {
    return [
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        timestamp: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello there' }],
        timestamp: 2,
      },
    ]
  }

  it('attaches the clarifyCard to the last assistant message by default', () => {
    ensureMatchMedia()

    const { getByText } = render(
      <ChatMessageList
        messages={assistantThread()}
        loading={false}
        empty={false}
        waitingForResponse={false}
        pinToTop={false}
        pinGroupMinHeight={0}
        headerHeight={0}
        clarifyCard={<div>CLARIFY_MARKER</div>}
      />,
    )

    expect(getByText('CLARIFY_MARKER')).toBeTruthy()
  })

  it('suppresses the clarifyCard when toolDisplayMode is hidden (pre-existing, unchanged gating)', () => {
    ensureMatchMedia()

    const { queryByText } = render(
      <ChatMessageList
        messages={assistantThread()}
        loading={false}
        empty={false}
        waitingForResponse={false}
        pinToTop={false}
        pinGroupMinHeight={0}
        headerHeight={0}
        clarifyCard={<div>CLARIFY_MARKER</div>}
        toolDisplayMode="hidden"
      />,
    )

    expect(queryByText('CLARIFY_MARKER')).toBeNull()
  })

  it('renders nothing when there is no assistant message to anchor to (pre-existing, unchanged gap)', () => {
    ensureMatchMedia()

    const { queryByText } = render(
      <ChatMessageList
        messages={[
          {
            id: 'u1',
            role: 'user',
            content: [{ type: 'text', text: 'hi' }],
            timestamp: 1,
          },
        ]}
        loading={false}
        empty={false}
        waitingForResponse={false}
        pinToTop={false}
        pinGroupMinHeight={0}
        headerHeight={0}
        clarifyCard={<div>CLARIFY_MARKER</div>}
      />,
    )

    expect(queryByText('CLARIFY_MARKER')).toBeNull()
  })
})
