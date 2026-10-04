// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryScreen, healthItems, nextTabId } from './memory-screen'
import {
  useMemoryChatStore,
  useMemoryScreenStore,
} from '@/stores/memory-screen-store'

// Stub the lazy tab bodies so the screen renders without heavy deps.
vi.mock('./components/agent-memory-tab', () => ({
  AgentMemoryTab: () => <div>agent</div>,
}))
vi.mock('./components/browse-tab', () => ({
  BrowseTab: () => <div>browse</div>,
}))
vi.mock('./components/wiki-tab', () => ({ WikiTab: () => <div>wiki</div> }))
vi.mock('./components/memory-map', () => ({
  MemoryMap: () => <div>map-body</div>,
}))
vi.mock('./components/settings-tab', () => ({
  SettingsTab: () => <div>settings</div>,
}))
vi.mock('./components/chat-tab', () => ({ ChatTab: () => <div>chat</div> }))

function mockStats(exists: boolean, total: number, extra: object = {}) {
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
            ...extra,
          }),
      }),
    ),
  )
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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

const isDisabled = (name: string) =>
  screen.getByRole('tab', { name }).getAttribute('aria-disabled') === 'true'

describe('MemoryScreen — matrix-memory tab gating (Map + Browse)', () => {
  it('shows Map and Browse disabled when the DB is missing', async () => {
    mockStats(false, 0)
    renderScreen()
    expect(screen.getByRole('tab', { name: /agent memory/i })).toBeTruthy() // ungated
    await waitFor(() => expect(isDisabled('Map')).toBe(true))
    expect(isDisabled('Browse')).toBe(true)
    expect(
      screen.getByRole('tab', { name: 'Map' }).getAttribute('title'),
    ).toMatch(/matrix-memory/)
  })

  it('keeps Map and Browse disabled when the DB exists but holds no memories', async () => {
    mockStats(true, 0)
    renderScreen()
    await waitFor(() => expect(globalThis.fetch as any).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
    expect(useMemoryScreenStore.getState().activeTab).toBe('memory')
    expect(isDisabled('Browse')).toBe(true)
  })

  it('enables Map and Browse when matrix-memory is configured + activated', async () => {
    mockStats(true, 42)
    renderScreen()
    await waitFor(() => expect(isDisabled('Map')).toBe(false))
    expect(isDisabled('Browse')).toBe(false)
  })

  it('redirects away from a persisted gated tab when matrix-memory is unavailable', async () => {
    useMemoryScreenStore.setState({ activeTab: 'browse' })
    mockStats(true, 0)
    renderScreen()
    await waitFor(() =>
      expect(useMemoryScreenStore.getState().activeTab).toBe('memory'),
    )
  })
})

describe('MemoryScreen — IA', () => {
  it('askMemory opens the chat drawer, and re-opens on a repeat ask', async () => {
    useMemoryChatStore.setState({ chatRequest: null })
    mockStats(true, 42)
    renderScreen()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useMemoryChatStore.getState().askMemory(null))
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /chat/i })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: /close chat/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useMemoryChatStore.getState().askMemory('What about X?'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /close chat/i }))
    act(() => useMemoryChatStore.getState().askMemory('What about X?'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    useMemoryChatStore.setState({ chatRequest: null })
  })

  it('opens a persisted chat tab as a drawer and settings via the gear', async () => {
    useMemoryScreenStore.setState({ activeTab: 'chat' })
    mockStats(true, 42)
    renderScreen()
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /chat/i })).toBeTruthy(),
    )
    expect(useMemoryScreenStore.getState().activeTab).toBe('memory')
    fireEvent.click(screen.getByRole('button', { name: /close chat/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // kept mounted (hidden) so the conversation survives
    expect(screen.getByText('chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /memory settings/i }))
    expect(useMemoryScreenStore.getState().activeTab).toBe('settings')
    expect(await screen.findByText('settings')).toBeTruthy()
  })

  it('gear toggles back to the previous tab', () => {
    useMemoryScreenStore.setState({ activeTab: 'wiki' })
    mockStats(true, 42)
    renderScreen()
    const gear = screen.getByRole('button', { name: /memory settings/i })
    fireEvent.click(gear)
    expect(useMemoryScreenStore.getState().activeTab).toBe('settings')
    fireEvent.click(gear)
    expect(useMemoryScreenStore.getState().activeTab).toBe('wiki')
  })

  it('describes why a gated tab is disabled', async () => {
    mockStats(false, 0)
    renderScreen()
    await waitFor(() => expect(isDisabled('Map')).toBe(true))
    const id = screen
      .getByRole('tab', { name: 'Map' })
      .getAttribute('aria-describedby')
    expect(document.getElementById(id!)?.textContent).toMatch(/matrix-memory/)
  })

  it('arrow keys move between enabled tabs', async () => {
    mockStats(false, 0)
    renderScreen()
    await waitFor(() => expect(isDisabled('Map')).toBe(true))
    fireEvent.keyDown(screen.getByRole('tab', { name: /agent memory/i }), {
      key: 'ArrowRight',
    })
    expect(useMemoryScreenStore.getState().activeTab).toBe('wiki') // skips disabled Browse
  })
})

describe('nextTabId', () => {
  const ids = ['a', 'b', 'c']
  it('wraps arrows and handles Home/End', () => {
    expect(nextTabId(ids, 'c', 'ArrowRight')).toBe('a')
    expect(nextTabId(ids, 'a', 'ArrowLeft')).toBe('c')
    expect(nextTabId(ids, 'b', 'Home')).toBe('a')
    expect(nextTabId(ids, 'a', 'End')).toBe('c')
    expect(nextTabId(ids, 'a', 'Enter')).toBeNull()
    expect(nextTabId([], 'a', 'ArrowRight')).toBeNull()
  })
})

describe('MemoryScreen — header health', () => {
  const day = 24 * 60 * 60_000
  const health = (ageDays: number, method: string, covered: number) => ({
    lastConsolidation: {
      at: new Date(Date.now() - ageDays * day).toISOString(),
      method,
      items: 32,
    },
    backlog: { rows: 2410, sessions: 325, backoff: 0 },
    embeddings: { covered, total: 100 },
  })

  it('renders consolidation, backlog and embeddings without warnings when healthy', async () => {
    mockStats(true, 42, { health: health(2, 'llm', 100) })
    renderScreen()
    const c = await screen.findByText('consolidated 2d ago (llm)')
    expect(c.className).not.toMatch(/warn/)
    expect(c.getAttribute('title')).toMatch(/aaak/)
    expect(screen.getByText(/backlog 2,410 in 325 sessions/)).toBeTruthy()
    expect(screen.getByText('embeddings 100%').className).not.toMatch(/warn/)
  })

  it('flags stale consolidation and low embedding coverage', async () => {
    mockStats(true, 42, { health: health(4, 'llm', 90) })
    renderScreen()
    const c = await screen.findByText('consolidated 4d ago (llm)')
    expect(c.className).toBe('mem-header-warn')
    expect(screen.getByText('embeddings 90%').className).toBe('mem-header-warn')
  })

  it('flags aaak consolidation and skips absent parts', () => {
    const items = healthItems({
      lastConsolidation: {
        at: new Date().toISOString(),
        method: 'aaak',
        items: 1,
      },
      backlog: null,
      embeddings: null,
    })
    expect(items.map((i) => [i.key, i.warn])).toEqual([['consolidation', true]])
    expect(healthItems(undefined)).toEqual([])
  })
})
