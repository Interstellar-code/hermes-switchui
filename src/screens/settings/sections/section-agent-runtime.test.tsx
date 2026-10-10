// @vitest-environment jsdom
/**
 * Locks the agent-runtime controls to the shapes `hermes_cli` actually reads.
 *
 * Every row here used to offer a value the agent could not honour, so a
 * setting that looked saved did nothing:
 *
 * - `tool_use_enforcement` offered `auto | required | none`, but
 *   `agent/system_prompt.py` understands only booleans (plus always/never/
 *   yes/no/on/off) or a list of model substrings — `required` and `none` both
 *   fell through to `auto`. So "none" did not disable enforcement.
 * - `max_turns` rendered a hardcoded 90 while the agent's own default is
 *   `null` (uncapped), and the slider could not express the uncapped state at
 *   all.
 * - `gateway_timeout` floored at 60 with a description that read like a hard
 *   response deadline, hiding that `0` — no timeout — is legal and that the
 *   real trigger is gateway *inactivity*.
 * - `service_tier` carried a fallback of `'' | auto | default | flex`; the
 *   schema's enum is `'' | normal | fast | auto | cold`, so `default` and
 *   `flex` save garbage. And the label "Service tier" hid that the setting is
 *   the "Fast mode" toggle.
 *
 * Only the network edge is mocked (`@/lib/hermes-client`); the section and
 * the real store run unmocked. The schema-unavailable path is exercised
 * deliberately throughout: it is the only path where the fallback list is
 * ever shown, and a control that changes shape when the gateway is down is
 * worse than one that is merely stale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SectionAgentRuntime from './section-agent-runtime'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockGetConfigSchema, mockGetConfigDefaults } = vi.hoisted(() => ({
  mockGetConfigSchema: vi.fn(),
  mockGetConfigDefaults: vi.fn(),
}))

vi.mock('@/lib/hermes-client', () => ({
  getConfigSchema: mockGetConfigSchema,
  getConfigDefaults: mockGetConfigDefaults,
}))

/** The live `agent.service_tier` enum, as `/api/config/schema` publishes it. */
const SCHEMA = {
  category_order: ['agent'],
  fields: {
    'agent.service_tier': {
      type: 'select',
      category: 'agent',
      options: ['', 'normal', 'fast', 'auto', 'cold'],
    },
  },
}

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

function draft(): Record<string, unknown> {
  return useSettingsStore.getState().draft
}

/** Three number sliders render here; scope by the row's label, as a screen reader does. */
function maxTurnsInput(): HTMLInputElement {
  return screen.getByRole('spinbutton', { name: /Max turns/ })
}

function gatewayTimeoutSlider(): HTMLElement {
  return screen.getByRole('slider', { name: /Gateway timeout/ })
}

function tierValues(): Array<string> {
  return screen.getAllByRole<HTMLOptionElement>('option').map((o) => o.value)
}

