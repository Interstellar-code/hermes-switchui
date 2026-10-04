// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatSourceTabsV2 } from './chat-source-tabs-v2'
import type { SidebarPanel } from './chat-source-tabs-v2'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function renderInto(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    createRoot(container).render(ui)
  })
  return container
}

function btn(container: HTMLElement, labelStart: string): HTMLButtonElement | null {
  for (const b of container.querySelectorAll<HTMLButtonElement>('button')) {
    if ((b.getAttribute('aria-label') ?? '').startsWith(labelStart)) return b
  }
  return null
}

describe('ChatSourceTabsV2', () => {
  it('is a labelled group of five panel buttons with no chat button', () => {
    const c = renderInto(<ChatSourceTabsV2 activePanel={null} onTogglePanel={() => {}} />)
    const group = c.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe('Sidebar panels')
    expect(c.querySelector('[role="tablist"]')).toBeNull()
    expect(
      Array.from(c.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Files', 'Tools', 'Todos', 'MCP', 'Skills'])
    expect(btn(c, 'Chat')).toBeNull()
  })

  it('reflects activePanel in aria-pressed', () => {
    const c = renderInto(<ChatSourceTabsV2 activePanel="mcp" onTogglePanel={() => {}} />)
    expect(btn(c, 'MCP')?.getAttribute('aria-pressed')).toBe('true')
    expect(btn(c, 'Tools')?.getAttribute('aria-pressed')).toBe('false')
    expect(btn(c, 'Files')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('calls onTogglePanel with the panel id, including for the active panel', () => {
    const onTogglePanel = vi.fn((_p: SidebarPanel) => {})
    const c = renderInto(<ChatSourceTabsV2 activePanel="skills" onTogglePanel={onTogglePanel} />)
    act(() => btn(c, 'Files')?.click())
    act(() => btn(c, 'Skills')?.click())
    expect(onTogglePanel.mock.calls.map((a) => a[0])).toEqual(['files', 'skills'])
  })

  it('puts count labels in the aria-label and badges only when non-empty', () => {
    const c = renderInto(
      <ChatSourceTabsV2
        activePanel={null}
        onTogglePanel={() => {}}
        counts={{
          tool: { value: 66, label: '66 calls, 4 errors', errors: 4 },
          todos: { value: '3/7', label: '3 of 7 done' },
          mcp: { value: 3, label: '3 servers' },
          skills: { value: 0, label: '0 used' },
        }}
      />,
    )
    expect(btn(c, 'Tools')?.getAttribute('aria-label')).toBe('Tools, 66 calls, 4 errors')
    expect(c.querySelector('[data-testid="tab-count-tool"]')?.textContent).toBe('66')
    expect(c.querySelector('[data-testid="tab-errors-tool"]')?.textContent).toBe('4')
    expect(btn(c, 'Todos')?.getAttribute('aria-label')).toBe('Todos, 3 of 7 done')
    expect(c.querySelector('[data-testid="tab-count-todos"]')?.textContent).toBe('3/7')
    expect(btn(c, 'MCP')?.getAttribute('aria-label')).toBe('MCP, 3 servers')
    expect(btn(c, 'Skills')?.getAttribute('aria-label')).toBe('Skills')
    expect(c.querySelector('[data-testid="tab-count-skills"]')).toBeNull()
    expect(c.querySelector('[data-testid="tab-errors-mcp"]')).toBeNull()
  })

  it('no error number when a tool count has no errors', () => {
    const c = renderInto(
      <ChatSourceTabsV2
        activePanel={null}
        onTogglePanel={() => {}}
        counts={{ tool: { value: 2, label: '2 calls', errors: 0 } }}
      />,
    )
    expect(btn(c, 'Tools')?.getAttribute('aria-label')).toBe('Tools, 2 calls')
    expect(c.querySelector('[data-testid="tab-errors-tool"]')).toBeNull()
  })

  it('hideFiles omits the files button', () => {
    const c = renderInto(<ChatSourceTabsV2 activePanel={null} onTogglePanel={() => {}} hideFiles />)
    expect(btn(c, 'Files')).toBeNull()
    expect(c.querySelectorAll('button')).toHaveLength(4)
  })

  it('only the active button points aria-controls at the panel', () => {
    const c = renderInto(<ChatSourceTabsV2 activePanel="tool" onTogglePanel={() => {}} />)
    expect(btn(c, 'Tools')?.getAttribute('aria-controls')).toBe('chat-sidebar-panel')
    expect(btn(c, 'MCP')?.hasAttribute('aria-controls')).toBe(false)
  })
})
