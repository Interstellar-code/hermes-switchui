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
import { PluginsScreen } from './plugins-screen'

const mocks = vi.hoisted(() => ({
  deleteAgentPlugin: vi.fn(),
  disableAgentPlugin: vi.fn(),
  enableAgentPlugin: vi.fn(),
  getPluginsHub: vi.fn(),
  installAgentPlugin: vi.fn(),
  setPluginVisibility: vi.fn(),
  toast: vi.fn(),
  updateAgentPlugin: vi.fn(),
}))

vi.mock('@/lib/hermes-client', () => ({
  deleteAgentPlugin: mocks.deleteAgentPlugin,
  disableAgentPlugin: mocks.disableAgentPlugin,
  enableAgentPlugin: mocks.enableAgentPlugin,
  getPluginsHub: mocks.getPluginsHub,
  installAgentPlugin: mocks.installAgentPlugin,
  setPluginVisibility: mocks.setPluginVisibility,
  updateAgentPlugin: mocks.updateAgentPlugin,
}))
vi.mock('@/components/ui/toast', () => ({ toast: mocks.toast }))

const plugins = [
  {
    name: 'hermes-switch-ui',
    version: '1.0.0',
    description: 'SwitchUI bridge',
    source: 'bundled',
    runtimeStatus: 'enabled',
    hasDashboardManifest: true,
    dashboardManifest: null,
    canRemove: false,
    canUpdateGit: false,
    authRequired: false,
    authCommand: '',
    userHidden: false,
  },
  {
    name: 'bundled-on',
    version: '1.0.0',
    description: 'Bundled and enabled',
    source: 'bundled',
    runtimeStatus: 'enabled',
    hasDashboardManifest: false,
    dashboardManifest: null,
    canRemove: false,
    canUpdateGit: false,
    authRequired: false,
    authCommand: '',
    userHidden: false,
  },
  {
    name: 'bundled-off',
    version: '1.0.0',
    description: 'Bundled and inactive',
    source: 'bundled',
    runtimeStatus: 'inactive',
    hasDashboardManifest: false,
    dashboardManifest: null,
    canRemove: false,
    canUpdateGit: false,
    authRequired: false,
    authCommand: '',
    userHidden: false,
  },
  {
    name: 'third-party',
    version: '2.0.0',
    description: 'Needs CLI activation',
    source: 'git',
    runtimeStatus: 'disabled',
    hasDashboardManifest: true,
    dashboardManifest: {
      label: 'Third party Dashboard tab',
      hasApi: true,
      hasTab: true,
      tabHidden: true,
    },
    canRemove: true,
    canUpdateGit: true,
    authRequired: true,
    authCommand: 'hermes auth third-party',
    userHidden: true,
  },
  {
    name: 'mystery',
    version: '',
    description: 'Unexpected runtime state',
    source: 'project',
    runtimeStatus: 'starting',
    hasDashboardManifest: false,
    dashboardManifest: null,
    canRemove: false,
    canUpdateGit: false,
    authRequired: false,
    authCommand: '',
    userHidden: false,
    // Projection must make this impossible in ordinary use; the UI must not
    // render it even if an unsafe fixture crosses the type boundary.
    path: '/Users/me/.hermes/plugins/mystery',
  },
]

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PluginsScreen />
    </QueryClientProvider>,
  )
}

