// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatSourceTabsV2 } from './chat-source-tabs-v2'
import type { SourceTab } from './chat-source-tabs-v2'

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

function queryTab(container: HTMLElement, name: string): HTMLButtonElement | null {
  const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  for (const b of buttons) {
    if (String(b.textContent).includes(name)) return b
  }
  return null
}

describe('ChatSourceTabsV2', () => {
  it('renders all three tabs', () => {
    const { container } = renderInto(
      <ChatSourceTabsV2 activeTab="chat" onTabChange={() => {}} />,
    )
    expect(queryTab(container, 'chat')).not.toBeNull()
    expect(queryTab(container, 'tool')).not.toBeNull()
    expect(queryTab(container, 'activity')).not.toBeNull()
  })

  it('marks the active tab as selected', () => {
    const { container } = renderInto(
      <ChatSourceTabsV2 activeTab="tool" onTabChange={() => {}} />,
    )
    expect(queryTab(container, 'tool')?.getAttribute('aria-selected')).toBe('true')
    expect(queryTab(container, 'chat')?.getAttribute('aria-selected')).toBe('false')
    expect(queryTab(container, 'activity')?.getAttribute('aria-selected')).toBe('false')
  })

  it('calls onTabChange with the correct tab id when clicked', () => {
    const onTabChange = vi.fn<[SourceTab], void>()
    const { container } = renderInto(
      <ChatSourceTabsV2 activeTab="chat" onTabChange={onTabChange} />,
    )
    act(() => {
      queryTab(container, 'activity')?.click()
    })
    expect(onTabChange).toHaveBeenCalledWith('activity')
  })

  it('switches active tab when rerendered with new prop', () => {
    const onTabChange = vi.fn<[SourceTab], void>()
    const { container, root } = renderInto(
      <ChatSourceTabsV2 activeTab="chat" onTabChange={onTabChange} />,
    )
    act(() => {
      root.render(<ChatSourceTabsV2 activeTab="tool" onTabChange={onTabChange} />)
    })
    expect(queryTab(container, 'tool')?.getAttribute('aria-selected')).toBe('true')
    expect(queryTab(container, 'chat')?.getAttribute('aria-selected')).toBe('false')
  })
})
