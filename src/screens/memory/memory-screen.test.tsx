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

function mockStats(exists: boolean, total: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            checkedAt: 0,
            db: { exists },
            counts: { working: total, episodic: 0, triples: 0, fts: 0, total },
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

describe('MemoryScreen — matrix-memory tab gating (Map + Browse)', () => {
  it('hides Map and Browse when the DB is missing', async () => {
    mockStats(false, 0)
    renderScreen()
    expect(screen.getByRole('tab', { name: /agent memory/i })).toBeTruthy() // ungated
    await waitFor(() => expect((globalThis.fetch as any)).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Browse' })).toBeNull()
  })

  it('hides Map and Browse when the DB exists but holds no memories', async () => {
    mockStats(true, 0)
    renderScreen()
    await waitFor(() => expect((globalThis.fetch as any)).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Browse' })).toBeNull()
  })

  it('shows Map and Browse when matrix-memory is configured + activated', async () => {
    mockStats(true, 42)
    renderScreen()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Map' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'Browse' })).toBeTruthy()
  })

  it('redirects away from a persisted gated tab when matrix-memory is unavailable', async () => {
    useMemoryScreenStore.setState({ activeTab: 'browse' })
    mockStats(true, 0)
    renderScreen()
    await waitFor(() => expect(useMemoryScreenStore.getState().activeTab).toBe('memory'))
  })
})
