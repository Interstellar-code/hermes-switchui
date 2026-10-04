// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SidebarPanelHostV2 } from './sidebar-panel-host-v2'
import type { Root } from 'react-dom/client'
import type { SidebarPanel } from './sidebar-panel-v2'

vi.mock('../streaming-activity-ui', () => ({
  formatStreamingActivityLabel: (name: string) => name,
}))

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(
  activePanel: SidebarPanel | null,
  {
    sidebarAvailable = true,
    withShell = sidebarAvailable,
  }: { sidebarAvailable?: boolean; withShell?: boolean } = {},
) {
  const onClose = vi.fn()
  const shell = document.createElement('div')
  shell.dataset.testid = 'sidebar-shell-v2'
  if (withShell) document.body.appendChild(shell)
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = (panel: SidebarPanel | null) =>
    act(() =>
      root!.render(
        <SidebarPanelHostV2
          activePanel={panel}
          onClose={onClose}
          sidebarAvailable={sidebarAvailable}
          sessionKey="s1"
          entries={[]}
          fileExplorer={<div data-testid="explorer" />}
        />,
      ),
    )
  draw(activePanel)
  return { shell, container, onClose, rerender: draw }
}

const sheet = () => document.querySelector('[data-sidebar-panel-sheet]')

const pressEsc = (target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

describe('SidebarPanelHostV2', () => {
  it('portals a content panel into the sidebar shell when present', () => {
    const { shell } = render('tool')
    expect(
      shell.querySelector('#chat-sidebar-panel')?.getAttribute('role'),
    ).toBe('region')
    expect(sheet()).toBeNull()
  })

  it('renders a modal sheet when there is no sidebar', () => {
    render('todos', { sidebarAvailable: false })
    expect(sheet()?.getAttribute('role')).toBe('dialog')
    expect(sheet()?.getAttribute('aria-label')).toBe('Todos')
    expect(sheet()?.querySelector('#chat-sidebar-panel')).not.toBeNull()
  })

  it('falls back to the sheet when the sidebar node is missing', () => {
    render('mcp', { sidebarAvailable: true, withShell: false })
    expect(sheet()).not.toBeNull()
  })

  it('renders nothing for no active panel (hideUi/compact pass null)', () => {
    const { shell } = render(null)
    expect(shell.childElementCount).toBe(0)
    expect(sheet()).toBeNull()
    expect(document.getElementById('chat-sidebar-panel')).toBeNull()
  })

  it('files: explorer in the shell, inert once closed, nothing without a sidebar', () => {
    const { shell, rerender } = render('files')
    const explorer = shell.querySelector('[data-testid="explorer"]')
    expect(explorer).not.toBeNull()
    rerender(null)
    expect(explorer?.parentElement?.hasAttribute('inert')).toBe(true)
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ''
    render('files', { sidebarAvailable: false })
    expect(document.querySelector('[data-testid="explorer"]')).toBeNull()
  })

  it('Esc closes the panel and marks the event handled for focus mode', () => {
    let seenPrevented: boolean | null = null
    const focusModeEsc = (e: KeyboardEvent) => {
      seenPrevented = e.defaultPrevented
    }
    window.addEventListener('keydown', focusModeEsc)
    try {
      const { onClose } = render('tool')
      pressEsc()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(seenPrevented).toBe(true)
    } finally {
      window.removeEventListener('keydown', focusModeEsc)
    }
  })

  it('Esc with an open menu is left to the menu, which still receives it', () => {
    const { onClose } = render('tool')
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    const menuEsc = vi.fn()
    document.addEventListener('keydown', menuEsc)
    try {
      pressEsc()
      expect(onClose).not.toHaveBeenCalled()
      expect(menuEsc).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', menuEsc)
    }
  })

  it('Esc in a text input is left alone', () => {
    const { onClose } = render('tool')
    const input = document.createElement('input')
    document.body.appendChild(input)
    pressEsc(input)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('no Esc listener while no panel is visible', () => {
    const { onClose } = render('files', { sidebarAvailable: false })
    pressEsc()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sheet moves focus inside and returns it on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { rerender } = render('skills', { sidebarAvailable: false })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(sheet()?.contains(document.activeElement)).toBe(true)
    rerender(null)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(document.activeElement).toBe(opener)
  })

  it('returns focus to the toggle when a sidebar panel closes', () => {
    const group = document.createElement('div')
    group.setAttribute('aria-label', 'Sidebar panels')
    const toggle = document.createElement('button')
    toggle.dataset.panel = 'tool'
    group.appendChild(toggle)
    document.body.appendChild(group)
    const { rerender, shell } = render('tool')
    shell
      .querySelector<HTMLButtonElement>('[aria-label="Back to sessions"]')!
      .focus()
    rerender(null)
    expect(document.activeElement).toBe(toggle)
  })
})
