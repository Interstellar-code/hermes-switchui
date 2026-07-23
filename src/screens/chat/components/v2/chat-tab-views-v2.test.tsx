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

  it('renders common tool arguments and results as readable details', () => {
    const container = renderInto(
      <ToolTabView
        messages={[]}
        streamingToolCalls={[
          {
            id: 'readable-1',
            name: 'exec',
            phase: 'complete',
            args: { value: JSON.stringify({ command: 'pnpm vitest run', timeout: 30 }) },
            result: '27 tests passed',
          },
        ]}
      />,
    )

    act(() => { fireEvent.click(container.querySelector('button[aria-expanded]')!) })
    expect(container.textContent).toContain('Command')
    expect(container.textContent).toContain('pnpm vitest run')
    expect(container.textContent).toContain('Result')
    expect(container.textContent).toContain('27 tests passed')
    expect(container.textContent).toContain('Raw input')
    expect(container.textContent).toContain('Raw output')
  })

  it('renders MCP loads as named tool and server lists', () => {
    const container = renderInto(
      <ToolTabView
        view="mcp"
        messages={[]}
        streamingToolCalls={[
          {
            id: 'mcp-tools',
            name: 'load_mcp_tools',
            phase: 'complete',
            args: { tool_names: ['github_search', 'github_get_issue'] },
          },
          {
            id: 'mcp-server',
            name: 'load_mcp_server',
            phase: 'complete',
            args: { server_names: ['github'] },
          },
        ]}
      />,
    )

    const cards = container.querySelectorAll('button[aria-expanded]')
    const [toolsCard, serverCard] = Array.from(cards)
    expect(toolsCard).toBeDefined()
    expect(serverCard).toBeDefined()
    act(() => { fireEvent.click(toolsCard) })
    act(() => { fireEvent.click(serverCard) })
    expect(container.textContent).toContain('MCP tools')
    expect(container.textContent).toContain('github search')
    expect(container.textContent).toContain('MCP servers')
    expect(container.textContent).toContain('github')
  })

  it('uses a readable server and action name for MCP calls', () => {
    const container = renderInto(
      <ToolTabView
        view="mcp"
        messages={[]}
        streamingToolCalls={[
          {
            id: 'mcp-issues',
            name: 'mcp__github__list_issues',
            phase: 'complete',
            args: { query: 'open bugs' },
          },
        ]}
      />,
    )

    expect(container.textContent).toContain('MCP · github · list issues')
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
    const button = container.querySelector('button[aria-expanded]') as HTMLElement
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

  it('unknown phase fails closed to done to avoid phantom running spinners', () => {
    const streamingToolCalls = [
      { id: 'c-unk', name: 'mystery', phase: 'mystery-phase', args: { a: 1 } },
    ]
    const container = renderInto(
      <ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain('done')
    expect(container.textContent).not.toContain('running')
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
    const container = renderInto(<ToolTabView view="todos" messages={messages} streamingToolCalls={[]} />)
    expect(container.textContent).toContain('done')
    expect(container.textContent).not.toContain('running')
  })

  it('history-shape streamToolCalls (no underscore) renders as done', () => {
    // hermes-api.ts attaches streamToolCalls (no underscore) to history-loaded
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
    const container = renderInto(<ToolTabView view="todos" messages={messages} streamingToolCalls={[]} />)
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

  it('keeps todo calls out of the general tools view', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        __streamToolCalls: [{ id: 'call_todo', name: 'todo', phase: 'complete', args: { todos: [] }, result: 'ok' }],
      },
    ] as any
    const container = renderInto(<ToolTabView messages={messages} streamingToolCalls={[]} />)
    expect(container.textContent).toContain('No tool invocations yet')
    expect(container.textContent).not.toContain('call_todo')
  })

  it('shows only todo calls in the todos view', () => {
    const container = renderInto(
      <ToolTabView
        view="todos"
        messages={[]}
        streamingToolCalls={[
          { id: 'todo-1', name: 'todo', phase: 'complete', args: { todos: [] } },
          { id: 'bash-1', name: 'bash', phase: 'complete', args: { command: 'pwd' } },
        ]}
      />,
    )
    expect(container.textContent).toContain('todo')
    expect(container.textContent).not.toContain('bash')
  })

  it('renders wrapped todo input as a readable checklist', () => {
    const container = renderInto(
      <ToolTabView
        view="todos"
        messages={[]}
        streamingToolCalls={[
          {
            id: 'todo-1',
            name: 'todo',
            phase: 'complete',
            args: {
              value: JSON.stringify({
                todos: [
                  { content: 'Ship the focused UI test', status: 'completed' },
                  { content: 'Check the visual result', status: 'in_progress' },
                  { content: 'Write release notes', status: 'pending' },
                ],
              }),
            },
          },
        ]}
      />,
    )
    act(() => { fireEvent.click(container.querySelector('button[aria-expanded]')!) })
    expect(container.textContent).toContain('Ship the focused UI test')
    expect(container.textContent).toContain('Check the visual result')
    expect(container.textContent).toContain('in progress')
    expect(container.textContent).toContain('Write release notes')
    expect(container.textContent).toContain('Raw input')
    expect(container.querySelector('details')?.open).toBe(false)
  })

  it('shows configured MCP calls and excludes ordinary tools in the MCP view', () => {
    const container = renderInto(
      <ToolTabView
        view="mcp"
        mcpToolNames={new Set(['github_search'])}
        messages={[]}
        streamingToolCalls={[
          { id: 'mcp-1', name: 'github_search', phase: 'complete', args: { q: 'switchui' } },
          { id: 'bash-1', name: 'bash', phase: 'complete', args: { command: 'pwd' } },
        ]}
      />,
    )
    expect(container.textContent).toContain('github_search')
    expect(container.textContent).not.toContain('bash')
  })

  it('keeps to-dos and MCP calls out of the general tools view', () => {
    const container = renderInto(
      <ToolTabView
        mcpToolNames={new Set(['github_search'])}
        messages={[]}
        streamingToolCalls={[
          { id: 'todo-1', name: 'todo', phase: 'complete', args: { todos: [] } },
          { id: 'mcp-1', name: 'github_search', phase: 'complete', args: { q: 'switchui' } },
          { id: 'exec-1', name: 'exec', phase: 'complete', args: { command: 'pwd' } },
        ]}
      />,
    )

    expect(container.textContent).toContain('exec')
    expect(container.textContent).not.toContain('todo-1')
    expect(container.textContent).not.toContain('github_search')
  })

  it('moves file operations to the Files view and out of Tools', () => {
    const streamingToolCalls = [
      { id: 'read-1', name: 'read_file', phase: 'complete', args: { file_path: 'src/app.tsx' } },
      { id: 'write-1', name: 'write_file', phase: 'complete', args: { path: 'src/app.tsx' } },
      { id: 'exec-1', name: 'exec', phase: 'complete', args: { command: 'pwd' } },
    ]
    const tools = renderInto(<ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />)
    const files = renderInto(<ToolTabView view="files" messages={[]} streamingToolCalls={streamingToolCalls} />)

    expect(tools.textContent).toContain('exec')
    expect(tools.textContent).not.toContain('read_file')
    expect(tools.textContent).not.toContain('write_file')
    expect(files.textContent).toContain('read_file')
    expect(files.textContent).toContain('write_file')
    expect(files.textContent).not.toContain('exec')
  })

  it('task tool appears under kanban category not skill', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        __streamToolCalls: [{ id: 'call_task', name: 'task', phase: 'complete', args: { title: 'fix' }, result: 'ok' }],
      },
    ] as any
    const container = renderInto(<ToolTabView messages={messages} streamingToolCalls={[]} />)
    const pills = container.querySelectorAll('button')
    const skillPill = Array.from(pills).find((b) => b.textContent === 'skill')
    expect(skillPill).toBeUndefined()
    const kanbanPill = Array.from(pills).find((b) => b.textContent === 'kanban')
    expect(kanbanPill).not.toBeUndefined()
  })

  it('skill_view tool appears under skill category', () => {
    const streamingToolCalls = [
      { id: 'sv1', name: 'skill_view', phase: 'complete', args: { name: 'caveman' }, result: '# caveman' },
    ]
    const container = renderInto(<ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />)
    const pills = container.querySelectorAll('button')
    const skillPill = Array.from(pills).find((b) => b.textContent === 'skill')
    expect(skillPill).not.toBeUndefined()
  })

  it('skills_list tool appears under skill category', () => {
    const streamingToolCalls = [
      { id: 'sl1', name: 'skills_list', phase: 'complete', args: {}, result: 'caveman, ralph' },
    ]
    const container = renderInto(<ToolTabView messages={[]} streamingToolCalls={streamingToolCalls} />)
    const pills = container.querySelectorAll('button')
    const skillPill = Array.from(pills).find((b) => b.textContent === 'skill')
    expect(skillPill).not.toBeUndefined()
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
      <ToolTabView view="todos" messages={messages} streamingToolCalls={streamingToolCalls} />,
    )
    expect(container.textContent).toContain('done')
    expect(container.textContent).not.toContain('running')
  })
})
