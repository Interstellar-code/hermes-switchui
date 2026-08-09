// @vitest-environment jsdom
/**
 * onboarding-flow.test.tsx — the step model itself.
 *
 * Everything asserted here is a property of the four-step flow and is expected
 * to change if the flow does. The properties that must survive *any*
 * restructure — mount gating, dismissal semantics, "a relaunch writes nothing
 * on its own", no secrets in localStorage, deep links — live in
 * `onboarding-contract.test.tsx` and are deliberately not repeated.
 *
 * What is pinned:
 *   - the rail is exactly the four required steps, in the docs' order
 *   - nothing optional is offered until the chat gate is settled
 *   - the gate blocks Next, and the skip escape is specific about what breaks
 *   - a provider verification failure shows the gateway's verbatim error
 *   - the Ollama context window is warned about *before* the first chat
 *   - the gateway's own `onboarding.seen` suppresses a duplicate prompt
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

vi.mock('@/lib/hermes-client', () => ({
  enableAgentPlugin: () => Promise.resolve({}),
  disableAgentPlugin: () => Promise.resolve({}),
  getPluginsHub: () => Promise.resolve({ plugins: [] }),
}))

const GATEWAY_STATUS = {
  capabilities: {
    health: true,
    chatCompletions: true,
    models: true,
    authError: false,
  },
  gateway: { available: true, authError: false, url: 'http://127.0.0.1:8642' },
  dashboard: { available: true },
  claudeUrl: 'http://127.0.0.1:8642',
  scope: { mode: 'single', servingProfile: 'default' },
}

const AGENT_CWD = {
  ok: true,
  resolved: {
    path: '/home/tester',
    source: 'home-sentinel',
    backend: 'local',
    profile: 'default',
    warnings: [],
  },
  activeProfile: 'default',
  configuredCwd: '',
  hasTerminalBlock: false,
  editable: true,
  suggestedCwd: '/home/tester/code',
  homeDir: '/home/tester',
  launch: { multiplex: false, launchProfile: 'default', reachable: true },
}

const CONFIGURED = {
  activeModel: 'ollama/llama3',
  activeProvider: 'ollama',
  providers: [{ id: 'ollama', configured: true }],
  config: {},
}

const FRESH = {
  activeModel: '',
  activeProvider: '',
  providers: [],
  config: {},
}

/** An SSE body the parser accepts as a successful completion. */
function chatOk(text: string) {
  return `event: chunk\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: ${JSON.stringify(
    { message: { role: 'assistant', content: [{ type: 'text', text }] } },
  )}\n\n`
}

/** An SSE body carrying the gateway's own error. */
function chatError(message: string) {
  return `event: error\ndata: ${JSON.stringify({ message })}\n\n`
}

type MockOptions = {
  config?: unknown
  /** Body returned by `/api/send-stream`. */
  chat?: string
  ollamaOnline?: boolean
}

function installFetchMock(options: MockOptions = {}) {
  const { config = CONFIGURED, chat = chatOk('Yes, I can hear you.') } = options

  const json = (body: unknown, init?: { ok?: boolean; status?: number }) =>
    Promise.resolve({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response)

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.startsWith('/api/send-stream')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(chat),
      } as Response)
    }
    if (url.startsWith('/api/claude-config') && method === 'GET') {
      return json(config)
    }
    if (url.startsWith('/api/claude-config')) return json({ ok: true })
    if (url.startsWith('/api/gateway-status')) return json(GATEWAY_STATUS)
    if (url.startsWith('/api/agent-version')) return json({ version: '2.5.34' })
    if (url.startsWith('/api/auth-check')) {
      return json({ authenticated: true, authRequired: true })
    }
    if (url.startsWith('/api/credentials')) {
      return json({ ok: true, statuses: [], unreachable: [], degraded: false })
    }
    if (url.startsWith('/api/agent-cwd')) return json(AGENT_CWD)
    if (url.startsWith('/api/local-providers')) {
      return json({
        providers: [{ id: 'ollama', online: options.ollamaOnline ?? true }],
      })
    }
    if (url.startsWith('/api/models')) {
      return json({
        configuredProviders: ['ollama'],
        models: [{ id: 'llama3', provider: 'ollama' }],
      })
    }
    return json({ ok: true })
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

function relaunch(initialStepId?: string) {
  localStorage.setItem(ONBOARDING_KEYS.complete, 'true')
  return renderScreen(
    <OnboardingScreen
      open
      onClose={vi.fn()}
      initialStepId={initialStepId as never}
    />,
  )
}

