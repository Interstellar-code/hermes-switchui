/**
 * `createDefaultTab()` previously hardcoded `'~'` while terminal-workspace.tsx
 * defaulted every user-visible "new terminal" action to `'~/.hermes'`
 * (`DEFAULT_TERMINAL_CWD`) — two independent defaults for the same concept
 * that only agreed by accident. `DEFAULT_TERMINAL_CWD` is now exported from
 * this store as the single source of truth; these tests cover that every
 * fallback-tab path (initial state, closeTab, closeAllTabs) uses it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal localStorage mock — mirrors terminal-panel-store.rehydrate.test.ts.
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => {
    store[key] = val
  },
  removeItem: (key: string) => {
    delete store[key]
  },
  clear: () => {
    for (const k in store) delete store[k]
  },
}
vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('window', { localStorage: localStorageMock })

describe('terminal-panel-store — single default cwd', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  async function getStore() {
    const mod = await import('./terminal-panel-store')
    return mod
  }

  it('exports DEFAULT_TERMINAL_CWD as ~/.hermes', async () => {
    const { DEFAULT_TERMINAL_CWD } = await getStore()
    expect(DEFAULT_TERMINAL_CWD).toBe('~/.hermes')
  })

  it('the initial tab defaults to DEFAULT_TERMINAL_CWD', async () => {
    const { useTerminalPanelStore, DEFAULT_TERMINAL_CWD } = await getStore()
    expect(useTerminalPanelStore.getState().tabs[0].cwd).toBe(
      DEFAULT_TERMINAL_CWD,
    )
  })

  it('closeTab\'s fallback tab (last tab closed) defaults to DEFAULT_TERMINAL_CWD', async () => {
    const { useTerminalPanelStore, DEFAULT_TERMINAL_CWD } = await getStore()
    const onlyTabId = useTerminalPanelStore.getState().tabs[0].id
    useTerminalPanelStore.getState().closeTab(onlyTabId)
    expect(useTerminalPanelStore.getState().tabs).toHaveLength(1)
    expect(useTerminalPanelStore.getState().tabs[0].cwd).toBe(
      DEFAULT_TERMINAL_CWD,
    )
  })

  it('closeAllTabs\'s fallback tab defaults to DEFAULT_TERMINAL_CWD', async () => {
    const { useTerminalPanelStore, DEFAULT_TERMINAL_CWD } = await getStore()
    useTerminalPanelStore.getState().createTab('/some/other/path')
    useTerminalPanelStore.getState().closeAllTabs()
    expect(useTerminalPanelStore.getState().tabs).toHaveLength(1)
    expect(useTerminalPanelStore.getState().tabs[0].cwd).toBe(
      DEFAULT_TERMINAL_CWD,
    )
  })

  it('createTab still honors an explicit cwd override', async () => {
    const { useTerminalPanelStore } = await getStore()
    const id = useTerminalPanelStore.getState().createTab('/explicit/path')
    const tab = useTerminalPanelStore.getState().tabs.find((t) => t.id === id)
    expect(tab?.cwd).toBe('/explicit/path')
  })
})
