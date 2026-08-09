// @vitest-environment jsdom
/**
 * onboarding-contract.test.tsx — the properties of the onboarding surface that
 * must survive a restructure of the step model.
 *
 * Written deliberately *before* the W6 rebuild and deliberately free of any
 * assertion about which steps exist, what they are called, or what order they
 * come in. Everything asserted here is a contract with something outside this
 * screen — `__root.tsx`, the sidebar relaunch, localStorage, or the user's
 * config on disk — and is therefore not the step model's to change:
 *
 *   1. mount/gating semantics (uncontrolled self-gate, controlled relaunch)
 *   2. dismissal is not completion, and completion is not silently stamped
 *   3. a relaunch writes nothing until a labelled write control is pressed
 *   4. nothing secret ever reaches localStorage
 *   5. the deep link the sidebar/dashboard/palette pass through actually lands
 *
 * `onboarding-flow.test.tsx` covers the step model itself, and is expected to
 * be rewritten whenever that model changes. This file is not.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    authError: false,
  },
  gateway: { available: true, authError: false, url: 'http://127.0.0.1:8642' },
  dashboard: { available: true },
  claudeUrl: 'http://127.0.0.1:8642',
  scope: { mode: 'single', servedProfiles: [], servingProfile: 'default' },
}

const CONFIGURED = {
  activeModel: 'manifest/glm-4.6',
  activeProvider: 'manifest',
  providers: [{ id: 'manifest', name: 'Interstellar', configured: true }],
  config: {},
}

vi.mock('@/lib/hermes-client', () => ({
  enableAgentPlugin: () => Promise.resolve({}),
  disableAgentPlugin: () => Promise.resolve({}),
  getPluginsHub: () => Promise.resolve({ plugins: [] }),
}))

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return Promise.resolve({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response)
}

function installFetchMock(config: unknown = CONFIGURED) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/claude-config') && method === 'GET') {
      return jsonResponse(config)
    }
    if (url.startsWith('/api/gateway-status'))
      return jsonResponse(GATEWAY_STATUS)
    if (url.startsWith('/api/agent-version'))
      return jsonResponse({ version: '2.5.0' })
    if (url.startsWith('/api/auth-check')) {
      return jsonResponse({ authenticated: true, authRequired: false })
    }
    if (url.startsWith('/api/credentials')) {
      return jsonResponse({
        ok: true,
        statuses: [],
        unreachable: [],
        degraded: false,
      })
    }
    if (url.startsWith('/api/agent-cwd')) {
      return jsonResponse({
        ok: true,
        resolved: {
          path: '/home/tester',
          source: 'home-sentinel',
          backend: 'local',
          profile: 'default',
          warnings: [],
        },
        activeProfile: 'default',
        editable: true,
        suggestedCwd: '/home/tester/code',
        homeDir: '/home/tester',
        configuredCwd: '',
        hasTerminalBlock: false,
        launch: { multiplex: false, launchProfile: 'default', reachable: true },
      })
    }
    if (url.startsWith('/api/models')) {
      return jsonResponse({
        configuredProviders: ['manifest'],
        models: [{ id: 'glm-4.6', provider: 'manifest' }],
      })
    }
    return jsonResponse({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Every request that could mutate config on disk. */
function writeCalls(fetchMock: ReturnType<typeof installFetchMock>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET') return false
    const url = String(input)
    return (
      url.startsWith('/api/claude-config') ||
      url.startsWith('/api/credentials') ||
      (url.startsWith('/api/agent-cwd') && init?.body !== undefined
        ? !String(init.body).includes('"dryRun":true')
        : url.startsWith('/api/agent-cwd'))
    )
  })
}

function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Any control the wizard offers that moves the user forward. */
function railButtons(): Array<HTMLElement> {
  return screen.queryAllByRole('button', { name: /^Step \d+ of \d+: / })
}