describe('the four-step rail', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('is exactly connect, provider, workspace, first chat on a first run', async () => {
    installFetchMock({ config: FRESH })
    renderScreen(<OnboardingScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Get started' }))
    await screen.findByRole('button', { current: 'step' })

    expect(railLabels()).toEqual([
      'Connect',
      'Provider',
      'Workspace',
      'First chat',
    ])
  })

  it('opens a relaunch on Connect rather than a landing page', async () => {
    installFetchMock()
    relaunch()
    const current = await screen.findByRole('button', { current: 'step' })
    expect(current.textContent).toContain('Connect')
  })

  it('maps a retired deep link onto the step that took over its job', async () => {
    // `openSetupWizard('verify')` is still a live call site somewhere in a
    // shortcut or a saved link; it must land on Provider, not the front door.
    installFetchMock()
    relaunch('verify')
    const current = await screen.findByRole('button', { current: 'step' })
    expect(current.textContent).toContain('Provider')
  })

  it('names all three trust boundaries on the Connect step', async () => {
    installFetchMock()
    relaunch()
    expect(await screen.findByText(/Browser → Switch UI/)).toBeTruthy()
    expect(screen.getByText(/Switch UI → Hermes gateway/)).toBeTruthy()
    expect(screen.getByText(/Hermes gateway → model provider/)).toBeTruthy()
  })

  it('reports a 401 as a token mismatch, not as a dead gateway', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.startsWith('/api/gateway-status')
        ? {
            ...GATEWAY_STATUS,
            capabilities: { ...GATEWAY_STATUS.capabilities, authError: true },
            gateway: {
              available: false,
              authError: true,
              url: 'http://127.0.0.1:8642',
            },
          }
        : url.startsWith('/api/claude-config')
          ? CONFIGURED
          : url.startsWith('/api/agent-cwd')
            ? AGENT_CWD
            : { ok: true }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)
    relaunch()

    expect(await screen.findByText(/401 Unauthorized/)).toBeTruthy()
    expect(screen.getByText(/token mismatch, not an outage/)).toBeTruthy()
    expect(screen.getByText(/Restarting will not fix it/)).toBeTruthy()
  })
})

describe('the chat gate', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('offers nothing optional until the gate is settled', async () => {
    installFetchMock({ config: FRESH })
    // First run, so the relaunch concession does not apply.
    renderScreen(<OnboardingScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Get started' }))
    await screen.findByRole('button', { current: 'step' })

    for (const optional of [
      'Extras',
      'Profiles',
      'Memory',
      'Plugins',
      'Theme',
    ]) {
      expect(railLabels(), optional).not.toContain(optional)
    }
  })

  it('blocks Next until a real completion has succeeded', async () => {
    installFetchMock()
    relaunch('chat')
    await screen.findByRole('button', { name: 'Send first message' })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/Send one real message first/)).toBeTruthy()
    // Still on the chat step.
    expect(
      screen.getByRole('button', { current: 'step' }).textContent,
    ).toContain('First chat')
  })

  it('lets Next through once the completion has succeeded', async () => {
    installFetchMock({ chat: chatOk('Hello.') })
    relaunch('chat')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Send first message' }),
    )
    await screen.findByText(/Hello\./)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { current: 'step' }).textContent,
      ).toContain('Extras'),
    )
  })

  it('opens the optional band once a completion succeeds, and shows the reply', async () => {
    installFetchMock({ chat: chatOk('Yes, I can hear you.') })
    relaunch('chat')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Send first message' }),
    )

    expect(await screen.findByText(/Yes, I can hear you\./)).toBeTruthy()
  })

  it("shows the gateway's verbatim error when the completion fails", async () => {
    installFetchMock({
      chat: chatError('401 invalid_api_key from api.example.com'),
    })
    relaunch('chat')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Send first message' }),
    )

    expect(
      await screen.findByText('401 invalid_api_key from api.example.com'),
    ).toBeTruthy()
    // And it recognises the shape as a credential problem rather than an outage.
    expect(screen.getByText(/reads as a credential problem/)).toBeTruthy()
  })

  it('gates the skip behind a warning that names what actually breaks', async () => {
    installFetchMock({ config: FRESH, chat: chatError('connection refused') })
    relaunch('chat')
    await screen.findByRole('button', { name: 'Send first message' })

    // The escape is two presses, and the first one only reveals the cost.
    expect(screen.queryByRole('button', { name: 'Continue anyway' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Skip this check' }))

    expect(
      screen.getByText(/No provider is active, so the very first message/),
    ).toBeTruthy()
    expect(screen.getByText(/Memory writes happen during a turn/)).toBeTruthy()
    expect(
      screen.getByText(/Skills, MCP servers and scheduled jobs/),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }))

    await screen.findByText(
      /Skipped\. Nothing has proved this agent can answer/,
    )
    // And Next now moves, where a moment ago it refused.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { current: 'step' }).textContent,
      ).toContain('Extras'),
    )
  })
})

