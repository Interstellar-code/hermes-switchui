// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionAllSettings, {
  fieldsFromValues,
  matchesQuery,
} from './section-all-settings'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockGetConfigSchema, mockGetConfigDefaults } = vi.hoisted(() => ({
  mockGetConfigSchema: vi.fn(),
  mockGetConfigDefaults: vi.fn(),
}))

vi.mock('@/lib/hermes-client', () => ({
  getConfigSchema: mockGetConfigSchema,
  getConfigDefaults: mockGetConfigDefaults,
}))

const SCHEMA = {
  category_order: ['terminal', 'security'],
  fields: {
    'terminal.backend': {
      type: 'select',
      description: 'Terminal execution backend',
      category: 'terminal',
      options: ['local', 'docker', 'ssh', 'modal', 'daytona', 'singularity'],
    },
    'terminal.docker_image': {
      type: 'string',
      description: 'Terminal → Docker Image',
      category: 'terminal',
    },
    'terminal.timeout': {
      type: 'number',
      description: 'Terminal → Timeout',
      category: 'terminal',
    },
    'terminal.docker_volumes': {
      type: 'list',
      description: 'Terminal → Docker Volumes',
      category: 'terminal',
    },
    'security.tirith_enabled': {
      type: 'boolean',
      description: 'Enable the Tirith scanner',
      category: 'security',
    },
    'discord.bot_token': {
      type: 'string',
      description: 'Discord → Bot Token',
      category: 'discord',
    },
  },
}

function renderSection(props: { query?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SectionAllSettings {...props} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('fieldsFromValues', () => {
  it('derives a field list from the config the store already holds', () => {
    const fields = fieldsFromValues({
      'config.terminal.timeout': 90,
      'config.model': 'x',
      'hermes.not.config': 1,
    })
    expect(fields.map((f) => f.key)).toEqual([
      'config.model',
      'config.terminal.timeout',
    ])
    expect(fields[1].category).toBe('terminal')
    // A top-level key has no category segment of its own.
    expect(fields[0].category).toBe('general')
  })
})

describe('matchesQuery', () => {
  const field = {
    key: 'config.terminal.docker_image',
    schemaKey: 'terminal.docker_image',
    type: 'string' as const,
    description: 'Terminal → Docker Image',
    category: 'terminal',
  }

  it('matches the key path, the description and the category', () => {
    expect(matchesQuery(field, 'docker')).toBe(true)
    expect(matchesQuery(field, 'terminal')).toBe(true)
    expect(matchesQuery(field, '')).toBe(true)
    expect(matchesQuery(field, 'zzz')).toBe(false)
  })
})

describe('SectionAllSettings', () => {
  it('renders one collapsible group per category, collapsed', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    renderSection()

    await waitFor(() => expect(screen.getByText('6 fields')).toBeTruthy())
    expect(screen.getByRole('button', { name: /Show 4 settings/ })).toBeTruthy()
    // Collapsed by default: 555 rows must not mount on a cold open.
    expect(screen.queryByText('config.terminal.docker_image')).toBeNull()
  })

  it('reveals the rows for a category, key path and all', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    renderSection()

    await waitFor(() => expect(screen.getByText('6 fields')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Show 4 settings/ }))

    expect(screen.getByText('config.terminal.docker_image')).toBeTruthy()
    expect(screen.getByText('Docker image')).toBeTruthy()
  })

  /** The motivating example: two options curated, six published. */
  it('offers every backend the schema declares', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    useSettingsStore.getState().seed({ 'config.terminal.backend': 'local' })
    renderSection({ query: 'terminal.backend' })

    // The store-derived fallback rows paint first, so wait for the *schema* to
    // land rather than for the key to appear.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy())
    const select: HTMLSelectElement = screen.getByRole('combobox')
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'local',
      'docker',
      'ssh',
      'modal',
      'daytona',
      'singularity',
    ])
  })

  it('writes through the same store the save bar reads', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    useSettingsStore.getState().seed({ 'config.terminal.docker_image': 'python' })
    renderSection({ query: 'docker_image' })

    await waitFor(() => expect(screen.getByDisplayValue('python')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('python'), {
      target: { value: 'node' },
    })

    expect(useSettingsStore.getState().draft['config.terminal.docker_image']).toBe(
      'node',
    )
    expect(useSettingsStore.getState().dirty.has('config.terminal.docker_image')).toBe(
      true,
    )
  })

  it('renders a boolean as a switch and round-trips it', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    useSettingsStore.getState().seed({ 'config.security.tirith_enabled': false })
    renderSection({ query: 'tirith' })

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy())
    fireEvent.click(screen.getByRole('switch'))
    expect(
      useSettingsStore.getState().draft['config.security.tirith_enabled'],
    ).toBe(true)
  })

  /** Newline-split, exactly how docker_volumes already behaves. */
  it('edits a list as newline-separated text', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    useSettingsStore
      .getState()
      .seed({ 'config.terminal.docker_volumes': ['/a:/a'] })
    renderSection({ query: 'docker_volumes' })

    await waitFor(() => expect(screen.getByDisplayValue('/a:/a')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('/a:/a'), {
      target: { value: '/a:/a\n/b:/b\n\n' },
    })
    expect(
      useSettingsStore.getState().draft['config.terminal.docker_volumes'],
    ).toEqual(['/a:/a', '/b:/b'])
  })

  it('marks a row a curated section already surfaces', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    renderSection({ query: 'terminal.timeout' })

    await waitFor(() => expect(screen.getByText('config.terminal.timeout')).toBeTruthy())
    expect(screen.getByText('also in Execution')).toBeTruthy()
  })

  it('filters to the matching fields and says how many matched', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    mockGetConfigDefaults.mockResolvedValue({})
    renderSection({ query: 'docker' })

    await waitFor(() => expect(screen.getByText('2 matches')).toBeTruthy())
    expect(screen.queryByText('config.security.tirith_enabled')).toBeNull()
  })

  /**
   * The page may never block on the schema: with it gone, the browser falls
   * back to the keys the server config itself contains.
   */
  it('degrades to the keys the config already has when the schema 404s', async () => {
    mockGetConfigSchema.mockRejectedValue(new Error('404: Not Found'))
    mockGetConfigDefaults.mockRejectedValue(new Error('404: Not Found'))
    useSettingsStore.getState().seed({
      'config.terminal.timeout': 90,
      'config.discord.bot_token': 'abc',
    })
    renderSection()

    await waitFor(() =>
      expect(screen.getByText(/did not return a config schema/)).toBeTruthy(),
    )
    expect(screen.getByText('2 fields')).toBeTruthy()
    // One category per top-level segment, one field in each.
    const toggles = screen.getAllByRole('button', { name: /Show 1 setting/ })
    expect(toggles).toHaveLength(2)
    for (const toggle of toggles) fireEvent.click(toggle)
    expect(screen.getByText('config.discord.bot_token')).toBeTruthy()
    expect(screen.getByText('config.terminal.timeout')).toBeTruthy()
  })
})
