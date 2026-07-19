// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryScreen } from './memory-screen'
import { useMemoryScreenStore } from '@/stores/memory-screen-store'

// Stub the lazy tab bodies so the screen renders without heavy deps.
vi.mock('./components/agent-memory-tab', () => ({ AgentMemoryTab: () => <div>agent</div> }))
vi.mock('./components/browse-tab', () => ({ BrowseTab: () => <div>browse</div> }))
vi.mock('./components/wiki-tab', () => ({ WikiTab: () => <div>wiki</div> }))
vi.mock('./components/memory-map', () => ({ MemoryMap: () => <div>map-body</div> }))
vi.mock('./components/settings-tab', () => ({ SettingsTab: () => <div>settings</div> }))
vi.mock('./components/chat-tab', () => ({ ChatTab: () => <div>chat</div> }))

function mockStats(exists: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            checkedAt: 0,
            db: { exists },
            counts: { working: 0, episodic: 0, triples: 0, fts: 0, total: 0 },
          }),
      }),
    ),
  )
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryScreen />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useMemoryScreenStore.setState({ activeTab: 'memory' })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MemoryScreen — Map tab gating', () => {
  it('hides the Map tab when matrix-memory is not configured (db missing)', async () => {
    mockStats(false)
    renderScreen()
    // non-mnemosyne tabs always present
    expect(screen.getByRole('tab', { name: /agent memory/i })).toBeTruthy()
    // give the availability query time to settle, then confirm Map stays hidden
    await waitFor(() => expect((globalThis.fetch as any)).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull()
  })

  it('shows the Map tab when matrix-memory is configured + activated (db exists)', async () => {
    mockStats(true)
    renderScreen()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Map' })).toBeTruthy())
  })

  it('redirects away from a persisted Map tab when matrix-memory is unavailable', async () => {
    useMemoryScreenStore.setState({ activeTab: 'map' })
    mockStats(false)
    renderScreen()
    await waitFor(() => expect(useMemoryScreenStore.getState().activeTab).toBe('memory'))
  })
})
