// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionStorage from './section-storage'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockAnalyticsUsage } = vi.hoisted(() => ({
  mockAnalyticsUsage: vi.fn(),
}))

vi.mock('@/lib/hermes-client', () => ({
  analyticsUsage: mockAnalyticsUsage,
}))

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SectionStorage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('SectionStorage', () => {
  it('shows sessions.auto_prune ON when the draft has no value (agent default is true)', async () => {
    mockAnalyticsUsage.mockResolvedValue({
      total_sessions: 3,
      total_tokens: 1000,
      total_calls: 42,
      total_estimated_cost: 0.5,
    })
    useSettingsStore.getState().seed({})

    renderSection()

    await waitFor(() => expect(mockAnalyticsUsage).toHaveBeenCalledWith(30))
    // Agent default (hermes_cli/config_defaults.py): sessions.auto_prune = true.
    // The old fallback was false, which showed the toggle OFF for every fresh
    // config until the user saved.
    expect(
      screen
        .getByRole('switch', { name: /Auto-prune sessions/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })
})
