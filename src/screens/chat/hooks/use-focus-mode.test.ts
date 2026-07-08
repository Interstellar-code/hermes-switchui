// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { useWorkspaceStore } from '../../../stores/workspace-store'
import { SEARCH_MODAL_EVENTS } from '../../../hooks/use-search-modal'
import { SIDEBAR_TOGGLE_EVENT } from '../../../hooks/use-global-shortcuts'
import { useFocusMode } from './use-focus-mode'
import type { ChatComposerHandle } from '../components/chat-composer-types'
import type { RefObject } from 'react'

function makeComposerRef(
  partial: Partial<ChatComposerHandle> = {},
): RefObject<ChatComposerHandle | null> {
  return { current: partial as ChatComposerHandle }
}

describe('useFocusMode', () => {
  beforeEach(() => {
    cleanup() // unmount any hook from the prior test before touching the store
    useWorkspaceStore.setState({ chatFocusMode: false, sidebarCollapsed: false })
    localStorage.clear()
  })

  afterEach(() => {
    cleanup() // unmount before resetting store so E34 cleanup fires before we clobber
    useWorkspaceStore.setState({ chatFocusMode: false, sidebarCollapsed: false })
    localStorage.clear()
  })

  it('handleToggleFocusMode flips the store value', () => {
    const { result } = renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(false)
    act(() => {
      result.current.handleToggleFocusMode()
    })
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(true)
  })

  it('handleToggleFocusMode does nothing when compact=true', () => {
    const { result } = renderHook(() =>
      useFocusMode({ compact: true, composerHandleRef: makeComposerRef() }),
    )
    act(() => {
      result.current.handleToggleFocusMode()
    })
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(false)
  })

  it('E31: compact=true auto-collapses focus mode in store', () => {
    useWorkspaceStore.setState({ chatFocusMode: true })
    renderHook(() =>
      useFocusMode({ compact: true, composerHandleRef: makeComposerRef() }),
    )
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(false)
  })

  it('E32: Escape key exits focus mode', () => {
    useWorkspaceStore.setState({ chatFocusMode: true })
    renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(false)
  })

  it('E32: Escape key is ignored when defaultPrevented', () => {
    useWorkspaceStore.setState({ chatFocusMode: true })
    renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      event.preventDefault()
      window.dispatchEvent(event)
    })
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(true)
  })

  it('E33: Cmd+. toggles focus mode and calls preventDefault', () => {
    renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    let preventDefaultCalled = false
    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: '.',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(event, 'preventDefault', {
        value: () => {
          preventDefaultCalled = true
        },
        writable: true,
      })
      window.dispatchEvent(event)
    })
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(true)
    expect(preventDefaultCalled).toBe(true)
  })

  it('E33: Ctrl+. toggles focus mode', () => {
    renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true }),
      )
    })
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(true)
  })

  it('E33: Cmd+. does nothing when compact=true', () => {
    renderHook(() =>
      useFocusMode({ compact: true, composerHandleRef: makeComposerRef() }),
    )
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true }),
      )
    })
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(false)
  })

  it('E34: unmount resets focus mode', () => {
    useWorkspaceStore.setState({ chatFocusMode: true })
    const { unmount } = renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(true)
    unmount()
    expect(useWorkspaceStore.getState().chatFocusMode).toBe(false)
  })

  it('fileExplorerCollapsed toggles and persists to localStorage', () => {
    const { result } = renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    expect(result.current.fileExplorerCollapsed).toBe(true) // default
    act(() => {
      result.current.handleToggleFileExplorer()
    })
    expect(result.current.fileExplorerCollapsed).toBe(false)
    expect(localStorage.getItem('claude-file-explorer-collapsed')).toBe('false')
    act(() => {
      result.current.handleToggleFileExplorer()
    })
    expect(result.current.fileExplorerCollapsed).toBe(true)
    expect(localStorage.getItem('claude-file-explorer-collapsed')).toBe('true')
  })

  it('TOGGLE_FILE_EXPLORER window event fires handleToggleFileExplorer', () => {
    const { result } = renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    expect(result.current.fileExplorerCollapsed).toBe(true)
    act(() => {
      window.dispatchEvent(
        new CustomEvent(SEARCH_MODAL_EVENTS.TOGGLE_FILE_EXPLORER),
      )
    })
    expect(result.current.fileExplorerCollapsed).toBe(false)
    expect(localStorage.getItem('claude-file-explorer-collapsed')).toBe('false')
  })

  it('SIDEBAR_TOGGLE_EVENT window event calls toggleSidebar', () => {
    const before = useWorkspaceStore.getState().sidebarCollapsed
    renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef: makeComposerRef() }),
    )
    act(() => {
      window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT))
    })
    expect(useWorkspaceStore.getState().sidebarCollapsed).toBe(!before)
  })

  it('handleInsertFileReference forwards the reference to the composer ref', () => {
    const insertText = vi.fn()
    const composerHandleRef = makeComposerRef({ insertText })
    const { result } = renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef }),
    )

    act(() => {
      result.current.handleInsertFileReference('src/foo.ts')
    })

    expect(insertText).toHaveBeenCalledTimes(1)
    expect(insertText).toHaveBeenCalledWith('src/foo.ts')
  })

  it('handleInsertFileReference is a no-op when the composer ref is null', () => {
    const composerHandleRef: RefObject<ChatComposerHandle | null> = {
      current: null,
    }
    const { result } = renderHook(() =>
      useFocusMode({ compact: false, composerHandleRef }),
    )

    expect(() =>
      act(() => {
        result.current.handleInsertFileReference('src/foo.ts')
      }),
    ).not.toThrow()
  })
})
