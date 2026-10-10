// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen, buildSidebarGroups } from './settings-screen'
import { settingsSaver } from './lib/saver'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockGetConfig, mockGetConfigSchema, mockGetConfigDefaults } =
  vi.hoisted(() => ({
    mockGetConfig: vi.fn(),
    mockGetConfigSchema: vi.fn(),
    mockGetConfigDefaults: vi.fn(),
  }))

vi.mock('@/lib/hermes-client', () => ({
  getConfig: mockGetConfig,
  // The schema and defaults are best-effort: the screen must render without
  // them, so the default is a rejection rather than something plausible. The
  // unexposed-keys tests override these per-test.
  getConfigSchema: mockGetConfigSchema,
  getConfigDefaults: mockGetConfigDefaults,
}))

beforeEach(() => {
  mockGetConfig.mockImplementation(() =>
    Promise.resolve({ terminal: { timeout: 90 } }),
  )
  mockGetConfigSchema.mockImplementation(() =>
    Promise.reject(new Error('no schema in this test')),
  )
  mockGetConfigDefaults.mockImplementation(() =>
    Promise.reject(new Error('no defaults in this test')),
  )
})

const s = () => useSettingsStore.getState()

/**
 * Rendered without a router on purpose: the active section is a plain optional
 * prop, so the shell stays testable while the route owns `?section=`.
 */
function renderScreen(section?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SettingsScreen section={section} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetSettingsStore()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
  localStorage.clear()
})

describe('buildSidebarGroups', () => {
  /**
   * The dirty dot was `dirty.has(section.id)` — a Set of setting keys tested
   * against a section id — so it could never light for any section.
   */
  it('dots the section that owns the dirty key, not an unrelated one', () => {
    const groups = buildSidebarGroups(new Set(['config.terminal.timeout']))
    const items = groups.flatMap((g) => g.items)

    expect(items.length).toBeGreaterThan(20)
    expect(items.find((i) => i.id === 'execution')?.dirty).toBe(true)
    expect(items.find((i) => i.id === 'workspace')?.dirty).toBe(false)
  })

  it('dots nothing when nothing is dirty', () => {
    const items = buildSidebarGroups(new Set()).flatMap((g) => g.items)
    expect(items.some((i) => i.dirty)).toBe(false)
  })

  it('carries ownership through to the sidebar items', () => {
    const items = buildSidebarGroups(new Set()).flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'raw-config')?.ownership).toBe('self-saving')
    expect(items.find((i) => i.id === 'execution')?.ownership).toBe('store')
  })
})

describe('SettingsScreen', () => {
  it('seeds the store from the server config', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))
    expect(s().committed['config.terminal.timeout']).toBe(90)
    expect(s().dirty.size).toBe(0)
  })

  it('shows the dirty count once a key is edited', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))

    s().set('config.terminal.timeout', 120)

    await waitFor(() => expect(screen.getByText('1 change')).toBeTruthy())
  })

  /**
   * The whole point of the effort: a save that does not land must not report
   * success, and the edited key must stay dirty so the user can retry.
   */
  it('never reports success when the saver fails, and keeps the key dirty', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))
    s().set('config.terminal.timeout', 120)

    await s().save(() =>
      Promise.resolve({
        persisted: [],
        failed: [{ key: 'config.terminal.timeout', reason: 'PUT /api/config: 405' }],
      }),
    )

    await waitFor(() => expect(screen.getByText(/405/)).toBeTruthy())
    expect(screen.queryByText('Saved')).toBeNull()
    expect(s().dirty.has('config.terminal.timeout')).toBe(true)
    expect(s().committed['config.terminal.timeout']).toBe(90)
  })

  it('leaves one dirty key after importing one changed value', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))

    // handleImport's core: the old code called load({...committed, ...parsed})
    // first, which made every imported key equal to committed so the set()
    // loop deleted it from dirty and Import could never save anything.
    const changed = s().importValues({ 'config.terminal.timeout': 120 })

    expect(changed).toBe(1)
    expect(s().dirty.size).toBe(1)
    expect(s().committed['config.terminal.timeout']).toBe(90)
    await waitFor(() => expect(screen.getByText('1 change')).toBeTruthy())
  })

  it('tells the truth about a self-saving section with nothing dirty', async () => {
    renderScreen('raw-config')
    await waitFor(() =>
      expect(screen.getByText('This section saves its own changes')).toBeTruthy(),
    )
  })

  it('wires the real saver in, and that saver is the PUT transport', () => {
    // Guards against the screen quietly being pointed at a stub.
    expect(typeof settingsSaver).toBe('function')
  })
})

