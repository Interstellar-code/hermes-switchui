// @vitest-environment jsdom
/**
 * Covers the collapsible group headers in the Settings sidebar.
 *
 * With 28 sections across 14 board A intent groups the rail does not fit on a
 * laptop screen, so groups collapse. The two rules worth pinning are the ones
 * that stop collapsing from hiding something the user needs: the group holding
 * the open section can never be collapsed, and a collapsed group still reports
 * unsaved changes — otherwise the save bar's count would have no visible
 * source and a user could not find what they had edited.
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

describe('SidebarTree — board A chips, hints and markers', () => {
  const BOARD_GROUPS: Array<SidebarGroup> = [
    {
      label: 'Models',
      hint: 'fallback · aux',
      items: [
        { id: 'provider', label: 'Provider', dirty: true },
        { id: 'model-registry', label: 'Model Registry' },
      ],
    },
    {
      label: 'Integrations',
      hint: 'mcp · keys',
      items: [
        { id: 'mcp-servers', label: 'Servers', offRec: true },
        { id: 'api-keys', label: 'API Keys', issues: true },
      ],
    },
  ]

  function renderBoard(activeId = 'provider') {
    return render(
      <SidebarTree
        groups={BOARD_GROUPS}
        activeId={activeId}
        onSelect={() => {}}
      />,
    )
  }

  /** Expand a group so its items are in the DOM (groups start collapsed).
   * The group holding the active section auto-opens on mount — clicking its
   * header again would collapse it, so only *other* groups need opening. */
  function open(label: string) {
    fireEvent.click(header(label))
  }

  it('renders the board A hint next to the upper-cased group label', () => {
    renderBoard()
    expect(screen.getByText('fallback · aux')).toBeTruthy()
    expect(screen.getByText('mcp · keys')).toBeTruthy()
  })

  it('shows chip counts taken from the full tree', () => {
    renderBoard()
    expect(screen.getByRole('button', { name: /^Modified · 1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Off-rec · 1$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Issues · 1$/ })).toBeTruthy()
  })

  it('the Modified chip filters the tree to sections with dirty keys', () => {
    renderBoard()
    // Models auto-opens (holds the active section); Integrations needs a click.
    open('Integrations')
    // Unfiltered: every section is reachable.
    expect(screen.getByRole('button', { name: /^Model Registry/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^API Keys/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Modified · 1$/ }))
    expect(screen.getByRole('button', { name: /^Provider/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Model Registry/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^API Keys/ })).toBeNull()
  })

  it('the Issues chip filters to sections with a required-key mismatch', () => {
    renderBoard()
    open('Integrations')
    fireEvent.click(screen.getByRole('button', { name: /^Issues · 1$/ }))
    expect(screen.getByRole('button', { name: /^API Keys/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Provider/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Servers/ })).toBeNull()
  })

  it('the All chip restores the full tree', () => {
    renderBoard()
    open('Integrations')
    fireEvent.click(screen.getByRole('button', { name: /^Issues · 1$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('button', { name: /^Provider/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Servers/ })).toBeTruthy()
  })

  it('marks section rows ● ◆ ▲ and renders the legend under the tree', () => {
    const { container } = renderBoard()
    open('Integrations')
    expect(screen.getByTitle('Modified').textContent).toBe('●')
    expect(screen.getByTitle('Off recommended value').textContent).toBe('◆')
    expect(screen.getByTitle('Config issue').textContent).toBe('▲')

    const legend = container.querySelector('.sk-legend')
    expect(legend?.textContent).toContain('modified')
    expect(legend?.textContent).toContain('off-recommended')
    expect(legend?.textContent).toContain('config issue')
  })
})