describe('provider verification', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('writes config only when Save is pressed, then verifies with a real call', async () => {
    const fetchMock = installFetchMock({ config: FRESH })
    relaunch('provider')

    fireEvent.click(await screen.findByRole('button', { name: /^Ollama/ }))
    const writesBefore = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).startsWith('/api/claude-config') &&
        (init?.method ?? 'GET') !== 'GET',
    )
    expect(writesBefore).toHaveLength(0)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Save and verify' }),
    )

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input).startsWith('/api/claude-config') &&
            (init?.method ?? 'GET') !== 'GET',
        ).length,
      ).toBeGreaterThan(0),
    )
    // A real completion is part of verification, not an opt-in button two
    // steps later — that split is how the wizard used to report success on a
    // provider that 401s on first use.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).startsWith('/api/send-stream'),
        ),
      ).toBe(true),
    )
  })

  it("surfaces the gateway's own words when the verification call fails", async () => {
    installFetchMock({
      config: FRESH,
      chat: chatError('Error code: 401 - invalid x-api-key'),
    })
    relaunch('provider')

    fireEvent.click(await screen.findByRole('button', { name: /^Ollama/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save and verify' }),
    )

    expect(
      await screen.findByText('Error code: 401 - invalid x-api-key'),
    ).toBeTruthy()
    expect(
      screen.getByText(/reads as a credential problem rather than an outage/),
    ).toBeTruthy()
  })

  it('warns about an undersized Ollama context window before the chat is attempted', async () => {
    installFetchMock({
      config: {
        ...FRESH,
        config: {
          providers: {
            ollama: {
              base_url: 'http://127.0.0.1:11434/v1',
              context_length: 8192,
            },
          },
        },
      },
      ollamaOnline: true,
    })
    relaunch('provider')

    fireEvent.click(await screen.findByRole('button', { name: /^Ollama/ }))

    expect(
      await screen.findByText(/Check the context window first/),
    ).toBeTruthy()
    expect(screen.getByText(/8,192 tokens, below the 64,000/)).toBeTruthy()
  })
})

describe('the workspace question', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('states where the agent actually runs, and why', async () => {
    installFetchMock()
    relaunch('workspace')

    expect(
      (await screen.findAllByText(/\/home\/tester/)).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/your home directory, because terminal.cwd is unset/)
        .length,
    ).toBeGreaterThan(0)
    expect(screen.getByText(/Nothing has set a working directory/)).toBeTruthy()
  })

  it('previews before it writes', async () => {
    const fetchMock = installFetchMock()
    relaunch('workspace')

    const field = await screen.findByLabelText('Working directory')
    fireEvent.change(field, { target: { value: '/srv/project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview change' }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).startsWith('/api/agent-cwd') &&
            String(init?.body ?? '').includes('"dryRun":true'),
        ),
      ).toBe(true),
    )
    // Nothing has been written: the only POST so far was the dry run.
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).startsWith('/api/agent-cwd') &&
          (init?.method ?? 'GET') === 'POST' &&
          !String(init?.body ?? '').includes('"dryRun":true'),
      ),
    ).toHaveLength(0)
  })
})

describe('gateway onboarding state', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('does not re-pitch a prompt the agent has already made in conversation', async () => {
    installFetchMock({
      config: {
        ...CONFIGURED,
        config: { onboarding: { seen: { profile_build_offered: true } } },
      },
    })
    relaunch('extras')

    expect(
      await screen.findByText(
        /The agent has already offered to build your profile in conversation\./,
      ),
    ).toBeTruthy()
  })

  it('offers the memory card normally when the gateway has not made that offer', async () => {
    installFetchMock({ config: CONFIGURED })
    relaunch('extras')

    await screen.findByText(/Without a memory provider the agent starts/)
    expect(
      screen.queryByText(/already offered to build your profile/),
    ).toBeNull()
  })
})
