import { describe, expect, it } from 'vitest'

import { areMessagesEqual } from './message-item'
import type { ChatMessage } from '../types'

type MessageItemProps = Parameters<typeof areMessagesEqual>[0]

const baseMessage: ChatMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
  timestamp: 1_000,
}

function makeProps(
  attachedToolMessages: Array<ChatMessage>,
): MessageItemProps {
  return {
    message: baseMessage,
    attachedToolMessages,
  }
}

function toolMessage(
  toolCallId: string,
  text: string,
  isError = false,
): ChatMessage {
  return {
    role: 'tool',
    toolCallId,
    toolName: 'read_file',
    isError,
    content: [{ type: 'text', text }],
    timestamp: 1_000,
  }
}

describe('areMessagesEqual — attachedToolMessages', () => {
  it('returns false when attachedToolMessages content changes', () => {
    // Parent rebuilds the array each render, so fresh references with the same
    // content must still be treated as equal — but changed content must not.
    const prev = makeProps([toolMessage('tc-1', 'pending output')])
    const next = makeProps([toolMessage('tc-1', 'final output')])

    expect(areMessagesEqual(prev, next)).toBe(false)
  })

  it('returns false when a tool result flips to an error', () => {
    const prev = makeProps([toolMessage('tc-1', 'output')])
    const next = makeProps([toolMessage('tc-1', 'output', true)])

    expect(areMessagesEqual(prev, next)).toBe(false)
  })

  it('returns false when the number of attached tool messages changes', () => {
    const prev = makeProps([toolMessage('tc-1', 'output')])
    const next = makeProps([
      toolMessage('tc-1', 'output'),
      toolMessage('tc-2', 'output'),
    ])

    expect(areMessagesEqual(prev, next)).toBe(false)
  })

  it('returns true when attachedToolMessages content is unchanged across fresh arrays', () => {
    // Distinct array instances and distinct message objects with identical
    // content — must compare equal so memoization is not defeated.
    const prev = makeProps([toolMessage('tc-1', 'output')])
    const next = makeProps([toolMessage('tc-1', 'output')])

    expect(areMessagesEqual(prev, next)).toBe(true)
  })

  it('returns true when both have no attached tool messages', () => {
    expect(areMessagesEqual(makeProps([]), makeProps([]))).toBe(true)
  })
})

describe('areMessagesEqual — isLastAssistant', () => {
  it('returns false when isLastAssistant changes', () => {
    const prev = {
      message: baseMessage,
      attachedToolMessages: [],
      isLastAssistant: true,
    } as MessageItemProps
    const next = {
      message: baseMessage,
      attachedToolMessages: [],
      isLastAssistant: false,
    } as MessageItemProps

    expect(areMessagesEqual(prev, next)).toBe(false)
  })
})

describe('areMessagesEqual — clarifyCard', () => {
  it('returns false when clarifyCard changes', () => {
    const prev = { message: baseMessage, clarifyCard: 'first' } as MessageItemProps
    const next = { message: baseMessage, clarifyCard: 'second' } as MessageItemProps

    expect(areMessagesEqual(prev, next)).toBe(false)
  })

  it('returns true when clarifyCard is unchanged', () => {
    const clarifyCard = { type: 'clarify-card' }
    const prev = { message: baseMessage, clarifyCard } as MessageItemProps
    const next = { message: baseMessage, clarifyCard } as MessageItemProps

    expect(areMessagesEqual(prev, next)).toBe(true)
  })
})

describe('areMessagesEqual — stable message reference', () => {
  it('skips message content parsing when the message object is unchanged', () => {
    let contentReads = 0
    const message = Object.defineProperty(
      { ...baseMessage },
      'content',
      {
        get() {
          contentReads += 1
          return baseMessage.content
        },
      },
    )
    const props = { message, attachedToolMessages: [] } as MessageItemProps

    expect(areMessagesEqual(props, props)).toBe(true)
    expect(contentReads).toBe(0)
  })
})
