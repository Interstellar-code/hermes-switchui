// @vitest-environment jsdom
/**
 * The contracts that make the sidebar's "Setup Wizard" entry safe to click on
 * a working install.
 *
 * The shape of that safety changed. It used to be a lock: a relaunch opened on
 * a read-only summary and could not write until the user pressed "Change
 * setup". That bought nothing the flow did not already guarantee — every write
 * in this wizard is behind an explicit press on a labelled control (Save,
 * Activate, Enable, Use, Restart), and a click-through of Next writes nothing —
 * while costing a returning user the ability to toggle a plugin or fix a
 * provider without a ceremony first. So the default flipped, and what is
 * asserted here is the guarantee that was always the real one: **a relaunch
 * writes nothing until the user presses a write control.**
 *
 * The lock itself is not gone and is not untested — `relaunch-lock.test.ts`
 * pins `canWriteConfig` across the full mode × step × unlocked matrix, and
 * pins that every mutating hook refuses when handed `canWrite: false`.
 *
 * "No writes" is asserted as "no PATCH to /api/claude-config was issued at
 * all", not as "the request failed" — a request that reaches the server and
 * is rejected there is a different, weaker guarantee.
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

import { OnboardingScreen } from './onboarding-screen'
import { ONBOARDING_KEYS } from './lib/onboarding-storage'
import type { ReactElement } from 'react'

const GATEWAY_STATUS = {
  capabilities: {
    health: true,
    chatCompletions: true,
    models: true,
    streaming: true,
    sessions: true,
    config: true,
  },
  dashboard: { available: false },
  claudeUrl: 'http://127.0.0.1:8642',
}

const CURRENT_CONFIG = {
  activeModel: 'manifest/glm-4.6',
  activeProvider: 'manifest',
  providers: [{ id: 'manifest', name: 'Interstellar', configured: true }],
}

// `useCorePlugins` reads the hub through the browser-safe client, not fetch,
// so the plugins step needs this to render real rows with real controls.
const enableAgentPlugin = vi.fn((_name: string) => Promise.resolve({}))
const disableAgentPlugin = vi.fn((_name: string) => Promise.resolve({}))

vi.mock('@/lib/hermes-client', () => ({
  enableAgentPlugin: (name: string) => enableAgentPlugin(name),
  disableAgentPlugin: (name: string) => disableAgentPlugin(name),
  getPluginsHub: () =>
    Promise.resolve({
      plugins: [
        // `bundled` + a non-enabled runtime status is exactly the combination
        // `buildCorePluginRows` turns into an `enable` action.
        { name: 'personas', source: 'bundled', runtimeStatus: 'disabled' },
        { name: 'mcp_lazy', source: 'bundled', runtimeStatus: 'enabled' },
      ],
    }),
}))

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response)
}

function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/claude-config') && method === 'GET') {
      return jsonResponse(CURRENT_CONFIG)
    }
    if (url.startsWith('/api/claude-config')) {
      return jsonResponse({ ok: true })
    }
    if (url.startsWith('/api/gateway-status')) {
      return jsonResponse(GATEWAY_STATUS)
    }
    if (url.startsWith('/api/models')) {
      return jsonResponse({
        configuredProviders: ['manifest'],
        models: [{ id: 'glm-4.6', provider: 'manifest' }],
      })
    }
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function configWrites(fetchMock: ReturnType<typeof installFetchMock>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).startsWith('/api/claude-config') &&
      (init?.method ?? 'GET') !== 'GET',
  )
}

function modelReads(fetchMock: ReturnType<typeof installFetchMock>) {
  return fetchMock.mock.calls.filter(([input]) =>
    String(input).startsWith('/api/models'),
  )
}

function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** The rail step buttons, in order, by their visible label. */
function railLabels(): Array<string> {
  return screen
    .getAllByRole('button', { name: /^Step \d+ of \d+: / })
    .map((button) => button.textContent.replace(/^\d+|✓/, '').trim())
}

function railButton(label: string): HTMLButtonElement {
  return screen.getByRole('button', {
    name: new RegExp(`^Step \\d+ of \\d+: ${label}`),
  })
}

