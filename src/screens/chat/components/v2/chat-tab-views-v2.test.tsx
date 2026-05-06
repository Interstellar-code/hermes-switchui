// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { ToolTabView } from './chat-tab-views-v2'

vi.mock('../streaming-activity-ui', () => ({
  formatStreamingActivityLabel: (name: string) => name,
}))

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function renderInto(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    createRoot(container).render(ui)
  })
  return container
}

describe('ToolTabView streaming tool calls', () => {
  it('renders running status for in-progress tool call', () => {
    const streamingToolCalls = [
      { id: 'c1', name: 'foo', phase: 'start', args: { x: 1 } },
    ]
    const container = renderInto(
      <ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain('foo')
    expect(container.textContent).toContain('running')
    expect(container.textContent).not.toContain('done')
  })

  it('renders done status for completed tool call with output', () => {
    const streamingToolCalls = [
      { id: 'c2', name: 'bar', phase: 'complete', args: { y: 2 }, result: 'hi' },
    ]
    const container = renderInto(
      <ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain('bar')
    expect(container.textContent).toContain('done')

    // Click card to expand
    const button = container.querySelector('button[aria-expanded]')!
    act(() => { fireEvent.click(button) })
    expect(container.textContent).toContain('"y": 2')
    expect(container.textContent).toContain('hi')
  })

  it('renders error status for errored tool call', () => {
    const streamingToolCalls = [
      { id: 'c3', name: 'baz', phase: 'error', args: {}, result: 'boom' },
    ]
    const container = renderInto(
      <ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain('baz')
    expect(container.textContent).toContain('error')
  })

  it('renders done status from __streamToolCalls on message', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        __streamToolCalls: [{ id: 'c1', name: 'foo', phase: 'complete', args: { x: 1 }, result: 'OK' }],
      },
    ] as any
    const container = renderInto(<ToolTabView messages={messages} />)
    expect(container.textContent).toContain('foo')
    expect(container.textContent).toContain('done')

    const button = container.querySelector('button[aria-expanded]')!
    act(() => { fireEvent.click(button) })
    expect(container.textContent).toContain('OK')
    expect(container.textContent).toContain('"x": 1')
  })

  it('renders error status from __streamToolCalls with phase error', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        __streamToolCalls: [{ id: 'c2', name: 'bar', phase: 'error', args: {}, result: 'boom' }],
      },
    ] as any
    const container = renderInto(<ToolTabView messages={messages} />)
    expect(container.textContent).toContain('bar')
    expect(container.textContent).toContain('error')
  })

  it('renders running status from __streamToolCalls with phase running', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        __streamToolCalls: [{ id: 'c3', name: 'baz', phase: 'running' }],
      },
    ] as any
    const container = renderInto(<ToolTabView messages={messages} />)
    expect(container.textContent).toContain('baz')
    expect(container.textContent).toContain('running')
    expect(container.textContent).not.toContain('done')
  })

  it('renders done with canExpand true for __streamToolCalls phase done, no result', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        __streamToolCalls: [{ id: 'c4', name: 'qux', phase: 'done' }],
      },
    ] as any
    const container = renderInto(<ToolTabView messages={messages} />)
    expect(container.textContent).toContain('done')
    // canExpand true → button should be clickable (cursor pointer via style)
    const button = container.querySelector('button[aria-expanded]')!
    expect(button.style.cursor).toBe('pointer')
  })

  it('card expansion toggles on click', () => {
    const streamingToolCalls = [
      { id: 'c4', name: 'toggle_me', phase: 'complete', args: { a: 1 }, result: 'out' },
    ]
    const container = renderInto(
      <ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />,
    )
    const button = container.querySelector('button[aria-expanded]')!

    // Initially collapsed — output not visible
    expect(container.querySelector('pre')).toBeNull()

    // Click to expand
    act(() => { fireEvent.click(button) })
    expect(container.querySelectorAll('pre').length).toBeGreaterThan(0)

    // Click to collapse
    act(() => { fireEvent.click(button) })
    expect(container.querySelector('pre')).toBeNull()
  })

  it.each([
    ['failed', 'error'],
    ['failure', 'error'],
    ['result', 'done'],
    ['completed', 'done'],
    ['calling', 'running'],
    ['started', 'running'],
  ])('phase alias %s maps to status %s', (phase, expected) => {
    const streamingToolCalls = [
      { id: `c-${phase}`, name: 'aliasTool', phase, args: { a: 1 }, result: 'r' },
    ]
    const container = renderInto(
      <ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain(expected)
  })

  it('unknown phase falls back to running (matches v1 message-item)', () => {
    const streamingToolCalls = [
      { id: 'c-unk', name: 'mystery', phase: 'mystery-phase', args: { a: 1 } },
    ]
    const container = renderInto(
      <ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain('running')
  })

  it('messageSettled overrides stuck running phase to done (Responses API gap)', () => {
    // Upstream sometimes swallows tool.completed; phase stays 'calling'/'start'.
    // If the enclosing message has __streamingStatus === 'complete', treat as done.
    const messages = [
      {
        role: 'assistant',
        __streamingStatus: 'complete',
        __streamToolCalls: [
          { id: 'call_stuck', name: 'todo', phase: 'calling', args: { x: 1 } },
        ],
      } as unknown as Parameters<typeof ToolTabView>[0]['messages'][number],
    ]
    const container = renderInto(<ToolTabView messages={messages} streamingToolCalls={[]} />)
    expect(container.textContent).toContain('done')
    expect(container.textContent).not.toContain('running')
  })

  it('history-shape streamToolCalls (no underscore) renders as done', () => {
    // claude-api.ts attaches streamToolCalls (no underscore) to history-loaded
    // assistant messages with phase already 'complete'. The component must
    // recognise both the field name and treat it as settled.
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_history', name: 'honcho_profile', arguments: { q: 'x' } },
        ],
        streamToolCalls: [
          { id: 'call_history', name: 'honcho_profile', phase: 'complete', args: { q: 'x' } },
        ],
      } as any,
    ]
    const container = renderInto(<ToolTabView messages={messages} streamingToolCalls={[]} />)
    expect(container.textContent).toContain('done')
    expect(container.textContent).not.toContain('running')
  })

  it('history-shape streamToolCalls with stuck phase still renders as done', () => {
    // Even if a history entry slipped through with a non-complete phase,
    // history-loaded entries should be considered settled by definition.
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_x', name: 'todo', arguments: {} },
        ],
        streamToolCalls: [
          { id: 'call_x', name: 'todo', phase: 'calling', args: {} },
        ],
      } as any,
    ]
    const container = renderInto(<ToolTabView messages={messages} streamingToolCalls={[]} />)
    expect(container.textContent).toContain('done')
  })

  it('history tool_result content block supplies output for matching toolCall', () => {
    // History-loaded tool result: role 'tool' with a tool_result content
    // block carrying toolCallId (no top-level toolCallId field).
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_h1', name: 'honcho_profile', arguments: { q: 'a' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolCallId: 'call_h1', toolName: 'honcho_profile', text: 'profile data' },
        ],
      },
    ] as any
    const container = renderInto(<ToolTabView messages={messages} streamingToolCalls={[]} />)
    expect(container.textContent).toContain('done')
    const button = container.querySelector('button[aria-expanded]')!
    act(() => { fireEvent.click(button) })
    expect(container.textContent).toContain('profile data')
  })

  it('settled message entry beats stuck-running streaming entry for same callId', () => {
    // Live streaming entry for call_a has phase 'calling' (stuck), while a
    // history/__streamToolCalls entry for the same id is already done with a
    // result. The merge should prefer the settled entry.
    const messages = [
      {
        role: 'assistant',
        __streamingStatus: 'complete',
        __streamToolCalls: [
          { id: 'call_a', name: 'todo', phase: 'complete', args: { x: 1 }, result: 'OK' },
        ],
      } as any,
    ]
    const streamingToolCalls = [
      { id: 'call_a', name: 'todo', phase: 'calling', args: { x: 1 } },
    ]
    const container = renderInto(
      <ToolTabView messages={messages} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain('done')
    expect(container.textContent).not.toContain('running')
  })
})
