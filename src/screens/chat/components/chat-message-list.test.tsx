// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ChatMessageList,
  buildDisplayEntries,
  computeCollapsedHeadCount,
  getTrailingToolOnlyTurnSummary,
  isThinkingIndicatorSurfaceVisible,
} from './chat-message-list'
import type { ChatMessage } from '../types'

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
  it('reports the local thinking grace indicator as an active send boundary', () => {
    expect(
      isThinkingIndicatorSurfaceVisible({
        showTypingIndicator: true,
        showResearchCard: false,
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
        showResearchCard: true,
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
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
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
