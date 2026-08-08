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
})
