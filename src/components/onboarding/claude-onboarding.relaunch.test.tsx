// @vitest-environment jsdom
/**
 * Guards the contract that makes the sidebar "Setup Wizard" entry safe:
 * a relaunched wizard (controlled `open` prop) must never write provider
 * config until the user explicitly unlocks changes.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaudeOnboarding, ONBOARDING_KEY } from './claude-onboarding'

const GATEWAY_STATUS = {
  capabilities: {
    health: true,
    chatCompletions: true,
    models: true,
    streaming: true,
    sessions: true,
    config: true,
  },
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
      return jsonResponse({ data: [{ id: 'glm-4.6' }] })
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

/** welcome → connect → provider */
async function advanceToProviderStep() {
  fireEvent.click(screen.getByText('Connect Backend'))
  const continueButton = await screen.findByText<HTMLButtonElement>('Continue')
  await waitFor(() => expect(continueButton.disabled).toBe(false))
  fireEvent.click(continueButton)
  await screen.findByText('Choose Provider and Model')
}

describe('ClaudeOnboarding relaunch mode', () => {
  beforeEach(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders when open even though onboarding is already complete', async () => {
    installFetchMock()
    render(<ClaudeOnboarding open onClose={vi.fn()} />)
    expect(await screen.findByText('Setup Wizard')).toBeTruthy()
  })

  it('stays hidden when the controlled prop is false', () => {
    installFetchMock()
    const { container } = render(
      <ClaudeOnboarding open={false} onClose={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('does not write provider config while the existing setup is locked', async () => {
    const fetchMock = installFetchMock()
    render(<ClaudeOnboarding open onClose={vi.fn()} />)

    await advanceToProviderStep()
    expect(screen.getByText('Existing configuration is protected')).toBeTruthy()

    fireEvent.click(screen.getByText('Continue →'))
    await screen.findByText('Test Chat')

    expect(configWrites(fetchMock)).toHaveLength(0)
  })

  it('writes config only after the user unlocks changes', async () => {
    const fetchMock = installFetchMock()
    render(<ClaudeOnboarding open onClose={vi.fn()} />)

    await advanceToProviderStep()
    fireEvent.click(screen.getByText('Unlock and allow changes'))
    await waitFor(() =>
      expect(
        screen.queryByText('Existing configuration is protected'),
      ).toBeNull(),
    )

    fireEvent.click(screen.getByText('Continue →'))
    await screen.findByText('Test Chat')

    await waitFor(() =>
      expect(configWrites(fetchMock).length).toBeGreaterThan(0),
    )
  })

  it('closes via onClose without clearing the completion flag', async () => {
    installFetchMock()
    const onClose = vi.fn()
    render(<ClaudeOnboarding open onClose={onClose} />)

    fireEvent.click(await screen.findByLabelText('Close setup wizard'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('true')
  })

  it('self-gates on localStorage when uncontrolled (first-run behaviour)', () => {
    installFetchMock()
    const { container } = render(<ClaudeOnboarding />)
    expect(container.firstChild).toBeNull()
  })
})
