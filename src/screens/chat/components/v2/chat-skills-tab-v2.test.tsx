// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatSkillsTabV2 } from './chat-skills-tab-v2'
import type { ChatMessage } from '../../types'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderInto(ui: React.ReactElement): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return { container, root }
}

/** Build a minimal assistant message with a toolCall content block and a result */
function makeSkillMessage(callId: string, skillName: string): Array<ChatMessage> {
  const assistantMsg: ChatMessage = {
    id: `a-${callId}`,
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: callId,
        name: 'skill',
        arguments: { skill: skillName },
      },
    ],
  } as unknown as ChatMessage

  const resultMsg: ChatMessage = {
    id: `r-${callId}`,
    role: 'tool',
    toolCallId: callId,
    toolName: 'skill',
    content: [{ type: 'text', text: skillName }],
  } as unknown as ChatMessage

  return [assistantMsg, resultMsg]
}

describe('ChatSkillsTabV2', () => {
  it('renders two skill cards for two distinct skill entries', () => {
    const messages: Array<ChatMessage> = [
      ...makeSkillMessage('id-1', 'caveman'),
      ...makeSkillMessage('id-2', 'ralph'),
    ]
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    const text = container.textContent ?? ''
    expect(text).toContain('caveman')
    expect(text).toContain('ralph')
  })

  it('groups multiple invocations of the same skill and shows correct count badge', () => {
    const messages: Array<ChatMessage> = [
      ...makeSkillMessage('id-a1', 'caveman'),
      ...makeSkillMessage('id-a2', 'caveman'),
      ...makeSkillMessage('id-a3', 'caveman'),
    ]
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    const text = container.textContent ?? ''
    // One card for 'caveman'
    const cards = container.querySelectorAll('[aria-expanded]')
    expect(cards.length).toBe(1)
    // Count badge shows ×3
    expect(text).toContain('×3')
  })

  it('renders "unknown skill" card when result is missing', () => {
    // Message with toolCall but no corresponding result message
    const assistantMsg: ChatMessage = {
      id: 'a-noresult',
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'id-noresult',
          name: 'skill',
          arguments: {},
        },
      ],
    } as unknown as ChatMessage

    const { container } = renderInto(<ChatSkillsTabV2 messages={[assistantMsg]} />)
    expect(container.textContent).toContain('unknown skill')
  })

  it('expands invocation list on card click', () => {
    const messages: Array<ChatMessage> = [
      ...makeSkillMessage('id-exp1', 'caveman'),
      ...makeSkillMessage('id-exp2', 'caveman'),
    ]
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    const card = container.querySelector<HTMLButtonElement>('[aria-expanded]')
    expect(card).not.toBeNull()
    expect(card?.getAttribute('aria-expanded')).toBe('false')
    act(() => {
      card?.click()
    })
    expect(card?.getAttribute('aria-expanded')).toBe('true')
    // Two invocation rows (#1 and #2)
    expect(container.textContent).toContain('#1')
    expect(container.textContent).toContain('#2')
  })

  it('shows empty state when no messages are provided', () => {
    const { container } = renderInto(<ChatSkillsTabV2 messages={[]} />)
    expect(container.textContent).toContain('No skills loaded in this session')
  })

  it('does not count non-skill tool calls', () => {
    const assistantMsg: ChatMessage = {
      id: 'a-bash',
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'id-bash',
          name: 'bash',
          arguments: { command: 'ls' },
        },
      ],
    } as unknown as ChatMessage

    const { container } = renderInto(<ChatSkillsTabV2 messages={[assistantMsg]} />)
    expect(container.textContent).toContain('No skills loaded in this session')
  })
})
