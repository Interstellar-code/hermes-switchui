import { describe, it, expect, beforeEach, vi } from 'vitest'

// Minimal localStorage mock (Zustand persist reads/writes here)
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k in store) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('window', { localStorage: localStorageMock })

const STORE_KEY = 'clawsuite:mission-store'

describe('mission-store onRehydrateStorage — setState not direct assign', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  async function getStore() {
    const { useMissionStore } = await import('./mission-store')
    return useMissionStore
  }

  it('rehydrate: missionHistory.reports is clamped and reflected in getState()', async () => {
    // Seed persisted state with an empty missionHistory (edge case that triggers the clamp path)
    localStorageMock.setItem(
      STORE_KEY,
      JSON.stringify({
        state: {
          missionHistory: { reports: [] },
          activeMission: null,
          missionState: 'idle',
        },
        version: 0,
      }),
    )

    const useStore = await getStore()

    // Track subscriber notifications
    let notified = false
    const unsub = useStore.subscribe(() => { notified = true })

    await useStore.persist.rehydrate()

    // missionHistory must be set (not undefined) — proves setState ran
    const { missionHistory } = useStore.getState()
    expect(missionHistory).toBeDefined()
    expect(Array.isArray(missionHistory.reports)).toBe(true)

    // A subscriber must have fired (setState notifies; direct assign does not)
    expect(notified).toBe(true)

    unsub()
  })

  it('rehydrate: restoreCheckpoint is NOT set when missionState is idle', async () => {
    localStorageMock.setItem(
      STORE_KEY,
      JSON.stringify({
        state: {
          missionHistory: { reports: [] },
          activeMission: { id: 'test-mission' },
          missionState: 'idle',
          restoreCheckpoint: null,
        },
        version: 0,
      }),
    )

    const useStore = await getStore()
    await useStore.persist.rehydrate()

    // Guard: idle missions must NOT produce a restoreCheckpoint
    const { restoreCheckpoint } = useStore.getState()
    expect(restoreCheckpoint).toBeFalsy()
  })

  it('rehydrate with error: store state unchanged', async () => {
    const useStore = await getStore()

    let notified = false
    const unsub = useStore.subscribe(() => { notified = true })

    // Force an error path by calling onRehydrateStorage handler directly with error
    // (Zustand calls the returned fn with (state, error); we simulate error=new Error)
    const handler = useStore.persist.getOptions().onRehydrateStorage?.(useStore.getState())
    if (handler) handler(undefined as never, new Error('simulated'))

    // No setState should have been called on error path
    expect(notified).toBe(false)

    unsub()
  })
})
