import { beforeEach, describe, expect, it, vi } from 'vitest'

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k in store) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('window', { localStorage: localStorageMock })

describe('sessions-filter-store', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  async function getStore() {
    const { useSessionsFilterStore, buildDefaultDateRange } = await import('./sessions-filter-store')
    return { useSessionsFilterStore, buildDefaultDateRange }
  }

  it('starts with default 7d date filter state', async () => {
    const { useSessionsFilterStore: useStore, buildDefaultDateRange } = await getStore()
    const s = useStore.getState()
    expect(s.sources).toEqual([])
    expect(s.state).toBe('all')
    expect(s.query).toBe('')
    expect(s.dateRange).toEqual(buildDefaultDateRange())
    expect(s.sort).toBe('recent')
    expect(s.collapsed).toBe(false)
    expect(s.leftPanel).toBe('sessions')
    expect(s.version).toBe(5)
  })

  it('toggleSource adds and removes sources', async () => {
    const { useSessionsFilterStore: useStore } = await getStore()
    const { toggleSource } = useStore.getState()
    toggleSource('chat')
    expect(useStore.getState().sources).toEqual(['chat'])
    toggleSource('task')
    expect(useStore.getState().sources).toContain('task')
    toggleSource('chat')
    expect(useStore.getState().sources).not.toContain('chat')
  })

  it('setDateRange updates dateRange', async () => {
    const { useSessionsFilterStore: useStore } = await getStore()
    useStore.getState().setDateRange('2025-01-01', '2025-12-31')
    expect(useStore.getState().dateRange).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('reset returns to default 7d date range', async () => {
    const { useSessionsFilterStore: useStore, buildDefaultDateRange } = await getStore()
    useStore.getState().setQuery('test')
    useStore.getState().setDateRange('2025-01-01', '2025-01-31')
    useStore.getState().reset()
    expect(useStore.getState().query).toBe('')
    expect(useStore.getState().dateRange).toEqual(buildDefaultDateRange())
  })

  it('migration from v4 with empty dateRange upgrades to default 7d', async () => {
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({
        state: { version: 4, sources: ['cron'], state: 'all', query: '', dateRange: { from: null, to: null }, sort: 'recent', collapsed: false, leftPanel: 'files' },
        version: 4,
      }),
    )
    const { useSessionsFilterStore: useStore, buildDefaultDateRange } = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    expect(useStore.getState().version).toBe(5)
    expect(useStore.getState().sources).toContain('cron')
    expect(useStore.getState().leftPanel).toBe('files')
    expect(useStore.getState().dateRange).toEqual(buildDefaultDateRange())
  })

  it('migration preserves an explicit stored dateRange', async () => {
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({
        state: { version: 4, sources: [], state: 'all', query: '', dateRange: { from: '2025-03-01', to: '2025-03-31' }, sort: 'recent', collapsed: false, leftPanel: 'sessions' },
        version: 4,
      }),
    )
    const { useSessionsFilterStore: useStore } = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    expect(useStore.getState().dateRange).toEqual({ from: '2025-03-01', to: '2025-03-31' })
  })
})
