// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
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

const ENTRIES: Array<FlatToolEntry> = [
  {
    key: 'e1',
    isCall: true,
    name: 'exec',
    callId: 'c1',
    input: { command: 'ls' },
    output: 'RAW_OUTPUT_MARKER',
  },
]

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(props: Partial<SidebarPanelV2Props> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const base: SidebarPanelV2Props = {
    panel: 'tool',
    sessionKey: 's1',
    entries: ENTRIES,
    counts: { tool: 7 },
    onClose: () => {},
  }
  const draw = (next: Partial<SidebarPanelV2Props> = {}) =>
    act(() => root!.render(<SidebarPanelV2 {...base} {...props} {...next} />))
  draw()
  return { container, rerender: draw }
}

const back = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="Back to sessions"]')!

function typeSearch(container: HTMLElement, value: string) {
  act(() =>
    fireEvent.click(container.querySelector('[aria-label="Open search"]')!),
  )
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Search tool calls"]',
  )!
  act(() => fireEvent.change(input, { target: { value } }))
  return input
}

describe('SidebarPanelV2', () => {
  it('renders title, count and back button inside a labelled region', () => {
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
    ).toBe('7')
    expect(back()).not.toBeNull()
    expect(container.textContent).toContain('exec')
  })

  it('back button calls onClose', () => {
    const onClose = vi.fn()
    render({ onClose })
    act(() => fireEvent.click(back()))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the skills body for the skills panel', () => {
    const { container } = render({ panel: 'skills', counts: {} })
    expect(container.textContent).toContain('Skills')
    expect(container.textContent).toContain('No skills loaded')
  })

  it('shows a filtered-empty message distinct from the real empty state', () => {
    const { container, rerender } = render()
    typeSearch(container, 'zzz-no-match')
    expect(container.textContent).toContain('No matches for this filter')
    expect(container.textContent).not.toContain('No tool invocations yet')

    rerender({ entries: [] })
    expect(container.textContent).toContain('No tool invocations yet')
    expect(container.textContent).not.toContain('No matches for this filter')
  })

  it('Esc in search clears it and prevents default so the panel stays open', () => {
    const onClose = vi.fn()
    const { container } = render({ onClose })
    const input = typeSearch(container, 'zzz')
    const ev = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    const windowSpy = vi.fn()
    window.addEventListener('keydown', windowSpy)
    act(() => {
      input.dispatchEvent(ev)
    })
    window.removeEventListener('keydown', windowSpy)
    expect(ev.defaultPrevented).toBe(true)
    expect(windowSpy).not.toHaveBeenCalled()
    expect(
      container.querySelector('[aria-label="Search tool calls"]'),
    ).toBeNull()
    expect(container.textContent).toContain('exec')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets filters when the session or panel changes (keyed body)', () => {
    const { container, rerender } = render()
    typeSearch(container, 'zzz-no-match')
    expect(container.textContent).toContain('No matches for this filter')

    rerender({ sessionKey: 's2' })
    expect(
      container.querySelector('[aria-label="Search tool calls"]'),
    ).toBeNull()
    expect(container.textContent).toContain('exec')

    typeSearch(container, 'zzz-no-match')
    rerender({ sessionKey: 's2', panel: 'mcp' })
    rerender({ sessionKey: 's2', panel: 'tool' })
    expect(
      container.querySelector('[aria-label="Search tool calls"]'),
    ).toBeNull()
  })

  it('does not render raw output until its details element is opened', () => {
    const { container } = render()
    act(() =>
      fireEvent.click(container.querySelector('button[aria-expanded]')!),
    )
    expect(container.textContent).toContain('Raw output')
    expect(container.querySelector('pre')).toBeNull()

    const details = Array.from(container.querySelectorAll('details')).find(
      (d) => d.textContent.includes('Raw output'),
    )!
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(container.querySelector('pre')?.textContent).toBe(
      'RAW_OUTPUT_MARKER',
    )
  })

  describe('sheet variant', () => {
    it('is a modal dialog that focuses back on open and restores focus on close', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()

      const { container } = render({ variant: 'sheet' })
      const dialog = container.querySelector('[role="dialog"]')!
      expect(dialog.getAttribute('aria-modal')).toBe('true')
      expect(dialog.className).toContain('fixed')
      expect(document.activeElement).toBe(back())

      act(() => root!.unmount())
      root = null
      expect(document.activeElement).toBe(opener)
    })

    it('returns focus to returnFocusRef when provided', () => {
      const toggle = document.createElement('button')
      document.body.appendChild(toggle)
      render({ variant: 'sheet', returnFocusRef: { current: toggle } })
      expect(document.activeElement).toBe(back())
      act(() => root!.unmount())
      root = null
      expect(document.activeElement).toBe(toggle)
    })

    it('sidebar variant does not steal focus', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()
      render()
      expect(document.activeElement).toBe(opener)
    })
  })
})
