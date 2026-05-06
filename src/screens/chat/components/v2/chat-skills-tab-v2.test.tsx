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

/** Build a minimal assistant message with a toolCall content block and a result.
 *  Uses the legacy gateway 'skill' event: skill name is in result output.
 */
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

/** Build a skill_view tool call — name extracted from input.name arg */
function makeSkillViewMessage(callId: string, skillName: string): Array<ChatMessage> {
  const assistantMsg: ChatMessage = {
    id: `a-${callId}`,
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: callId,
        name: 'skill_view',
        arguments: { name: skillName },
      },
    ],
  } as unknown as ChatMessage

  const resultMsg: ChatMessage = {
    id: `r-${callId}`,
    role: 'tool',
    toolCallId: callId,
    toolName: 'skill_view',
    content: [{ type: 'text', text: `# ${skillName} skill content` }],
  } as unknown as ChatMessage

  return [assistantMsg, resultMsg]
}

/** Build a skills_list tool call — catalog enumeration, no specific skill */
function makeSkillsListMessage(callId: string): Array<ChatMessage> {
  const assistantMsg: ChatMessage = {
    id: `a-${callId}`,
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: callId,
        name: 'skills_list',
        arguments: {},
      },
    ],
  } as unknown as ChatMessage

  const resultMsg: ChatMessage = {
    id: `r-${callId}`,
    role: 'tool',
    toolCallId: callId,
    toolName: 'skills_list',
    content: [{ type: 'text', text: 'caveman, ralph, autopilot' }],
  } as unknown as ChatMessage

  return [assistantMsg, resultMsg]
}

/** Build a skill_manage tool call */
function makeSkillManageMessage(callId: string, skillName: string): Array<ChatMessage> {
  const assistantMsg: ChatMessage = {
    id: `a-${callId}`,
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id: callId,
        name: 'skill_manage',
        arguments: { name: skillName, action: 'patch', content: '# updated' },
      },
    ],
  } as unknown as ChatMessage

  const resultMsg: ChatMessage = {
    id: `r-${callId}`,
    role: 'tool',
    toolCallId: callId,
    toolName: 'skill_manage',
    content: [{ type: 'text', text: 'ok' }],
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

  it('does not treat todo tool as a skill', () => {
    const assistantMsg: ChatMessage = {
      id: 'a-todo',
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'id-todo',
          name: 'todo',
          arguments: { todos: [{ content: 'do something' }] },
        },
      ],
    } as unknown as ChatMessage

    const { container } = renderInto(<ChatSkillsTabV2 messages={[assistantMsg]} />)
    expect(container.textContent).toContain('No skills loaded in this session')
  })

  it('does not treat task (kanban) tool as a skill', () => {
    const assistantMsg: ChatMessage = {
      id: 'a-task',
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'id-task',
          name: 'task',
          arguments: { title: 'fix bug' },
        },
      ],
    } as unknown as ChatMessage

    const { container } = renderInto(<ChatSkillsTabV2 messages={[assistantMsg]} />)
    expect(container.textContent).toContain('No skills loaded in this session')
  })

  it('skill_view extracts skill name from input.name arg', () => {
    const messages = makeSkillViewMessage('id-sv1', 'caveman')
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    expect(container.textContent).toContain('caveman')
  })

  it('skill_view with string-wrapped value field extracts skill name', () => {
    const assistantMsg: ChatMessage = {
      id: 'a-sv-wrapped',
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'id-sv-wrapped',
          name: 'skill_view',
          arguments: { value: JSON.stringify({ name: 'ralph' }) },
        },
      ],
    } as unknown as ChatMessage

    const { container } = renderInto(<ChatSkillsTabV2 messages={[assistantMsg]} />)
    expect(container.textContent).toContain('ralph')
  })

  it('skills_list groups as catalog enumeration', () => {
    const messages = makeSkillsListMessage('id-sl1')
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    expect(container.textContent).toContain('skill catalog enumeration')
  })

  it('skill_manage groups with kind edited', () => {
    const messages = makeSkillManageMessage('id-sm1', 'caveman')
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    expect(container.textContent).toContain('caveman')
  })

  it('enumerate filter shows only skills_list entries', () => {
    const messages: Array<ChatMessage> = [
      ...makeSkillMessage('id-leg', 'ralph'),
      ...makeSkillsListMessage('id-list'),
    ]
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    // Click the enumerate filter pill
    const pills = container.querySelectorAll('button')
    const enumeratePill = Array.from(pills).find((b) => b.textContent === 'enumerate')
    expect(enumeratePill).not.toBeNull()
    act(() => { enumeratePill?.click() })
    expect(container.textContent).toContain('skill catalog enumeration')
    expect(container.textContent).not.toContain('ralph')
  })

  it('edited filter shows only skill_manage entries', () => {
    const messages: Array<ChatMessage> = [
      ...makeSkillMessage('id-loaded', 'ralph'),
      ...makeSkillManageMessage('id-managed', 'caveman'),
    ]
    const { container } = renderInto(<ChatSkillsTabV2 messages={messages} />)
    const pills = container.querySelectorAll('button')
    const editedPill = Array.from(pills).find((b) => b.textContent === 'edited')
    expect(editedPill).not.toBeNull()
    act(() => { editedPill?.click() })
    expect(container.textContent).toContain('caveman')
    expect(container.textContent).not.toContain('ralph')
  })
})
