// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { SidebarPanelV2 } from './sidebar-panel-v2'
import type { Root } from 'react-dom/client'
import type { SidebarPanelV2Props } from './sidebar-panel-v2'
import type { FlatToolEntry } from './tool-entries'

const { formatLabel } = vi.hoisted(() => ({
  formatLabel: (name: string) => name,
}))
vi.mock('../streaming-activity-ui', () => ({
  formatStreamingActivityLabel: formatLabel,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

const useDelegationsMock = vi.hoisted(() => vi.fn())
const useDelegationMessagesMock = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/use-delegations', () => ({
  useDelegations: (...args: Array<unknown>) => useDelegationsMock(...args),
  useDelegationMessages: (...args: Array<unknown>) =>
    useDelegationMessagesMock(...args),
}))

const ENTRIES: Array<FlatToolEntry> = [
  {
    key: 'e1',
    isCall: true,
    name: 'exec',
    callId: 'c1',
    input: { command: 'ls' },
    output: 'ok',
  },
  {
    key: 'e2',
    isCall: true,
    name: 'mcp__github__search',
    callId: 'c2',
    input: { q: 'x' },
    output: 'ok',
  },
]

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

beforeEach(() => {
  useDelegationsMock.mockReturnValue({
    delegations: [],
    isLoading: false,
    error: null,
  })
  useDelegationMessagesMock.mockReturnValue({
    messages: [],
    isLoading: false,
    error: null,
  })
})

function render(props: Partial<SidebarPanelV2Props> = {}) {
  const container = document.createElement('div')
  container.style.width = '258px'
  document.body.appendChild(container)
  root = createRoot(container)
  const base: SidebarPanelV2Props = {
    panel: 'tool',
    sessionKey: 's1',
    entries: ENTRIES,
    counts: { tool: { value: 7, label: '7 calls, 1 error', errors: 1 } },
    onClose: () => {},
  }
  const draw = (next: Partial<SidebarPanelV2Props> = {}) =>
    act(() => root!.render(<SidebarPanelV2 {...base} {...props} {...next} />))
  draw()
  return { container, rerender: draw }
}

const back = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="Back to sessions"]')!
const search = (c: HTMLElement) =>
  c.querySelector<HTMLInputElement>('[aria-label="Search tools"]')

describe('SidebarPanelV2', () => {
  it('renders title, count label and back button inside a labelled region', () => {
    const { container } = render()
    const region = container.querySelector('[role="region"]')!
    const title = document.getElementById(
      region.getAttribute('aria-labelledby')!,
    )
    expect(region.id).toBe('chat-sidebar-panel')
    expect(title?.textContent).toBe('Tools')
    expect(
      container.querySelector('[data-testid="sidebar-panel-count"]')
        ?.textContent,
    ).toBe('7 calls, 1 error')
    expect(back()).not.toBeNull()
  })

  it('back button calls onClose', () => {
    const onClose = vi.fn()
    render({ onClose })
    act(() => fireEvent.click(back()))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the matching body for each panel', () => {
    const { container, rerender } = render()
    expect(search(container)).not.toBeNull()
    expect(container.textContent).toContain('exec')

    rerender({ panel: 'todos' })
    expect(container.textContent).toContain('No to-do list in this session')
    expect(search(container)).toBeNull()

    rerender({ panel: 'mcp' })
    expect(container.querySelector('[aria-label="MCP servers"]')).not.toBeNull()
    expect(container.textContent).toContain('github')

    rerender({ panel: 'skills' })
    expect(container.textContent).toContain('No skills used in this session')
  })

  it('renders the agents title and the delegation list for the agents panel', () => {
    useDelegationsMock.mockReturnValue({
      delegations: [
        {
          childSessionId: 'child-1',
          goal: 'Ship the agents tab',
          model: 'auto',
          status: 'running',
          inputTokens: 1,
          outputTokens: 2,
          startedAt: 1_000,
          endedAt: null,
        },
      ],
      isLoading: false,
      error: null,
    })
    const { container } = render({
      panel: 'agents',
      counts: { agents: { value: 1, label: '1 agent, 1 live' } },
    })
    const region = container.querySelector('[role="region"]')!
    const title = document.getElementById(
      region.getAttribute('aria-labelledby')!,
    )
    expect(title?.textContent).toBe('Agents')
    expect(
      container.querySelector('[data-testid="sidebar-panel-count"]')
        ?.textContent,
    ).toBe('1 agent, 1 live')
    expect(container.textContent).toContain('Ship the agents tab')
    expect(container.textContent).toContain('1 live')
  })

  it('passes MCP server status through to the MCP panel', () => {
    const { container } = render({
      panel: 'mcp',
      mcpServers: [{ name: 'github', status: 'connected', enabled: true }],
    })
    expect(container.textContent).toContain('connected')
  })

  it('shows the history-capped note in the Tools panel only when capped', () => {
    const { container, rerender } = render()
    expect(container.textContent).not.toContain('latest 150 messages')
    rerender({ historyCapped: true })
    expect(container.textContent).toContain('Covers the latest 150 messages')
  })

  it('fits a 258px sidebar: no fixed min-width anywhere in any panel', () => {
    const { container, rerender } = render()
    for (const panel of ['tool', 'todos', 'mcp', 'skills', 'agents'] as const) {
      rerender({ panel })
      const fixed = [...container.querySelectorAll('[class]')].filter((el) =>
        /(^|\s)min-w-\[/.test(el.getAttribute('class') ?? ''),
      )
      expect(fixed, panel).toEqual([])
    }
  })

  it('Esc in search clears it and prevents default so the panel stays open', () => {
    const onClose = vi.fn()
    const { container } = render({ onClose })
    const input = search(container)!
    act(() => fireEvent.change(input, { target: { value: 'zzz' } }))
    const ev = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      input.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
    expect(search(container)!.value).toBe('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets search when the session or panel changes (keyed body)', () => {
    const { container, rerender } = render()
    act(() =>
      fireEvent.change(search(container)!, { target: { value: 'zzz' } }),
    )
    expect(container.textContent).toContain('No matches')

    rerender({ sessionKey: 's2' })
    expect(search(container)!.value).toBe('')
    expect(container.textContent).toContain('exec')
  })
})