beforeEach(() => {
  mockGetConfigSchema.mockRejectedValue(new Error('gateway down'))
  mockGetConfigDefaults.mockRejectedValue(new Error('gateway down'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('SectionAgentRuntime — tool use enforcement', () => {
  it('saves on as true and off as false, not as strings', () => {
    useSettingsStore
      .getState()
      .seed({ 'config.agent.tool_use_enforcement': 'auto' })
    renderSection()

    fireEvent.click(screen.getByRole('radio', { name: 'on' }))
    expect(draft()['config.agent.tool_use_enforcement']).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'off' }))
    expect(draft()['config.agent.tool_use_enforcement']).toBe(false)

    fireEvent.click(screen.getByRole('radio', { name: 'auto' }))
    expect(draft()['config.agent.tool_use_enforcement']).toBe('auto')
  })

  it('reads boolean true/false and their string spellings as on/off', () => {
    useSettingsStore
      .getState()
      .seed({ 'config.agent.tool_use_enforcement': true })
    renderSection()
    expect(
      screen.getByRole('radio', { name: 'on' }).getAttribute('aria-checked'),
    ).toBe('true')

    cleanup()
    resetSettingsStore()
    useSettingsStore
      .getState()
      .seed({ 'config.agent.tool_use_enforcement': 'false' })
    renderSection()
    expect(
      screen.getByRole('radio', { name: 'off' }).getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('never offers required/none, which the agent silently reads as auto', () => {
    useSettingsStore
      .getState()
      .seed({ 'config.agent.tool_use_enforcement': 'auto' })
    renderSection()

    expect(screen.queryByRole('radio', { name: 'required' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'none' })).toBeNull()
  })
})

describe('SectionAgentRuntime — max turns', () => {
  it('writes null when unlimited is switched on, and restores the last number', () => {
    useSettingsStore.getState().seed({ 'config.agent.max_turns': 150 })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Unlimited turns' }))
    expect(draft()['config.agent.max_turns']).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Unlimited turns' }))
    expect(draft()['config.agent.max_turns']).toBe(150)
  })

  it('renders the toggle pressed and the number disabled for a null value', () => {
    useSettingsStore.getState().seed({ 'config.agent.max_turns': null })
    renderSection()

    expect(
      screen
        .getByRole('button', { name: 'Unlimited turns' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    // The agent's own default is uncapped, so the row must not imply a cap.
    expect(maxTurnsInput().disabled).toBe(true)
  })

  it('leaves an absent key rendering as a number rather than claiming unlimited', () => {
    useSettingsStore.getState().seed({})
    renderSection()

    expect(
      screen
        .getByRole('button', { name: 'Unlimited turns' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(maxTurnsInput().disabled).toBe(false)
  })
})

describe('SectionAgentRuntime — gateway timeout', () => {
  it('reads 0 as "∞ off" rather than 0s, and says the timeout is an idle one', () => {
    useSettingsStore.getState().seed({ 'config.agent.gateway_timeout': 0 })
    renderSection()

    expect(screen.getByText(/∞ off/)).toBeTruthy()
    expect(screen.getByText(/idle seconds without activity/)).toBeTruthy()
    expect(screen.getByText(/0 means no timeout/)).toBeTruthy()
  })

  it('keeps showing a plain second count for a non-zero timeout', () => {
    useSettingsStore.getState().seed({ 'config.agent.gateway_timeout': 1800 })
    renderSection()

    expect(screen.getByText(/1800s/)).toBeTruthy()
    expect(screen.queryByText(/∞ off/)).toBeNull()
  })

  it('lets 0 be selected, which the old 60-second floor made impossible', () => {
    useSettingsStore.getState().seed({ 'config.agent.gateway_timeout': 60 })
    renderSection()

    const slider = gatewayTimeoutSlider()
    expect(slider.getAttribute('min')).toBe('0')
  })
})

describe('SectionAgentRuntime — fast mode', () => {
  it('is labelled "Fast mode" and offers only the schema enum when the schema is unreachable', () => {
    useSettingsStore.getState().seed({ 'config.agent.service_tier': '' })
    renderSection()

    expect(screen.getByText('Fast mode')).toBeTruthy()

    const options = tierValues()
    // '' | normal | fast | auto | cold, and nothing else — `default` and
    // `flex` were never legal and saved garbage.
    expect(options).toEqual(['', 'normal', 'fast', 'auto', 'cold'])
  })

  it('spells the empty tier "Default" rather than the schema-derived "(unset)"', () => {
    useSettingsStore.getState().seed({ 'config.agent.service_tier': '' })
    renderSection()

    expect(screen.getByDisplayValue('Default')).toBeTruthy()
  })

  it('prefers the schema options when the gateway does answer', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    useSettingsStore.getState().seed({ 'config.agent.service_tier': 'fast' })
    renderSection()

    expect(await screen.findByDisplayValue('Fast')).toBeTruthy()
    expect(tierValues()).toEqual(['', 'normal', 'fast', 'auto', 'cold'])
  })

  it('writes the picked tier straight to the draft store', () => {
    useSettingsStore.getState().seed({ 'config.agent.service_tier': '' })
    renderSection()

    const select = screen.getByDisplayValue('Default')
    fireEvent.change(select, { target: { value: 'fast' } })

    expect(draft()['config.agent.service_tier']).toBe('fast')
  })

  it('stays a select — never a free text input that could save a typo', () => {
    useSettingsStore.getState().seed({ 'config.agent.service_tier': 'fast' })
    renderSection()

    expect(screen.getByDisplayValue('Fast').tagName).toBe('SELECT')
  })
})
