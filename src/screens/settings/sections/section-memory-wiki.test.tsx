// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionMemoryWiki from './section-memory-wiki'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { getEnv, putEnv, revealEnv } = vi.hoisted(() => ({
  getEnv: vi.fn(),
  putEnv: vi.fn(),
  revealEnv: vi.fn(),
}))
vi.mock('@/lib/hermes-client', () => ({ getEnv, putEnv, revealEnv }))

/** The wiki card's own fetch goes through the module-local apiFetchConfig. */
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ config: { source: 'markdown' } }),
  }),
)

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SectionMemoryWiki />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  resetSettingsStore()
  vi.clearAllMocks()
})

describe('SectionMemoryWiki number boxes', () => {
  it('clearing a limit box writes nothing instead of NaN', () => {
    useSettingsStore.getState().seed({
      'config.memory.memory_char_limit': 8000,
      'config.memory.user_char_limit': 2000,
      'config.memory.provider': 'local',
    })
    renderSection()

    const memoryBox = screen.getByDisplayValue('8000')
    const userBox = screen.getByDisplayValue('2000')
    for (const box of [memoryBox, userBox]) {
      fireEvent.change(box, { target: { value: '' } })
    }

    const s = useSettingsStore.getState()
    expect(s.draft['config.memory.memory_char_limit']).toBe(8000)
    expect(s.draft['config.memory.user_char_limit']).toBe(2000)
    expect(s.dirty.size).toBe(0)
  })
})
