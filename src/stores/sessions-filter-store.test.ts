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

  /**
   * `vi.resetModules()` above gives every test a fresh module registry, so
   * `session-scope` must be pulled from the SAME batch as the store — a
   * top-level import would hand back a different module instance than the one
   * the store publishes into, and the device-layer assertions would silently
   * read stale module state.
   */
  async function getStore() {
    const { useSessionsFilterStore, buildDefaultDateRange } = await import('./sessions-filter-store')
    const scope = await import('@/lib/session-scope')
    return { useSessionsFilterStore, buildDefaultDateRange, scope }
  }

  it('starts with default 7d date filter state', async () => {
    const { useSessionsFilterStore: useStore, buildDefaultDateRange } = await getStore()
    const s = useStore.getState()
    expect(s.sources).toEqual([])
    expect(s.state).toBe('all')
    expect(s.query).toBe('')
    expect(s.dateRange).toEqual(buildDefaultDateRange())
    expect(s.sort).toBe('recent')
    expect(s.updatesOnly).toBe(false)
    expect(s.collapsed).toBe(false)
    expect(s.leftPanel).toBe('sessions')
    expect(s.profile).toBe('active')
    expect(s.version).toBe(8)
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

  it('toggleUpdatesOnly toggles the pending-update filter', async () => {
    const { useSessionsFilterStore: useStore } = await getStore()
    useStore.getState().toggleUpdatesOnly()
    expect(useStore.getState().updatesOnly).toBe(true)
    useStore.getState().toggleUpdatesOnly()
    expect(useStore.getState().updatesOnly).toBe(false)
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
    expect(useStore.getState().version).toBe(8)
    expect(useStore.getState().sources).toContain('cron')
    expect(useStore.getState().leftPanel).toBe('files')
    expect(useStore.getState().dateRange).toEqual(buildDefaultDateRange())
    expect(useStore.getState().profile).toBe('active')
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

  it('migration from v6 adds profile default without disturbing other fields', async () => {
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({
        state: { version: 6, sources: ['cli'], state: 'all', query: 'foo', dateRange: { from: '2025-03-01', to: '2025-03-31' }, sort: 'recent', collapsed: true, leftPanel: 'files' },
        version: 6,
      }),
    )
    const { useSessionsFilterStore: useStore } = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    const s = useStore.getState()
    expect(s.version).toBe(8)
    expect(s.profile).toBe('active')
    expect(s.sources).toContain('cli')
    expect(s.query).toBe('foo')
    expect(s.collapsed).toBe(true)
    expect(s.dateRange).toEqual({ from: '2025-03-01', to: '2025-03-31' })
  })

  it('drops a v7 profile selection instead of promoting it to a send target', async () => {
    // Through v7 `profile` only filtered a list. From v8 the same field is the
    // device layer of the profile resolver, so it also decides where messages
    // go. Carrying an old browse selection across that boundary would silently
    // re-route somebody's next message; the migration resets it once and keeps
    // every other filter.
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({
        state: { version: 7, sources: ['cli'], state: 'all', query: 'foo', dateRange: { from: null, to: null }, sort: 'recent', collapsed: false, leftPanel: 'sessions', profile: 'work' },
        version: 7,
      }),
    )
    const { useSessionsFilterStore: useStore } = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    const s = useStore.getState()
    expect(s.version).toBe(8)
    expect(s.profile).toBe('active')
    expect(s.sources).toContain('cli')
    expect(s.query).toBe('foo')
  })

  it('v8 persisted state with an explicit profile passes through unchanged', async () => {
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({
        state: { version: 8, sources: [], state: 'all', query: '', dateRange: { from: null, to: null }, sort: 'recent', collapsed: false, leftPanel: 'sessions', profile: 'work' },
        version: 8,
      }),
    )
    const { useSessionsFilterStore: useStore } = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    expect(useStore.getState().profile).toBe('work')
  })
})

// ── Device layer of the profile resolver ────────────────────────────────────
//
// The store is the ONLY writer of the resolver's device layer. These tests pin
// that wiring: without it, picking a profile in the sidebar would once again
// change the session list while the composer kept sending somewhere else.

describe('sessions-filter-store → session-scope device layer', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  async function getStore() {
    const { useSessionsFilterStore } = await import('./sessions-filter-store')
    const scope = await import('@/lib/session-scope')
    // The device layer only applies on a profile-scoped route; `__root` calls
    // this on every navigation.
    scope.syncSessionProfileToPath('/chat/session-a')
    return { useSessionsFilterStore, scope }
  }

  it('publishes a picked profile so every scoped key and write body follows it', async () => {
    const { useSessionsFilterStore: useStore, scope } = await getStore()
    expect(scope.getSessionProfile()).toBeNull()

    useStore.getState().setProfile('hermes-switch')

    expect(scope.getSessionProfile()).toBe('hermes-switch')
    expect(scope.getSessionProfileScope()).toEqual({
      profile: 'hermes-switch',
      source: 'device',
    })
    expect(scope.profileBody()).toEqual({ profile: 'hermes-switch' })
    expect(scope.activeScopeSegments()).toEqual(['hermes-switch'])
    expect(scope.activeScopeKey('abc123')).toBe('hermes-switch::abc123')
  })

  it('treats the sentinel as unscoped and "default" as a real profile', async () => {
    const { useSessionsFilterStore: useStore, scope } = await getStore()

    useStore.getState().setProfile('default')
    expect(scope.getSessionProfile()).toBe('default')
    expect(scope.profileBody()).toEqual({ profile: 'default' })

    useStore.getState().setProfile('active')
    expect(scope.getSessionProfile()).toBeNull()
    // Byte-identical to the pre-profile behaviour, which is the §2 DoD.
    expect(scope.profileBody()).toEqual({})
    expect(scope.activeScopeSegments()).toEqual([])
    expect(scope.activeScopeKey('abc123')).toBe('abc123')
  })

  it('is outranked by a ?profile= pin on the tab', async () => {
    const { useSessionsFilterStore: useStore, scope } = await getStore()
    useStore.getState().setProfile('hermes-switch')
    scope.setSessionProfile('neo')

    expect(scope.getSessionProfileScope()).toEqual({
      profile: 'neo',
      source: 'url',
    })
    // …and the device selection is still there underneath, unmodified: nothing
    // mirrors one layer into the other.
    expect(useStore.getState().profile).toBe('hermes-switch')
    scope.setSessionProfile(null)
    expect(scope.getSessionProfile()).toBe('hermes-switch')
  })

  it('reaches the resolver from persisted state on load, before any pick', async () => {
    localStorageMock.setItem(
      'hermes.sessions.filter',
      JSON.stringify({
        state: { version: 8, sources: [], state: 'all', query: '', dateRange: { from: null, to: null }, sort: 'recent', collapsed: false, leftPanel: 'sessions', profile: 'trinity' },
        version: 8,
      }),
    )
    const { scope } = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    expect(scope.getSessionProfile()).toBe('trinity')
  })
})
