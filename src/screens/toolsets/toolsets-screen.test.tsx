// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolsetsScreen, orderToolsetGroups, toolsetRowState } from './toolsets-screen'
import type * as ToolsetsApiModule from '@/lib/toolsets-api'
import type { ToolsetCatalog } from '@/lib/toolsets-api'
import type { NormalizedToolset } from '@/lib/toolsets'

const mocks = vi.hoisted(() => ({ fetchToolsetCatalog: vi.fn() }))

vi.mock('@/lib/toolsets-api', async () => {
  const actual =
    await vi.importActual<typeof ToolsetsApiModule>('@/lib/toolsets-api')
  const { useQuery } = await import('@tanstack/react-query')
  return {
    ...actual,
    fetchToolsetCatalog: mocks.fetchToolsetCatalog,
    useToolsetCatalog: () =>
      useQuery({
        queryKey: actual.TOOLSET_CATALOG_QUERY_KEY,
        queryFn: mocks.fetchToolsetCatalog,
      }),
  }
})

function toolset(patch: Partial<NormalizedToolset> = {}): NormalizedToolset {
  return {
    key: 'file',
    label: 'File Operations',
    group: 'Core',
    destructive: true,
    plugin: false,
    ...patch,
  }
}

const GATEWAY_ROWS: Array<NormalizedToolset> = [
  toolset({ gatewayEnabled: true }),
  toolset({
    key: 'browser',
    label: 'Browser Automation',
    group: 'Web & Search',
    destructive: true,
    gatewayEnabled: false,
  }),
  toolset({
    key: 'memory',
    label: 'Memory',
    group: 'Memory & Context',
    destructive: false,
    gatewayEnabled: true,
  }),
  toolset({
    key: 'workflow',
    label: 'Workflow',
    group: 'Plugins',
    destructive: false,
    plugin: true,
    gatewayEnabled: true,
  }),
]

function renderScreen(catalog: ToolsetCatalog) {
  mocks.fetchToolsetCatalog.mockResolvedValue(catalog)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToolsetsScreen />
    </QueryClientProvider>,
  )
}

async function renderGateway() {
  renderScreen({ toolsets: GATEWAY_ROWS, source: 'gateway' })
  await waitFor(() =>
    expect(screen.getByText('Live gateway registry')).toBeTruthy(),
  )
}