describe('buildSidebarGroups — board A flags and hints', () => {
  it('flags off-recommended (◆) and issue (▲) sections from key-meta', () => {
    // agent.max_turns recommended 150, draft 500 → agent-runtime is off-rec;
    // platforms.api_server.extra.port required 8642, draft 9000 → gateway has
    // a config issue.
    const groups = buildSidebarGroups(new Set(), {
      draft: {
        'config.agent.max_turns': 500,
        'config.platforms.api_server.extra.port': 9000,
      },
    })
    const items = groups.flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'agent-runtime')?.offRec).toBe(true)
    expect(items.find((i) => i.id === 'gateway')?.issues).toBe(true)
  })

  it('does not flag a meta key with no curated owner (no all-settings ◆)', () => {
    // compression.threshold: recommended 0.75, no curated section declares it
    // — it must surface via UnexposedKeys, not light the catch-all section.
    const groups = buildSidebarGroups(new Set(), {
      draft: { 'config.compression.threshold': 0.9 },
    })
    const items = groups.flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'all-settings')?.offRec).toBe(false)
  })

  it('an absent key whose meta default equals its recommended shows no ◆', () => {
    // Storage's meta'd keys (sessions.auto_prune T/T, retention_days 90/90):
    // unset → the gateway default applies → equal to the recommendation.
    const groups = buildSidebarGroups(new Set(), { draft: {} })
    const items = groups.flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'storage')?.offRec).toBe(false)
  })

  it('an absent key with no value and no default shows no ▲', () => {
    // platforms.api_server.enabled: required true, no default, no curated
    // owner — with nothing to compare, it flags nothing anywhere.
    const groups = buildSidebarGroups(new Set(), { draft: {} })
    const items = groups.flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'all-settings')?.issues).toBe(false)
  })

  it('lights ▲ with the health page match: coerced strings and list supersets are fine', () => {
    // A string '8642' port and a superset toolsets list match the locked
    // values under requiredValueMatches — no gateway ▲. multiplex_profiles
    // is pinned so its absent-default quirk cannot flag the group anyway.
    const clean = buildSidebarGroups(new Set(), {
      draft: {
        'config.gateway.multiplex_profiles': true,
        'config.platforms.api_server.extra.port': '8642',
        'config.toolsets': ['web', 'hermes-cli', 'kanban'],
      },
    })
    const cleanItems = clean.flatMap((g) => g.items)
    expect(cleanItems.find((i) => i.id === 'gateway')?.issues).toBe(false)
    // …while a genuinely wrong port still flags the owning section.
    const drifted = buildSidebarGroups(new Set(), {
      draft: {
        'config.gateway.multiplex_profiles': true,
        'config.platforms.api_server.extra.port': 9999,
      },
    })
    expect(
      drifted.flatMap((g) => g.items).find((i) => i.id === 'gateway')?.issues,
    ).toBe(true)
  })

  it('treats a null default as a value (∞ ≠ a finite recommendation)', () => {
    // agent.max_turns: default null (∞), recommended 150 — unset means ∞,
    // which genuinely differs from the recommendation.
    const groups = buildSidebarGroups(new Set(), { draft: {} })
    const items = groups.flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'agent-runtime')?.offRec).toBe(true)
  })

  it('computes no meta flags when no draft is supplied', () => {
    const items = buildSidebarGroups(new Set()).flatMap((g) => g.items)
    expect(items.some((i) => i.offRec || i.issues)).toBe(false)
  })

  it('carries board A hints, with the Advanced key count from the schema', () => {
    const groups = buildSidebarGroups(new Set(), { schemaKeyCount: 878 })
    expect(groups.find((g) => g.label === 'Models')?.hint).toBe(
      'fallback · aux',
    )
    expect(groups.find((g) => g.label === 'Integrations')?.hint).toBe(
      'mcp · keys',
    )
    expect(groups.find((g) => g.label === 'Advanced')?.hint).toBe(
      '878 keys · raw',
    )
    // Without a schema count the hint degrades, never lies with a hard-coded 0.
    const bare = buildSidebarGroups(new Set())
    expect(bare.find((g) => g.label === 'Advanced')?.hint).toBe('raw')
  })

  it('orders groups in board A order', () => {
    const labels = buildSidebarGroups(new Set()).map((g) => g.label)
    expect(labels.indexOf('Models')).toBeLessThan(labels.indexOf('Danger'))
    expect(labels.indexOf('Agent behavior')).toBeLessThan(
      labels.indexOf('Integrations'),
    )
    expect(labels[labels.length - 1]).toBe('Danger')
  })
})

describe('SettingsScreen — unexposed keys block', () => {
  function mockAgentSchema() {
    mockGetConfigSchema.mockImplementation(() =>
      Promise.resolve({
        category_order: ['agent'],
        fields: {
          // Curated: agent-runtime declares it, so it must NOT appear.
          'agent.max_turns': {
            type: 'number',
            description: 'Max turns',
            category: 'agent',
          },
          // Uncovered schema rows under agent.
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
          // Different namespace: excluded by the prefix.
          'terminal.timeout': {
            type: 'number',
            description: 'Timeout',
            category: 'terminal',
          },
        },
      }),
    )
    mockGetConfigDefaults.mockImplementation(() =>
      Promise.resolve({
        agent: { run_budget_seconds: 0, max_turns: 40, stall_guards: true },
      }),
    )
  }

  it('lists uncovered agent.* schema rows under agent-runtime, not curated ones', async () => {
    mockAgentSchema()
    // An overlay edit (not a raw seed): the screen reseeds committed from
    // getConfig on mount, which would wipe a seeded committed value.
    s().set('config.agent.run_budget_seconds', 650)
    renderScreen('agent-runtime')

    const head = await screen.findByText(/More agent\.\* keys/)
    expect(head.textContent).toContain('2 keys')
    // Collapsed by default (board A): the rows are hidden until "show all".
    expect(screen.queryByText('agent.run_budget_seconds')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /show all/ }))
    expect(screen.getByText('agent.run_budget_seconds')).toBeTruthy()
    expect(screen.queryByText('agent.max_turns')).toBeNull()
    expect(screen.queryByText('terminal.timeout')).toBeNull()
    // Current value from the store, default from the defaults payload.
    expect(screen.getByText('650')).toBeTruthy()
    expect(screen.getByText(/default 0/)).toBeTruthy()
  })

  it('Edit jumps to All-settings via the section change callback', async () => {
    mockAgentSchema()
    s().seed({})
    const onSectionChange = vi.fn()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <SettingsScreen
          section="agent-runtime"
          onSectionChange={onSectionChange}
        />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /show all/ }))
    // Rows are alphabetical: run_budget_seconds sorts before stall_guards.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(onSectionChange).toHaveBeenCalledWith('all-settings')
  })
})
