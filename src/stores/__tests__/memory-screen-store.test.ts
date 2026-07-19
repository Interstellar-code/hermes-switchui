// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'switchui-memory-screen'

function seed(activeTab: string, version: number) {
  localStorage.setItem(KEY, JSON.stringify({ state: { activeTab }, version }))
}

async function loadStore() {
  vi.resetModules()
  const mod = await import('../memory-screen-store')
  return mod.useMemoryScreenStore
}

describe('memory-screen-store migration (v1 → v2)', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it("migrates v1 'graph' tab to v2 'map'", async () => {
    seed('graph', 1)
    const store = await loadStore()
    expect(store.getState().activeTab).toBe('map')
  })

  it('migrates an unknown v1 tab to memory', async () => {
    seed('totally-bogus', 1)
    const store = await loadStore()
    expect(store.getState().activeTab).toBe('memory')
  })

  it('preserves a still-valid v1 tab', async () => {
    seed('wiki', 1)
    const store = await loadStore()
    expect(store.getState().activeTab).toBe('wiki')
  })

  it('defaults to memory with no persisted state', async () => {
    const store = await loadStore()
    expect(store.getState().activeTab).toBe('memory')
  })
})
