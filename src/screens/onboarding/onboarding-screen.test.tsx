// @vitest-environment jsdom
/**
 * The three things the composition itself has to get right — everything else
 * is covered by the unit tests under `lib/` and by the relaunch contracts.
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
import type { ReactElement } from 'react'

const FRESH_CONFIG = {
  activeModel: '',
  activeProvider: '',
  providers: [],
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
    if (
      url.startsWith('/api/claude-config') &&
      (init?.method ?? 'GET') === 'GET'
    ) {
      return jsonResponse(FRESH_CONFIG)
    }
    return jsonResponse({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

async function startQuickFlow() {
  fireEvent.click(await screen.findByRole('button', { name: /Quick start/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Ollama/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByLabelText('Default model')
}

describe('OnboardingScreen', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('reaches verify from a provider selection on the quick branch', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen />)

    await startQuickFlow()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByText('~/.hermes/config.yaml')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Saved\./)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(
      await screen.findByRole('button', { name: 'Verify connection' }),
    ).toBeTruthy()
  })

  it('marks the current rail step and counts only the quick branch', async () => {
    installFetchMock()
    renderScreen(<OnboardingScreen />)

    await startQuickFlow()

    // welcome and finish are chromeless, and the three full-only steps are
    // branched out: provider, connect, review, verify.
    await waitFor(() => expect(screen.getByText('Step 2 of 4')).toBeTruthy())
    const current = screen.getByRole('button', { current: 'step' })
    expect(current.textContent).toContain('Connect')
  })

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
})
