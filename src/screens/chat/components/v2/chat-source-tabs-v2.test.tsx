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

  it('puts counts in the aria-label and badge only when > 0', () => {
    const c = renderInto(
      <ChatSourceTabsV2 activePanel={null} onTogglePanel={() => {}} counts={{ tool: 12, todos: 0 }} />,
    )
    expect(btn(c, 'Tools')?.getAttribute('aria-label')).toBe('Tools, 12 calls')
    expect(c.querySelector('[data-testid="tab-count-tool"]')?.textContent).toBe('12')
    expect(btn(c, 'Todos')?.getAttribute('aria-label')).toBe('Todos')
    expect(c.querySelector('[data-testid="tab-count-todos"]')).toBeNull()
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