/** provider → connect → review, from the provider step. */
async function walkProviderToReview() {
  fireEvent.click(await screen.findByRole('button', { name: /Ollama/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByLabelText('Default model')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('~/.hermes/config.yaml')
}

describe('OnboardingScreen relaunch mode', () => {
  beforeEach(() => {
    localStorage.setItem(ONBOARDING_KEYS.complete, 'true')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    enableAgentPlugin.mockClear()
    disableAgentPlugin.mockClear()
    localStorage.clear()
  })

  it('renders when open even though onboarding is already complete', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    expect(await screen.findByTestId('wizard-onboarding')).toBeTruthy()
  })

  it('stays hidden when the controlled prop is false', () => {
    installFetchMock()
    const { container } = renderScreen(
      <OnboardingScreen open={false} onClose={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  // ── where a relaunch lands ───────────────────────────────────────────────

  it('opens on the stepped system-check view, not the summary', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)

    const current = await screen.findByRole('button', { current: 'step' })
    expect(current.textContent).toContain('System')
    // The summary's own controls are nowhere on screen.
    expect(screen.queryByRole('button', { name: 'Change setup' })).toBeNull()
  })

  it('shows the full rail on open, minus review while nothing is dirty', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    await screen.findByRole('button', { current: 'step' })

    expect(railLabels()).toEqual([
      'System',
      'Provider',
      'Connect',
      'Verify',
      'Agent',
      'Memory',
      'Plugins',
      'Theme',
    ])
  })

  it('is still deep-linkable to the summary, which stays in the table', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="summary" />,
    )
    expect(await screen.findByText('Change setup')).toBeTruthy()
  })

  // ── free navigation ──────────────────────────────────────────────────────

  it('makes every rail step clickable from the first one', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    await screen.findByRole('button', { current: 'step' })

    for (const label of railLabels()) {
      expect(railButton(label).disabled, label).toBe(false)
    }

    // Theme is five steps ahead: unreachable under the default
    // visited-plus-one rule, reachable here.
    fireEvent.click(railButton('Theme'))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { current: 'step' }).textContent,
      ).toContain('Theme'),
    )
  })

  // ── the relaunch is unlocked, and the steps say so ───────────────────────

  it('renders live plugin controls instead of a read-only notice', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="plugins" />,
    )

    expect(await screen.findByRole('button', { name: 'Enable' })).toBeTruthy()
    expect(screen.queryByText(/Read-only for this run/)).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Enable' })[0])
    await waitFor(() => expect(enableAgentPlugin).toHaveBeenCalled())
  })

  it('offers the system check self-heal actions', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="system-check" />,
    )
    await screen.findByRole('button', { current: 'step' })
    expect(screen.queryByText(/Read-only for this run/)).toBeNull()
  })

  // ── but it still writes nothing on its own ───────────────────────────────

  it('writes no config while the user only navigates', async () => {
    const fetchMock = installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    await screen.findByRole('button', { current: 'step' })

    // A full click-through of the rail: every step visited, nothing pressed
    // that is labelled as a write.
    for (const label of railLabels()) {
      fireEvent.click(railButton(label))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(configWrites(fetchMock)).toHaveLength(0)
  })

  it('writes config only when the user presses Save on the review step', async () => {
    const fetchMock = installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    await screen.findByRole('button', { current: 'step' })

    fireEvent.click(railButton('Provider'))
    await walkProviderToReview()

    expect(configWrites(fetchMock)).toHaveLength(0)

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.click(save)

    await waitFor(() =>
      expect(configWrites(fetchMock).length).toBeGreaterThan(0),
    )
  })

  // ── the conditional review step ──────────────────────────────────────────

  it('adds the review step to the rail once the draft is dirty', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    await screen.findByRole('button', { current: 'step' })

    expect(railLabels()).not.toContain('Review')

    fireEvent.click(railButton('Provider'))
    fireEvent.click(await screen.findByRole('button', { name: /Ollama/ }))

    await waitFor(() => expect(railLabels()).toContain('Review'))
    expect(railLabels()).toEqual([
      'System',
      'Provider',
      'Connect',
      'Review',
      'Verify',
      'Agent',
      'Memory',
      'Plugins',
      'Theme',
    ])
  })

  it('hops the absent review step in both directions', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="connect" />,
    )
    await screen.findByRole('button', { current: 'step' })

    // Connect → Next lands on Verify, not on a review step that is not there,
    // and nothing blocks with "Press Save to write the configuration".
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(
      await screen.findByRole('button', { name: 'Verify connection' }),
    ).toBeTruthy()
    expect(
      screen.queryByText(/Press Save to write the configuration/),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { current: 'step' }).textContent,
      ).toContain('Connect'),
    )
  })

  // ── verify actually verifies ─────────────────────────────────────────────

  it('verifies the configured provider when the draft has none', async () => {
    // The relaunch draft starts empty — nothing has been picked because
    // nothing needed picking. `onVerify` used to be `if (draft.providerId)`,
    // so on a configured install the button silently did nothing at all.
    const fetchMock = installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="verify" />,
    )

    const verify = await screen.findByRole('button', {
      name: 'Verify connection',
    })
    const before = modelReads(fetchMock).length
    fireEvent.click(verify)

    await waitFor(() =>
      expect(modelReads(fetchMock).length).toBeGreaterThan(before),
    )
    // The poll resolves rather than timing out, which it can only do because
    // it was handed `manifest` — CURRENT_CONFIG.activeProvider, the one
    // provider the mocked /api/models reports models for. With the old
    // `if (draft.providerId)` guard no request left at all.
    expect(
      await screen.findByText(/The gateway lists 1 model for this provider/),
    ).toBeTruthy()
  })

  it('explains itself instead of offering a dead button with no provider at all', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/claude-config')) {
        return jsonResponse({
          activeProvider: '',
          activeModel: '',
          providers: [],
        })
      }
      if (url.startsWith('/api/gateway-status'))
        return jsonResponse(GATEWAY_STATUS)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="verify" />,
    )

    expect(
      await screen.findByText(/There is no provider to verify yet/),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Verify connection' }),
    ).toBeNull()
  })

  // ── unchanged contracts ──────────────────────────────────────────────────

  it('closes via onClose without clearing the completion flag', async () => {
    installFetchMock()
    const onClose = vi.fn()
    renderScreen(<OnboardingScreen open onClose={onClose} />)

    fireEvent.click(await screen.findByLabelText('Close setup wizard'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(ONBOARDING_KEYS.complete)).toBe('true')
  })

  it('self-gates on localStorage when uncontrolled (first-run behaviour)', () => {
    installFetchMock()
    const { container } = renderScreen(<OnboardingScreen />)
    expect(container.firstChild).toBeNull()
  })

  it('honours a deep link to a step on the full branch', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="theme" />,
    )

    const current = await screen.findByRole('button', { current: 'step' })
    expect(current.textContent).toContain('Theme')
  })
})
