// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionGateway, { validateApiServerHost, validateApiServerPort } from './section-gateway'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockFetchScopeStatus } = vi.hoisted(() => ({
  mockFetchScopeStatus: vi.fn(),
}))

vi.mock('@/screens/chat/components/chat-composer-services', () => ({
  fetchScopeStatus: mockFetchScopeStatus,
}))

vi.mock('@/components/hermes-docs-link', () => ({
  HermesDocsLink: ({ label }: { label?: string }) => <span>{label ?? 'Docs'}</span>,
}))

function loadDraft(patch: Record<string, unknown>) {
  useSettingsStore.getState().seed(patch)
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SectionGateway />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('validateApiServerHost', () => {
  it('accepts common valid hosts', () => {
    expect(validateApiServerHost('127.0.0.1')).toBeNull()
    expect(validateApiServerHost('0.0.0.0')).toBeNull()
    expect(validateApiServerHost('localhost')).toBeNull()
    expect(validateApiServerHost('my-gateway.internal')).toBeNull()
  })

  it('rejects an empty host', () => {
    expect(validateApiServerHost('')).toMatch(/required/)
    expect(validateApiServerHost('   ')).toMatch(/required/)
  })

  it('rejects a host with a scheme prefix', () => {
    expect(validateApiServerHost('http://127.0.0.1')).toMatch(/bare host/)
  })

  it('rejects a host with an embedded port', () => {
    expect(validateApiServerHost('127.0.0.1:8642')).toMatch(/Port field/)
  })

  it('rejects an out-of-range IPv4 octet', () => {
    expect(validateApiServerHost('999.0.0.1')).toMatch(/not a valid IPv4/)
  })

  it('rejects a host containing spaces', () => {
    expect(validateApiServerHost('127.0.0. 1')).toMatch(/spaces/)
  })
})

describe('validateApiServerPort', () => {
  it('accepts a normal port', () => {
    expect(validateApiServerPort(8642)).toBeNull()
  })

  it('rejects out-of-range ports', () => {
    expect(validateApiServerPort(0)).toMatch(/between 1 and 65535/)
    expect(validateApiServerPort(70000)).toMatch(/between 1 and 65535/)
  })

  it('rejects non-integer ports', () => {
    expect(validateApiServerPort(80.5)).toMatch(/whole number/)
    expect(validateApiServerPort(Number.NaN)).toMatch(/whole number/)
  })

  it('warns on privileged ports below 1024', () => {
    expect(validateApiServerPort(80)).toMatch(/privileged/)
  })
})

describe('SectionGateway', () => {
  it('explains multiplex_profiles and round-trips the toggle', async () => {
    mockFetchScopeStatus.mockResolvedValue({ mode: 'single', servedProfiles: null, sessionCounts: {} })
    loadDraft({ 'config.gateway.multiplex_profiles': false })

    renderSection()
    await waitFor(() => expect(mockFetchScopeStatus).toHaveBeenCalled())

    expect(screen.getByText(/one gateway process serves multiple profiles/i)).toBeTruthy()

    // Previously an unnamed switch (`name: ''`) — `SettingRow` now gives
    // every single-control row a real `<label htmlFor>`, so the toggle's
    // accessible name is the row's label text.
    const toggle = screen.getByRole('switch', { name: /Multiplex profiles/ })
    fireEvent.click(toggle)
    expect(useSettingsStore.getState().draft['config.gateway.multiplex_profiles']).toBe(true)
  })

  it('shows the live topology from /api/gateway-status scope', async () => {
    mockFetchScopeStatus.mockResolvedValue({
      mode: 'single',
      servedProfiles: null,
      sessionCounts: {},
      servingProfile: 'default',
    })
    loadDraft({ 'config.gateway.multiplex_profiles': false })

    renderSection()

    await waitFor(() => expect(screen.getByText(/single \(serving "default"\)/)).toBeTruthy())
  })

  it('warns when the saved setting disagrees with the live gateway topology', async () => {
    mockFetchScopeStatus.mockResolvedValue({
      mode: 'single',
      servedProfiles: null,
      sessionCounts: {},
      servingProfile: 'default',
    })
    loadDraft({ 'config.gateway.multiplex_profiles': true })

    renderSection()

    await waitFor(() =>
      expect(screen.getByText(/does not match what the live gateway is doing/)).toBeTruthy(),
    )
  })

  it('does not warn about mismatch when the live topology matches the setting', async () => {
    mockFetchScopeStatus.mockResolvedValue({
      mode: 'multiplex',
      servedProfiles: ['default', 'work'],
      sessionCounts: {},
    })
    loadDraft({ 'config.gateway.multiplex_profiles': true })

    renderSection()
    await waitFor(() => expect(screen.getByText('multiplex')).toBeTruthy())

    expect(screen.queryByText(/does not match what the live gateway is doing/)).toBeNull()
  })

  it('round-trips the API server host and flags an invalid value', async () => {
    mockFetchScopeStatus.mockResolvedValue({ mode: 'single', servedProfiles: null, sessionCounts: {} })
    loadDraft({ 'config.platforms.api_server.host': '127.0.0.1' })

    renderSection()
    await waitFor(() => expect(mockFetchScopeStatus).toHaveBeenCalled())

    const hostInput = screen.getByDisplayValue('127.0.0.1')
    fireEvent.change(hostInput, { target: { value: 'http://badhost' } })

    expect(useSettingsStore.getState().draft['config.platforms.api_server.host']).toBe('http://badhost')
    expect(screen.getByText(/bare host/)).toBeTruthy()
  })

  it('round-trips the API server port and flags an invalid value', async () => {
    mockFetchScopeStatus.mockResolvedValue({ mode: 'single', servedProfiles: null, sessionCounts: {} })
    loadDraft({ 'config.platforms.api_server.port': 8642 })

    renderSection()
    await waitFor(() => expect(mockFetchScopeStatus).toHaveBeenCalled())

    const portInput = screen.getByDisplayValue('8642')
    fireEvent.change(portInput, { target: { value: '99999' } })

    expect(useSettingsStore.getState().draft['config.platforms.api_server.port']).toBe(99999)
    expect(screen.getByText(/between 1 and 65535/)).toBeTruthy()
  })
})
