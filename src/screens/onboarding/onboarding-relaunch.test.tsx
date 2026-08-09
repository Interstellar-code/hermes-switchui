// @vitest-environment jsdom
/**
 * Ported verbatim in intent from `claude-onboarding.relaunch.test.tsx`: the
 * six contracts that make the sidebar's "Setup Wizard" entry safe to click on
 * a working install. The wizard underneath changed completely; what must not
 * change is that a relaunch writes nothing until the user says so.
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
      return jsonResponse({ data: [{ id: 'llama3', provider: 'ollama' }] })
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

function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
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
    localStorage.clear()
  })

  it('renders when open even though onboarding is already complete', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)
    expect(await screen.findByTestId('wizard-onboarding')).toBeTruthy()
    expect(screen.getByText('Change setup')).toBeTruthy()
  })

  it('stays hidden when the controlled prop is false', () => {
    installFetchMock()
    const { container } = renderScreen(
      <OnboardingScreen open={false} onClose={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('does not write provider config while the existing setup is locked', async () => {
    const fetchMock = installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)

    // Enter the flow from the summary's checklist — navigation, not a write.
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open: Verify the connection',
      }),
    )
    const back = await screen.findByRole('button', { name: 'Back' })
    fireEvent.click(back)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await walkProviderToReview()

    const save = screen.getByRole('button', { name: 'Save' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(save)

    expect(configWrites(fetchMock)).toHaveLength(0)
  })

  it('writes config only after the user unlocks changes', async () => {
    const fetchMock = installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Change setup' }))
    fireEvent.click(await screen.findByRole('button', { name: /Quick start/ }))

    await walkProviderToReview()

    const save = screen.getByRole('button', { name: 'Save' })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() =>
      expect(configWrites(fetchMock).length).toBeGreaterThan(0),
    )
  })

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

  // ── the deep link ────────────────────────────────────────────────────────
  // `__root.tsx` is the only caller and it always passes `open`, so a relaunch
  // that discards `initialStepId` discards it always: the dashboard card's
  // "Open: Pick a theme" link, the sidebar badge, the command palette and the
  // `target` field on `setup-wizard-store` all described behaviour that could
  // not happen. What the deep link must NOT do is imply `unlocked`.

  it('honours a deep link to a step on the full branch', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="theme" />,
    )

    const current = await screen.findByRole('button', { current: 'step' })
    expect(current.textContent).toContain('Theme')
  })

  it('a deep-linked relaunch is still locked', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="theme" />,
    )
    await screen.findByRole('button', { current: 'step' })

    // One step back from theme is plugins, which is where the lock used to
    // leak: `jumpTo` flipped the branch to 'full' without touching `unlocked`,
    // so the step rendered live Enable/Disable buttons and `useCorePlugins`
    // called enableAgentPlugin with no `canWriteConfig` consultation.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByText(/Read-only for this run/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Restart dashboard' }),
    ).toBeNull()
  })

  it('a deep-linked system check offers no self-heal action while locked', async () => {
    installFetchMock()
    renderScreen(
      <OnboardingScreen open onClose={vi.fn()} initialStepId="system-check" />,
    )

    expect(await screen.findByText(/Read-only for this run/)).toBeTruthy()
    // These fire POST /api/start-agent, POST /api/gateway-reprobe and a
    // gateway restart — from a screen that promised a read.
    expect(screen.queryByRole('button', { name: /Start the agent/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull()
  })

  it('does not dead-end the user on the review step while locked', async () => {
    // `review` is not optional and `validateReviewStep` required `ctx.saved`,
    // but Save is disabled and `save()` refuses while locked — so `saved`
    // could never become true. Next was permanently blocked with "Press Save
    // to write the configuration" and no Skip was offered.
    installFetchMock()
    renderScreen(<OnboardingScreen open onClose={vi.fn()} />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open: Verify the connection',
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await walkProviderToReview()
    const save = screen.getByRole('button', { name: 'Save' })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(
      await screen.findByRole('button', { name: 'Verify connection' }),
    ).toBeTruthy()
    expect(
      screen.queryByText(/Press Save to write the configuration/),
    ).toBeNull()
  })
})
