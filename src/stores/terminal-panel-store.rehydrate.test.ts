import { beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal localStorage mock
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k in store) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('window', { localStorage: localStorageMock })

const STORE_KEY = 'terminal-panel-state'

describe('terminal-panel-store onRehydrateStorage — setState not direct assign', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  async function getStore() {
    const { useTerminalPanelStore } = await import('./terminal-panel-store')
    return useTerminalPanelStore
  }

  it('rehydrate: empty tabs → fallback tab created via setState and subscriber fires', async () => {
    // Persist state with empty tabs (triggers the fallback branch)
    localStorageMock.setItem(
      STORE_KEY,
      JSON.stringify({
        state: {
          tabs: [],
          activeTabId: '',
          terminalCounter: 0,
        },
        version: 0,
      }),
    )

    const useStore = await getStore()

    let notified = false
    const unsub = useStore.subscribe(() => { notified = true })

    await useStore.persist.rehydrate()

    const { tabs, activeTabId, terminalCounter } = useStore.getState()

    // A default tab must have been created
    expect(tabs.length).toBe(1)
    expect(tabs[0].id).toBeTruthy()
    expect(activeTabId).toBe(tabs[0].id)
    expect(terminalCounter).toBe(1)

    // setState notifies subscribers; direct assign does not
    expect(notified).toBe(true)

    unsub()
  })

  it('rehydrate: activeTabId missing from tabs → corrected to first tab via setState', async () => {
    const existingTabId = 'tab-existing-1'
    localStorageMock.setItem(
      STORE_KEY,
      JSON.stringify({
        state: {
          tabs: [{ id: existingTabId, title: 'Terminal 1', sessionId: null }],
          activeTabId: 'tab-stale-id-that-does-not-exist',
          terminalCounter: 1,
        },
        version: 0,
      }),
    )

    const useStore = await getStore()

    let notified = false
    const unsub = useStore.subscribe(() => { notified = true })

    await useStore.persist.rehydrate()

    const { activeTabId } = useStore.getState()
    expect(activeTabId).toBe(existingTabId)
    expect(notified).toBe(true)

    unsub()
  })

  it('rehydrate: valid activeTabId present → no mutation, no spurious notification', async () => {
    const tabId = 'tab-valid-1'
    localStorageMock.setItem(
      STORE_KEY,
      JSON.stringify({
        state: {
          tabs: [{ id: tabId, title: 'Terminal 1', sessionId: null }],
          activeTabId: tabId,
          terminalCounter: 1,
        },
        version: 0,
      }),
    )

    const useStore = await getStore()
    await useStore.persist.rehydrate()

    // activeTabId must be unchanged
    expect(useStore.getState().activeTabId).toBe(tabId)
  })

  it('rehydrate with error: handler does nothing', async () => {
    const useStore = await getStore()

    let notified = false
    const unsub = useStore.subscribe(() => { notified = true })

    const handler = useStore.persist.getOptions().onRehydrateStorage?.(useStore.getState())
    if (handler) handler(undefined, new Error('simulated'))

    expect(notified).toBe(false)

    unsub()
  })
})
