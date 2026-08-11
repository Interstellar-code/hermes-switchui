// @vitest-environment jsdom
/**
 * Covers the collapsible group headers in the Settings sidebar.
 *
 * With 28 sections across 11 groups the rail does not fit on a laptop screen,
 * so groups collapse. The two rules worth pinning are the ones that stop
 * collapsing from hiding something the user needs: the group holding the open
 * section can never be collapsed, and a collapsed group still reports unsaved
 * changes — otherwise the save bar's count would have no visible source and a
 * user could not find what they had edited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SidebarTree } from './sidebar-tree'
import type { SidebarGroup } from './sidebar-tree'

const GROUPS: Array<SidebarGroup> = [
  {
    label: 'General',
    items: [
      { id: 'workspace', label: 'Workspace' },
      { id: 'appearance', label: 'Appearance' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'safety', label: 'Safety' },
      { id: 'storage', label: 'Storage' },
      { id: 'network', label: 'Network' },
    ],
  },
]

function header(label: string): HTMLButtonElement {
  return screen.getByRole('button', { name: new RegExp(label, 'i') })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('SidebarTree — collapsible groups', () => {
  it('starts collapsed, except the group holding the open section', () => {
    render(<SidebarTree groups={GROUPS} activeId="workspace" onSelect={() => {}} />)

    // General holds the open section, so it stays open…
    expect(header('General').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Workspace')).toBeTruthy()

    // …everything else starts closed.
    expect(header('System').getAttribute('aria-expanded')).toBe('false')
    // `hidden` keeps the items out of the accessibility tree, not just out of
    // sight — a collapsed group must not be reachable by tab or screen reader.
    expect(
      document.getElementById('settings-group-system')?.hasAttribute('hidden'),
    ).toBe(true)
  })

  it('expands a group when its header is clicked, and collapses it again', () => {
    render(<SidebarTree groups={GROUPS} activeId="workspace" onSelect={() => {}} />)

    fireEvent.click(header('System'))
    expect(header('System').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Safety')).toBeTruthy()

    fireEvent.click(header('System'))
    expect(header('System').getAttribute('aria-expanded')).toBe('false')
    expect(
      document.getElementById('settings-group-system')?.hasAttribute('hidden'),
    ).toBe(true)
  })

  /**
   * The group you are in is the one you most want out of the way once you have
   * arrived, so it must be collapsible like any other. Pinning it open was the
   * first implementation and it made the group taking the most space the only
   * one that could not be closed.
   */
  it('lets you collapse the group holding the open section', () => {
    render(<SidebarTree groups={GROUPS} activeId="safety" onSelect={() => {}} />)

    const systemHeader = header('System')
    expect(systemHeader.hasAttribute('disabled')).toBe(false)
    expect(systemHeader.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(systemHeader)
    expect(header('System').getAttribute('aria-expanded')).toBe('false')
  })

  it('names the open section on the collapsed group that holds it', () => {
    render(<SidebarTree groups={GROUPS} activeId="safety" onSelect={() => {}} />)

    fireEvent.click(header('System'))

    // Collapsing where you are must not lose your place.
    expect(header('System').textContent).toContain('Safety')
  })

  it('opens a collapsed group when the active section moves into it', () => {
    const { rerender } = render(
      <SidebarTree groups={GROUPS} activeId="workspace" onSelect={() => {}} />,
    )
    expect(header('System').getAttribute('aria-expanded')).toBe('false')

    // Navigating via search or a deep link must not leave the user staring at
    // a rail with no visible active item.
    rerender(<SidebarTree groups={GROUPS} activeId="storage" onSelect={() => {}} />)
    expect(header('System').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Storage')).toBeTruthy()
  })

  it('keeps a group closed after you close it, without the active section reopening it', () => {
    const { rerender } = render(
      <SidebarTree groups={GROUPS} activeId="safety" onSelect={() => {}} />,
    )
    fireEvent.click(header('System')) // close the group we are in
    expect(header('System').getAttribute('aria-expanded')).toBe('false')

    // A re-render that does not change the active section must not undo that —
    // otherwise the auto-open would fight the user on every keystroke.
    rerender(<SidebarTree groups={GROUPS} activeId="safety" onSelect={() => {}} />)
    expect(header('System').getAttribute('aria-expanded')).toBe('false')
  })

  it('still reports unsaved changes from a collapsed group', () => {
    const dirty: Array<SidebarGroup> = [
      GROUPS[0],
      {
        label: 'System',
        items: [
          { id: 'safety', label: 'Safety', dirty: true },
          { id: 'storage', label: 'Storage' },
          { id: 'network', label: 'Network' },
        ],
      },
    ]
    render(<SidebarTree groups={dirty} activeId="workspace" onSelect={() => {}} />)

    // Collapsed by default, so the marker must be visible without any clicking.
    expect(screen.getByLabelText('1 unsaved')).toBeTruthy()
  })

  it('shows how many sections a collapsed, clean group hides', () => {
    render(<SidebarTree groups={GROUPS} activeId="workspace" onSelect={() => {}} />)

    expect(header('System').textContent).toContain('3')
  })

  it('remembers expanded groups across mounts', () => {
    const { unmount } = render(
      <SidebarTree groups={GROUPS} activeId="workspace" onSelect={() => {}} />,
    )
    fireEvent.click(header('System'))
    unmount()

    render(<SidebarTree groups={GROUPS} activeId="workspace" onSelect={() => {}} />)
    expect(header('System').getAttribute('aria-expanded')).toBe('true')
  })

  it('survives localStorage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    render(<SidebarTree groups={GROUPS} activeId="workspace" onSelect={() => {}} />)

    // A browser refusing storage must not break navigation — the toggle still
    // works for the session, it just does not persist.
    expect(() => fireEvent.click(header('System'))).not.toThrow()
    expect(header('System').getAttribute('aria-expanded')).toBe('true')
  })
})