function rowFor(label: string): HTMLTableRowElement {
  const row = screen.getByText(label).closest('tr')
  if (!row) throw new Error(`no row for ${label}`)
  return row
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('toolsetRowState', () => {
  // The whole point of isToolsetSuppressed's source guard: the static
  // fallback cannot observe what the gateway suppresses, so it must not
  // report a state at all rather than guess one from a missing field.
  it('never claims a state for the static fallback', () => {
    expect(toolsetRowState(toolset(), 'static')).toBe('unknown')
    expect(toolsetRowState(toolset({ gatewayEnabled: false }), 'static')).toBe(
      'unknown',
    )
    expect(toolsetRowState(toolset({ gatewayEnabled: true }), 'static')).toBe(
      'unknown',
    )
  })

  it('reads enabled and suppressed off a live gateway payload', () => {
    expect(toolsetRowState(toolset({ gatewayEnabled: true }), 'gateway')).toBe(
      'enabled',
    )
    expect(toolsetRowState(toolset({ gatewayEnabled: false }), 'gateway')).toBe(
      'suppressed',
    )
  })

  // A gateway payload missing the field entirely is still not evidence of
  // being enabled.
  it('stays unknown when a gateway row carries no enabled flag', () => {
    expect(toolsetRowState(toolset(), 'gateway')).toBe('unknown')
  })
})

describe('orderToolsetGroups', () => {
  it('keeps the canonical group order and sinks Plugins to the end', () => {
    const groups = orderToolsetGroups([
      toolset({ key: 'a', group: 'Plugins', plugin: true }),
      toolset({ key: 'b', group: 'Memory & Context' }),
      toolset({ key: 'c', group: 'Core' }),
    ])
    expect(groups).toEqual(['Core', 'Memory & Context', 'Plugins'])
  })

  it('includes an unrecognised group rather than dropping its rows', () => {
    const groups = orderToolsetGroups([
      toolset({ key: 'a', group: 'Plugins', plugin: true }),
      toolset({ key: 'b', group: 'Experimental' }),
      toolset({ key: 'c', group: 'Core' }),
    ])
    expect(groups).toEqual(['Core', 'Experimental', 'Plugins'])
  })
})

describe('ToolsetsScreen', () => {
  it('groups live rows and shows key, state, plugin and destructive markers', async () => {
    await renderGateway()

    const fileRow = rowFor('File Operations')
    expect(within(fileRow).getByText('file')).toBeTruthy()
    expect(within(fileRow).getByText('Enabled')).toBeTruthy()
    expect(within(fileRow).getByText(/Destructive/)).toBeTruthy()

    const workflowRow = rowFor('Workflow')
    expect(within(workflowRow).getByText(/Plugin/)).toBeTruthy()

    // Group headings, canonical order, Plugins last.
    const headings = screen
      .getAllByTestId('toolset-group-heading')
      .map((node) => node.textContent)
    expect(headings).toEqual([
      'Core',
      'Memory & Context',
      'Web & Search',
      'Plugins',
    ])
  })

  it('marks a gateway-disabled toolset suppressed and keeps its security hint', async () => {
    await renderGateway()

    const browserRow = rowFor('Browser Automation')
    expect(within(browserRow).getByText('Suppressed')).toBeTruthy()
    expect(
      within(browserRow).getByText(/will not be given its tools/i),
    ).toBeTruthy()
    // Suppression must not swallow the security hint — both apply.
    expect(within(browserRow).getByText(/Approval-gated/i)).toBeTruthy()
  })

  // The honesty requirement: a static payload is not live state and the
  // screen has to say so instead of implying the rows are current.
  it('says the static fallback is not live state', async () => {
    renderScreen({
      toolsets: [toolset(), toolset({ key: 'terminal', label: 'Terminal & Processes' })],
      source: 'static',
    })

    const notice = await waitFor(() =>
      screen.getByTestId('toolset-source-notice'),
    )
    await waitFor(() => expect(notice.textContent).toMatch(/not live/i))
    expect(notice.textContent).toMatch(/gateway could not be reached/i)
    // No row may claim to be enabled when nothing could observe that.
    expect(screen.queryByText('Enabled', { selector: '.sk-status-pill' })).toBeNull()
    expect(screen.getAllByText('Unknown', { selector: '.sk-status-pill' })).toHaveLength(2)
  })

  it('renders the static catalog and the not-live notice when the fetch fails', async () => {
    mocks.fetchToolsetCatalog.mockRejectedValue(new Error('offline'))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ToolsetsScreen />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(
        screen.getByTestId('toolset-source-notice').textContent,
      ).toMatch(/not live/i),
    )
    // Static catalog still renders, so the screen is never blank.
    expect(screen.getByText('File Operations')).toBeTruthy()
  })

  it('filters by state, group and search', async () => {
    await renderGateway()

    fireEvent.click(screen.getByRole('button', { name: /^Suppressed/ }))
    expect(screen.queryByText('File Operations')).toBeNull()
    expect(screen.getByText('Browser Automation')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^All 4/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Plugins 1' }))
    expect(screen.getByText('Workflow')).toBeTruthy()
    expect(screen.queryByText('Memory')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All groups 4' }))
    fireEvent.change(screen.getByLabelText('Search toolsets'), {
      target: { value: 'memory' },
    })
    expect(screen.getByText('Memory')).toBeTruthy()
    expect(screen.queryByText('Workflow')).toBeNull()
  })

  it('offers no way to change a toolset — the screen is read-only', async () => {
    await renderGateway()

    // Enabling or disabling rewrites ~/.hermes/config.yaml and rotates the
    // session, discarding history. No checkbox, switch or toggle may exist
    // here until that has a confirm flow behind it.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.getByText(/Read-only/)).toBeTruthy()
  })
})
