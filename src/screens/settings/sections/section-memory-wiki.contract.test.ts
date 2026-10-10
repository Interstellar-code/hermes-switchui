// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionMemoryWiki from './section-memory-wiki'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockGetEnv, mockPutEnv, mockRevealEnv } = vi.hoisted(() => ({
  mockGetEnv: vi.fn(),
  mockPutEnv: vi.fn(),
  mockRevealEnv: vi.fn(),
}))

vi.mock('@/lib/hermes-client', () => ({
  getEnv: mockGetEnv,
  putEnv: mockPutEnv,
  revealEnv: mockRevealEnv,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  resetSettingsStore()
})

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SectionMemoryWiki),
    ),
  )
}

describe('section-memory-wiki provider surface', () => {
  it('uses the shared memory provider catalog instead of a stale local list', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/screens/settings/sections/section-memory-wiki.tsx',
      ),
      'utf8',
    )
    expect(source).toContain('MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED')
    expect(source).toContain('getMemoryProviderInfo')
    expect(source).not.toContain("value: 'honcho'")
    expect(source).not.toContain("value: 'builtin'")
  })
})

describe('SectionMemoryWiki memory fallbacks', () => {
  it('shows memory.user_profile_enabled ON when the draft has no value (agent default is true)', () => {
    mockGetEnv.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline in jsdom')),
    )
    useSettingsStore.getState().seed({})

    renderSection()

    expect(
      screen
        .getByRole('switch', { name: /User profile enabled/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })
})
