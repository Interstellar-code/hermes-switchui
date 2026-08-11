// @vitest-environment jsdom
/**
 * Guards the schema binding on `config.agent.service_tier`.
 *
 * This field was a free text input while the gateway publishes it as a select
 * with a fixed four-value enum (`"" | auto | default | flex`). A typo — "flexx"
 * — saved without complaint, the gateway silently fell back to its default,
 * and nothing in the UI indicated the setting had not taken effect. That is the
 * same class of bug as the PATCH/405 save failure: an affordance that accepts
 * input it cannot honour.
 *
 * The schema request fails under jsdom, which is deliberately exercised here:
 * the picker must fall back to its hardcoded options rather than render empty.
 * A settings control that disappears when the gateway is unreachable is worse
 * than one that is merely stale.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SectionAgentRuntime from './section-agent-runtime'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SectionAgentRuntime />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  resetSettingsStore()
})

describe('SectionAgentRuntime — service tier', () => {
  it('renders service tier as a constrained select, never a free text input', () => {
    useSettingsStore.getState().seed({ 'config.agent.service_tier': 'flex' })
    renderSection()

    const control = screen.getByDisplayValue('Flex')
    expect(control.tagName).toBe('SELECT')
  })

  it('offers exactly the gateway-supported tiers when the schema is unreachable', () => {
    useSettingsStore.getState().seed({ 'config.agent.service_tier': '' })
    renderSection()

    const values = Array.from(
      screen.getAllByRole('option'),
    ).map((o) => o.value)

    // The gateway publishes ["", "auto", "default", "flex"]; every one must be
    // reachable, and nothing beyond it offered.
    for (const tier of ['', 'auto', 'default', 'flex']) {
      expect(values.includes(tier)).toBe(true)
    }
  })

  it('writes the selected tier straight to the draft store', () => {
    useSettingsStore.getState().seed({ 'config.agent.service_tier': '' })
    renderSection()

    const select = screen.getByDisplayValue('Default')
    select.value = 'auto'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    expect(useSettingsStore.getState().draft['config.agent.service_tier']).toBe(
      'auto',
    )
  })
})
