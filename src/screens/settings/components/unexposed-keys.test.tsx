// @vitest-environment jsdom
/**
 * Covers the board A "More agent.* keys" block: schema rows under a prefix
 * that no curated section declares, each with current value and default,
 * collapsed by default, handing edits off to All-settings.
 *
 * Only the network edge (getConfigSchema / getConfigDefaults) is mocked; the
 * schema index, the registry's coverage check and the store are the real ones.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnexposedKeys } from './unexposed-keys'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockGetConfigSchema, mockGetConfigDefaults } = vi.hoisted(() => ({
  mockGetConfigSchema: vi.fn(),
  mockGetConfigDefaults: vi.fn(),
}))

vi.mock('@/lib/hermes-client', () => ({
  getConfigSchema: mockGetConfigSchema,
  getConfigDefaults: mockGetConfigDefaults,
}))

beforeEach(() => {
  mockGetConfigSchema.mockResolvedValue({
    category_order: ['agent'],
    fields: {
      // Curated (agent-runtime declares it) — must be omitted.
      'agent.max_turns': {
        type: 'number',
        description: 'Max turns',
        category: 'agent',
      },
      // Uncovered rows.
      'agent.run_budget_seconds': {
        type: 'number',
        description: 'Run budget',
        category: 'agent',
      },
      'agent.stall_guards': {
        type: 'boolean',
        description: 'Stall guards',
        category: 'agent',
      },
      // Different namespace — excluded by the prefix.
      'terminal.timeout': {
        type: 'number',
        description: 'Timeout',
        category: 'terminal',
      },
    },
  })
  mockGetConfigDefaults.mockResolvedValue({
    agent: { run_budget_seconds: 0, max_turns: 40, stall_guards: true },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

function renderBlock(prefix = 'agent.', onEditKey?: (key: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <UnexposedKeys prefix={prefix} onEditKey={onEditKey} />
    </QueryClientProvider>,
  )
}

describe('UnexposedKeys', () => {
  it('lists uncovered agent.* schema rows with value and default, omitting covered ones', async () => {
    useSettingsStore.getState().seed({ 'config.agent.run_budget_seconds': 650 })
    renderBlock()

    const head = await screen.findByText(/More agent\.\* keys/)
    expect(head.textContent).toContain('2 keys')
    fireEvent.click(screen.getByRole('button', { name: /show all/ }))

    expect(screen.getByText('agent.run_budget_seconds')).toBeTruthy()
    expect(screen.getByText('650')).toBeTruthy()
    expect(screen.getByText(/default 0/)).toBeTruthy()
    expect(screen.getByText('agent.stall_guards')).toBeTruthy()
    // Curated and out-of-namespace rows never appear.
    expect(screen.queryByText('agent.max_turns')).toBeNull()
    expect(screen.queryByText('terminal.timeout')).toBeNull()
  })

  it('is collapsed by default and toggles', async () => {
    renderBlock()
    await screen.findByText(/More agent\.\* keys/)
    expect(screen.queryByText('agent.run_budget_seconds')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /show all/ }))
    expect(screen.getByText('agent.run_budget_seconds')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /hide/ }))
    expect(screen.queryByText('agent.run_budget_seconds')).toBeNull()
  })

  it('hands the bare key to the Edit callback', async () => {
    const onEditKey = vi.fn()
    renderBlock('agent.', onEditKey)
    fireEvent.click(await screen.findByRole('button', { name: /show all/ }))
    // Rows are alphabetical: run_budget_seconds sorts before stall_guards.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(onEditKey).toHaveBeenCalledWith('agent.run_budget_seconds')
  })

  it('renders nothing when every schema key under the prefix is covered', async () => {
    mockGetConfigSchema.mockResolvedValue({
      category_order: ['agent'],
      fields: {
        'agent.max_turns': {
          type: 'number',
          description: 'Max turns',
          category: 'agent',
        },
      },
    })
    const { container } = renderBlock()
    // Give the schema query a tick to resolve; the block must stay absent.
    await waitFor(() => expect(mockGetConfigSchema).toHaveBeenCalled())
    expect(container.querySelector('.unexposed-keys')).toBeNull()
  })

  it('renders nothing while the schema is unavailable', async () => {
    mockGetConfigSchema.mockRejectedValue(new Error('gateway down'))
    const { container } = renderBlock()
    await waitFor(() => expect(mockGetConfigSchema).toHaveBeenCalled())
    expect(container.querySelector('.unexposed-keys')).toBeNull()
  })
})
