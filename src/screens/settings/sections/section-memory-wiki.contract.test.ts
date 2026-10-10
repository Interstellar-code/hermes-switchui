// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('gives the memory rows their key-meta strip and keeps the provider a select', () => {
    mockGetEnv.mockResolvedValue({})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline in jsdom')),
    )
    useSettingsStore.getState().seed({ 'config.memory.provider': 'hindsight' })

    renderSection()

    const enabled = screen.getByText('Memory enabled').closest('.row')!
    expect(enabled.querySelector('.row-meta')).toBeTruthy()
    expect(enabled.textContent).toContain('config.yaml')

    // provider is now a SelectField — still a real <select>, still writing
    // config.memory.provider, so the swap is a wrapper change and not a
    // change of control.
    const provider = screen.getByDisplayValue<HTMLSelectElement>(/Hindsight/i)
    expect(provider.tagName).toBe('SELECT')
    fireEvent.change(provider, { target: { value: '' } })
    expect(useSettingsStore.getState().draft['config.memory.provider']).toBe('')
  })
})
