// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SectionMcpRegistered from './section-mcp-registered'

const { mockNavigate, mockGetPluginsHub, mockRescanDashboardPlugins } =
  vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockGetPluginsHub: vi.fn(),
    mockRescanDashboardPlugins: vi.fn(),
  }))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))
vi.mock('@/lib/hermes-client', () => ({
  getPluginsHub: mockGetPluginsHub,
  rescanDashboardPlugins: mockRescanDashboardPlugins,
}))
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SectionMcpRegistered />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SectionMcpRegistered', () => {
  it('derives its preview and enabled count from the shared Plugins Hub query', async () => {
    mockGetPluginsHub.mockResolvedValue({
      plugins: [
        {
          name: 'enabled',
          version: '1',
          description: 'ready',
          runtimeStatus: 'enabled',
        },
        { name: 'inactive', runtimeStatus: 'inactive' },
        { name: 'disabled', runtimeStatus: 'disabled' },
        { name: 'fourth', runtimeStatus: 'enabled' },
      ],
    })

    renderSection()

    await waitFor(() =>
      expect(screen.getByText(/4 plugins · 2 enabled/)).toBeTruthy(),
    )
    expect(screen.getByText('enabled')).toBeTruthy()
    expect(screen.getByText('inactive')).toBeTruthy()
    expect(screen.getByText('disabled')).toBeTruthy()
    expect(screen.getByText('+1 more')).toBeTruthy()
    expect(mockGetPluginsHub).toHaveBeenCalledTimes(1)
  })

  it('opens the Plugins Manager and rescans through the shared helper', async () => {
    mockGetPluginsHub.mockResolvedValue({ plugins: [] })
    mockRescanDashboardPlugins.mockResolvedValue({ ok: true, count: 0 })

    renderSection()

    await waitFor(() => expect(mockGetPluginsHub).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /open plugins page/i }))
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/plugins' })

    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    await waitFor(() =>
      expect(mockRescanDashboardPlugins).toHaveBeenCalledTimes(1),
    )
    await waitFor(() => expect(mockGetPluginsHub).toHaveBeenCalledTimes(2))
  })
})
