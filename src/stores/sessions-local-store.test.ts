import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage — must be set on both globalThis and globalThis.window
// because readLegacyPinned uses `window.localStorage` (which is undefined in
// the node test environment unless we stub it).
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k in store) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)
// Provide window.localStorage for code paths that use `window.` directly
vi.stubGlobal('window', { localStorage: localStorageMock })

describe('sessions-local-store', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  async function getStore() {
    const { useSessionsLocalStore } = await import('./sessions-local-store')
    return useSessionsLocalStore
  }

  it('starts with empty arrays', async () => {
    const useStore = await getStore()
    const s = useStore.getState()
    expect(s.pinned).toEqual([])
    expect(s.starred).toEqual([])
    expect(s.archived).toEqual([])
    expect(s.version).toBe(1)
  })

  it('togglePinned adds and removes', async () => {
    const useStore = await getStore()
    useStore.getState().togglePinned('chat:abc')
    expect(useStore.getState().pinned).toContain('chat:abc')
    useStore.getState().togglePinned('chat:abc')
    expect(useStore.getState().pinned).not.toContain('chat:abc')
  })

  it('toggleStarred adds and removes', async () => {
    const useStore = await getStore()
    useStore.getState().toggleStarred('task:t-1')
    expect(useStore.getState().starred).toContain('task:t-1')
    useStore.getState().toggleStarred('task:t-1')
    expect(useStore.getState().starred).not.toContain('task:t-1')
  })

  it('toggleArchived adds and removes', async () => {
    const useStore = await getStore()
    useStore.getState().toggleArchived('cron:c-5')
    expect(useStore.getState().archived).toContain('cron:c-5')
    useStore.getState().toggleArchived('cron:c-5')
    expect(useStore.getState().archived).not.toContain('cron:c-5')
  })

  it('isPinned / isStarred / isArchived selectors', async () => {
    const useStore = await getStore()
    const s = useStore.getState()
    expect(s.isPinned('chat:abc')).toBe(false)
    s.togglePinned('chat:abc')
    expect(useStore.getState().isPinned('chat:abc')).toBe(true)
    expect(useStore.getState().isStarred('chat:abc')).toBe(false)
    expect(useStore.getState().isArchived('chat:abc')).toBe(false)
  })

  it('namespaced IDs preserved on toggling multiple sources', async () => {
    const useStore = await getStore()
    const { togglePinned } = useStore.getState()
    togglePinned('chat:abc')
    togglePinned('task:t-1')
    togglePinned('mem:file.md')
    const { pinned } = useStore.getState()
    expect(pinned).toContain('chat:abc')
    expect(pinned).toContain('task:t-1')
    expect(pinned).toContain('mem:file.md')
  })

  it('legacy pinned-sessions migration: bare keys get chat: prefix', async () => {
    // Seed legacy store (zustand persist format)
    localStorageMock.setItem(
      'pinned-sessions',
      JSON.stringify({ state: { pinnedSessionKeys: ['key1', 'key2'] }, version: 0 }),
    )
    // Test the exported readLegacyPinned function directly
    const { readLegacyPinned } = await import('./sessions-local-store')
    const result = readLegacyPinned()
    expect(result).toContain('chat:key1')
    expect(result).toContain('chat:key2')
  })

  it('legacy migration is idempotent: already-namespaced ids not duplicated', async () => {
    // Already-namespaced ids should pass through unchanged
    localStorageMock.setItem(
      'pinned-sessions',
      JSON.stringify({ state: { pinnedSessionKeys: ['chat:key1', 'key2'] }, version: 0 }),
    )
    const { readLegacyPinned } = await import('./sessions-local-store')
    const result = readLegacyPinned()
    // 'chat:key1' already namespaced — stays as-is; 'key2' gets prefixed
    expect(result.filter((id) => id === 'chat:key1').length).toBe(1)
    expect(result).toContain('chat:key2')
  })

  it('future version (v99) drops to defaults', async () => {
    localStorageMock.setItem(
      'hermes.sessions.local',
      JSON.stringify({ state: { version: 99, pinned: ['chat:x'], starred: [], archived: [] }, version: 99 }),
    )
    const useStore = await getStore()
    await new Promise((r) => setTimeout(r, 10))
    const s = useStore.getState()
    expect(s.pinned).toEqual([])
  })
})
