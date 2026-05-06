import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k in store) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('window', { localStorage: localStorageMock })

// Zustand stores keep module-level state — reset between tests by reimporting
// via dynamic import after clearing localStorage.

describe('sessions-filter-store', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  async function getStore() {
    const { useSessionsFilterStore } = await import('./sessions-filter-store')
    return useSessionsFilterStore
  }

  it('starts with default state', async () => {
    const useStore = await getStore()
    const s = useStore.getState()
    expect(s.sources).toEqual([])
    expect(s.state).toBe('all')
    expect(s.query).toBe('')
    expect(s.dateRange).toEqual({ from: null, to: null })
    expect(s.sort).toBe('recent')
    expect(s.collapsed).toBe(false)
    expect(s.version).toBe(1)
  })

  it('toggleSource adds and removes sources', async () => {
    const useStore = await getStore()
    const { toggleSource } = useStore.getState()
    toggleSource('chat')
    expect(useStore.getState().sources).toEqual(['chat'])
    toggleSource('task')
    expect(useStore.getState().sources).toContain('task')
    toggleSource('chat')
    expect(useStore.getState().sources).not.toContain('chat')
    expect(useStore.getState().sources).toContain('task')
  })

  it('setState updates state filter', async () => {
    const useStore = await getStore()
    useStore.getState().setState('live')
    expect(useStore.getState().state).toBe('live')
  })

  it('setQuery updates query', async () => {
    const useStore = await getStore()
    useStore.getState().setQuery('hello')
    expect(useStore.getState().query).toBe('hello')
  })

  it('setDateRange updates dateRange', async () => {
    const useStore = await getStore()
    useStore.getState().setDateRange('2025-01-01', '2025-12-31')
    expect(useStore.getState().dateRange).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('setSort updates sort', async () => {
    const useStore = await getStore()
    useStore.getState().setSort('tokens')
    expect(useStore.getState().sort).toBe('tokens')
  })

  it('setCollapsed updates collapsed', async () => {
    const useStore = await getStore()
    useStore.getState().setCollapsed(true)
    expect(useStore.getState().collapsed).toBe(true)
  })

  it('reset returns to initial state', async () => {
    const useStore = await getStore()
    useStore.getState().toggleSource('chat')
    useStore.getState().setState('live')
    useStore.getState().setQuery('test')
    useStore.getState().reset()
    const s = useStore.getState()
    expect(s.sources).toEqual([])
    expect(s.state).toBe('all')
    expect(s.query).toBe('')
  })

  it('persist shape: reading pre-seeded storage produces correct state (version: 1)', async () => {
    // Seed localStorage with a valid v1 payload before module load
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({
        state: { version: 1, sources: ['cron'], state: 'all', query: '', dateRange: { from: null, to: null }, sort: 'recent', collapsed: false },
        version: 1,
      }),
    )
    const useStore = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    const s = useStore.getState()
    expect(s.version).toBe(1)
    expect(s.sources).toContain('cron')
  })

  it('migration: future version (v99) drops to defaults', async () => {
    // Pre-seed localStorage with an unknown future version
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({ state: { version: 99, sources: ['task'], state: 'live', query: 'x', dateRange: { from: null, to: null }, sort: 'tokens', collapsed: true }, version: 99 }),
    )
    const useStore = await getStore()
    // Allow rehydration
    await new Promise((r) => setTimeout(r, 10))
    const s = useStore.getState()
    expect(s.sources).toEqual([])
    expect(s.state).toBe('all')
    expect(s.collapsed).toBe(false)
  })
})