async function loadHub(rows = plugins) {
  mocks.getPluginsHub.mockResolvedValue({ plugins: rows })
  renderScreen()
  await waitFor(() => expect(screen.getByText('bundled-on')).toBeTruthy())
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PluginsScreen', () => {
  it('renders Hub rows, filters inactive and disabled states, and searches safe fields', async () => {
    await loadHub()

    expect(screen.getByText('mystery')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(screen.queryByText('/Users/me/.hermes/plugins/mystery')).toBeNull()
    const mystery = screen.getByText('mystery').closest('article')
    expect(
      within(mystery!).queryByRole('button', { name: 'Update' }),
    ).toBeNull()
    expect(
      within(mystery!).queryByRole('button', { name: 'Remove' }),
    ).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: /inactive \/ disabled/i }),
    )
    expect(screen.getByText('bundled-off')).toBeTruthy()
    expect(screen.getByText('third-party')).toBeTruthy()
    expect(screen.queryByText('bundled-on')).toBeNull()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search plugins' }), {
      target: { value: 'dashboard tab' },
    })
    expect(screen.getByText('third-party')).toBeTruthy()
    expect(screen.queryByText('bundled-off')).toBeNull()
  })

  it('groups Hub rows into SwitchUI, Internal, and Plugins Hub without exposing raw provenance as taxonomy', async () => {
    await loadHub()

    const switchUi = screen.getByText('hermes-switch-ui').closest('article')
    const internal = screen.getByText('bundled-on').closest('article')
    const hub = screen.getByText('third-party').closest('article')
    expect(within(switchUi!).getByText('SwitchUI')).toBeTruthy()
    expect(within(internal!).getByText('Internal')).toBeTruthy()
    expect(within(hub!).getByText('Plugins Hub')).toBeTruthy()

    expect(screen.getByRole('button', { name: /Plugins Hub 2/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Internal 2/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /SwitchUI 1/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /SwitchUI 1/i }))
    expect(screen.getByText('hermes-switch-ui')).toBeTruthy()
    expect(screen.queryByText('bundled-on')).toBeNull()
    expect(screen.queryByText('third-party')).toBeNull()
  })

  it('gates enable actions to bundled inactive rows and gives every non-enabled third party a CLI handoff', async () => {
    await loadHub()

    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy()
    expect(screen.getAllByText('Activate in Hermes CLI:')).toHaveLength(2)
    expect(screen.getByText('hermes plugins enable third-party')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Enable' })).toHaveLength(1)
    const mystery = screen.getByText('mystery').closest('article')
    expect(
      within(mystery!).getByText('hermes plugins enable mystery'),
    ).toBeTruthy()
    expect(within(mystery!).queryByRole('button')).toBeNull()
  })

  it('offers Update and Dashboard visibility only when the Hub capability fields allow them', async () => {
    await loadHub()

    const thirdParty = screen.getByText('third-party').closest('article')
    const bundled = screen.getByText('bundled-on').closest('article')
    expect(
      within(thirdParty!).getByRole('button', { name: 'Update' }),
    ).toBeTruthy()
    expect(
      within(thirdParty!).getByRole('button', { name: 'Show in Dashboard' }),
    ).toBeTruthy()
    expect(
      within(bundled!).queryByRole('button', { name: 'Update' }),
    ).toBeNull()
    expect(
      within(bundled!).queryByRole('button', { name: /Dashboard/ }),
    ).toBeNull()
  })

  it('confirms delete, refreshes the Hub, and gives the restart/session warning', async () => {
    mocks.deleteAgentPlugin.mockResolvedValue(undefined)
    await loadHub()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(mocks.deleteAgentPlugin.mock.calls[0]?.[0]).toBe('third-party'),
    )
    await waitFor(() =>
      expect(
        screen.getByText(
          /start a new agent session or restart Hermes Dashboard/i,
        ),
      ).toBeTruthy(),
    )
    await waitFor(() =>
      expect(mocks.getPluginsHub.mock.calls.length).toBeGreaterThan(1),
    )
  })

  it('confirms installs and relies on the client helper for force:false and enable:false', async () => {
    mocks.installAgentPlugin.mockResolvedValue({
      warnings: ['ignore backend detail'],
      missing_env: ['SECRET_TOKEN'],
    })
    await loadHub()

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Plugin identifier' }),
      {
        target: { value: 'owner/plugin' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Install plugin' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))

    await waitFor(() =>
      expect(mocks.installAgentPlugin.mock.calls[0]?.[0]).toEqual({
        identifier: 'owner/plugin',
      }),
    )
    expect(
      screen.getByText(/Activate third-party plugins in Hermes CLI/i),
    ).toBeTruthy()
    expect(screen.queryByText('SECRET_TOKEN')).toBeNull()
    expect(screen.queryByText('ignore backend detail')).toBeNull()
  })

  it('redacts raw mutation errors to a fixed action-level message', async () => {
    mocks.deleteAgentPlugin.mockRejectedValue(
      new Error('/Users/me/.hermes/plugins?token=super-secret'),
    )
    await loadHub()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        'Unable to remove plugin. Check Hermes Dashboard logs.',
        { type: 'error' },
      ),
    )
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.stringContaining('super-secret'),
      expect.anything(),
    )
  })

  it('redacts hostile install failures to the fixed install message', async () => {
    mocks.installAgentPlugin.mockRejectedValue(
      new Error(
        '/Users/me/.hermes/plugins?identifier=owner%2Fprivate&token=super-secret',
      ),
    )
    await loadHub()

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Plugin identifier' }),
      { target: { value: 'owner/private' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Install plugin' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        'Unable to install plugin. Check Hermes Dashboard logs.',
        { type: 'error' },
      ),
    )
    expect(document.body.textContent).not.toContain('super-secret')
    expect(document.body.textContent).not.toContain('/Users/me/.hermes')
  })
})
