// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionAdvanced from './section-advanced'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockGetLogs, mockGetConfigSchema, mockGetConfigDefaults } = vi.hoisted(
  () => ({
    mockGetLogs: vi.fn(),
    mockGetConfigSchema: vi.fn(),
    mockGetConfigDefaults: vi.fn(),
  }),
)

vi.mock('@/lib/hermes-client', () => ({
  getLogs: mockGetLogs,
  getConfigSchema: mockGetConfigSchema,
  getConfigDefaults: mockGetConfigDefaults,
}))

vi.mock('@/components/ui/toast', () => ({
  toast: vi.fn(),
}))

/** The live logging.level enum, as `/api/config/schema` publishes it. */
const SCHEMA = {
  category_order: ['logging'],
  fields: {
    'logging.level': {
      type: 'select',
      category: 'logging',
      options: ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'TRACE'],
    },
  },
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SectionAdvanced />
    </QueryClientProvider>,
  )
}

function optionValues(): Array<string> {
  return Array.from(
    screen.getByRole<HTMLSelectElement>('combobox').options,
  ).map((o) => o.value)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('SectionAdvanced', () => {
  it('renders the log level row with its key-meta badges (config.yaml · Needs restart)', () => {
    mockGetConfigSchema.mockRejectedValue(new Error('offline'))
    mockGetConfigDefaults.mockRejectedValue(new Error('offline'))
    useSettingsStore.getState().seed({ 'config.logging.level': 'INFO' })

    renderSection()

    const row = screen.getByText('Log level').closest('.row') as HTMLElement
    expect(within(row).getByText('config.yaml')).toBeTruthy()
    expect(within(row).getByText('Needs restart')).toBeTruthy()
  })

  it('offers ERROR in the fallback list when the schema is unreachable, and saves it', () => {
    mockGetConfigSchema.mockRejectedValue(new Error('offline'))
    mockGetConfigDefaults.mockRejectedValue(new Error('offline'))
    useSettingsStore.getState().seed({ 'config.logging.level': 'INFO' })

    renderSection()

    expect(optionValues()).toEqual(['DEBUG', 'INFO', 'WARNING', 'ERROR'])

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'ERROR' },
    })
    expect(useSettingsStore.getState().draft['config.logging.level']).toBe(
      'ERROR',
    )
  })

  it('prefers the schema-published list when the gateway answers', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    useSettingsStore.getState().seed({ 'config.logging.level': 'INFO' })

    renderSection()

    await screen.findByRole('combobox')
    await waitFor(() =>
      expect(optionValues()).toEqual([
        'DEBUG',
        'INFO',
        'WARNING',
        'ERROR',
        'TRACE',
      ]),
    )
  })

  it('writes the picked level straight to the draft store', () => {
    mockGetConfigSchema.mockRejectedValue(new Error('offline'))
    mockGetConfigDefaults.mockRejectedValue(new Error('offline'))
    useSettingsStore.getState().seed({ 'config.logging.level': 'INFO' })

    renderSection()

    fireEvent.change(screen.getByDisplayValue('INFO'), {
      target: { value: 'DEBUG' },
    })

    expect(useSettingsStore.getState().draft['config.logging.level']).toBe(
      'DEBUG',
    )
    expect(useSettingsStore.getState().dirty.has('config.logging.level')).toBe(
      true,
    )
  })

  it('keeps a saved value outside the offered list visible instead of snapping blank', () => {
    mockGetConfigSchema.mockRejectedValue(new Error('offline'))
    mockGetConfigDefaults.mockRejectedValue(new Error('offline'))
    useSettingsStore.getState().seed({ 'config.logging.level': 'TRACE' })

    renderSection()

    expect(screen.getByDisplayValue('TRACE (not offered here)')).toBeTruthy()
  })

  it('gives the diagnostics row no meta — it is a button, not a config key', () => {
    mockGetConfigSchema.mockRejectedValue(new Error('offline'))
    mockGetConfigDefaults.mockRejectedValue(new Error('offline'))
    renderSection()

    const row = screen
      .getByText('View recent logs')
      .closest('.row') as HTMLElement
    expect(within(row).queryByText('config.yaml')).toBeNull()
  })
})