describe('onboarding surface contract', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // ── 1. mount / gating ─────────────────────────────────────────────────────

  it('renders nothing uncontrolled once the legacy completion flag is set', () => {
    installFetchMock()
    localStorage.setItem(ONBOARDING_KEYS.complete, 'true')
    const { container } = renderScreen(<OnboardingScreen />)
    expect(container.firstChild).toBeNull()
  })

  it('renders on a fresh install with no completion flag', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen />)
    expect(await screen.findByTestId('wizard-onboarding')).toBeTruthy()
  })

  it('renders nothing when the controlled prop is false', () => {
    installFetchMock()
    const { container } = renderScreen(
      <OnboardingScreen open={false} onClose={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders when opened controlled even though onboarding is complete', async () => {
    installFetchMock()
    localStorage.setItem(ONBOARDING_KEYS.complete, 'true')
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    expect(await screen.findByTestId('wizard-onboarding')).toBeTruthy()
  })

  // ── 2. dismissal semantics ────────────────────────────────────────────────

  it('is Escape-dismissible on a relaunch and never on first run', async () => {
    installFetchMock()
    const onClose = vi.fn()
    const relaunch = renderScreen(<OnboardingScreen open onClose={onClose} />)
    fireEvent.keyDown(await screen.findByTestId('wizard-onboarding'), {
      key: 'Escape',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    relaunch.unmount()

    renderScreen(<OnboardingScreen />)
    const surface = await screen.findByTestId('wizard-onboarding')
    fireEvent.keyDown(surface, { key: 'Escape' })
    expect(screen.getByTestId('wizard-onboarding')).toBeTruthy()
  })

  it('closes a relaunch without disturbing the completion flag', async () => {
    installFetchMock()
    localStorage.setItem(ONBOARDING_KEYS.complete, 'true')
    const onClose = vi.fn()
    renderScreen(<OnboardingScreen open onClose={onClose} />)

    fireEvent.click(await screen.findByLabelText('Close setup wizard'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(ONBOARDING_KEYS.complete)).toBe('true')
  })

  it('offers a first-run escape that records a dismissal, not a completion', async () => {
    installFetchMock({
      activeProvider: '',
      activeModel: '',
      providers: [],
      config: {},
    })
    const onClose = vi.fn()
    renderScreen(<OnboardingScreen onClose={onClose} />)

    const later = await screen.findByRole('button', {
      name: /set this up later/i,
    })
    fireEvent.click(later)

    expect(onClose).toHaveBeenCalled()
    expect(localStorage.getItem(ONBOARDING_KEYS.complete)).not.toBe('true')
    expect(localStorage.getItem(ONBOARDING_KEYS.dismissed)).toBeTruthy()
  })

  // ── 3. a relaunch writes nothing on its own ───────────────────────────────

  it('issues no config write while the user only navigates a relaunch', async () => {
    const fetchMock = installFetchMock()
    localStorage.setItem(ONBOARDING_KEYS.complete, 'true')
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    await screen.findByRole('button', { current: 'step' })

    for (const button of railButtons()) fireEvent.click(button)
    const next = screen.queryByRole('button', { name: 'Next' })
    if (next) fireEvent.click(next)

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0))
    expect(writeCalls(fetchMock)).toHaveLength(0)
  })

  // ── 4. nothing secret reaches localStorage ────────────────────────────────

  it('never persists a typed API key into the draft', async () => {
    installFetchMock({
      activeProvider: '',
      activeModel: '',
      providers: [],
      config: {},
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen(<OnboardingScreen />)

      // Reach whichever step owns the credential field, without asserting how
      // many steps are in front of it.
      let picked = false
      for (let hop = 0; hop < 10; hop += 1) {
        if (screen.queryByLabelText(/API key/i)) break
        const quick = screen.queryByRole('button', {
          name: /Quick start|Get started/i,
        })
        if (quick) {
          fireEvent.click(quick)
          await Promise.resolve()
          continue
        }
        const keyed = screen.queryAllByRole('button', { name: /^OpenRouter/ })
        if (keyed.length > 0 && !picked) {
          picked = true
          fireEvent.click(keyed[0])
          await Promise.resolve()
          continue
        }
        const next = screen.queryByRole('button', { name: 'Next' })
        if (!next) break
        fireEvent.click(next)
        await Promise.resolve()
      }

      const field = await screen.findByLabelText(/API key/i)
      fireEvent.change(field, { target: { value: 'sk-super-secret-value' } })
      vi.advanceTimersByTime(2000)

      const raw = JSON.stringify(localStorage)
      expect(raw).not.toContain('sk-super-secret-value')
    } finally {
      vi.useRealTimers()
    }
  })

  // ── 5. the deep link the rest of the app passes through ───────────────────

  it('honours an initialStepId deep link to the provider step', async () => {
    installFetchMock()
    localStorage.setItem(ONBOARDING_KEYS.complete, 'true')
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="provider" />,
    )

    const current = await screen.findByRole('button', { current: 'step' })
    expect(current.textContent).toContain('Provider')
  })
})
