// @vitest-environment jsdom
/**
 * A real first run and a broken install are different situations and must
 * look different. These tests pin exactly that:
 *
 *  - nothing installed  → the original welcome, with Auto-Start
 *  - install broken     → the diagnosis, naming what is actually missing
 *  - gateway running    → NO Auto-Start button, because starting a second
 *                         gateway is the action that made the original screen
 *                         actively misleading
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import {
  ConnectionStartupScreen,
  describeMissingCapabilities,
  shouldOfferAutoStart,
  shouldShowDiagnostics,
} from './connection-startup-screen'

type Diagnostics = Parameters<typeof shouldShowDiagnostics>[0]

const AUTO_START_LABEL = 'Auto-Start Hermes Agent Gateway'
const WELCOME_COPY = /Welcome! Let's connect your backend/

const brokenInstall = {
  severity: 'error' as const,
  gatewayProcessRunning: true,
  missingCapabilities: ['health', 'chatCompletions', 'models', 'streaming'],
  firstRun: false,
  gatewayUrl: 'http://127.0.0.1:8642',
  findings: [
    {
      id: 'gateway-process',
      severity: 'error' as const,
      title:
        'Hermes Agent is already running (process 5376), but it never switched on the web service this app talks to.',
      detail: 'Its status file lists no active services at all.',
      remedy: 'Do not start a second copy.',
    },
    {
      id: 'profile-env',
      severity: 'error' as const,
      title:
        'Hermes is running as the "hermes-switch" profile, and that profile has an empty settings file.',
      detail: '/home/u/.hermes/profiles/hermes-switch/.env',
      remedy:
        'cp /home/u/.hermes/.env /home/u/.hermes/profiles/hermes-switch/.env',
    },
    {
      id: 'profile-config',
      severity: 'warning' as const,
      title: 'Config is bare.',
    },
    { id: 'gateway-token', severity: 'ok' as const, title: 'Keys match.' },
  ],
}

const freshMachine = {
  severity: 'info' as const,
  gatewayProcessRunning: false,
  missingCapabilities: ['health'],
  firstRun: true,
  findings: [
    {
      id: 'profile-env',
      severity: 'info' as const,
      title: 'Nothing configured yet.',
    },
  ],
}

// ── Pure decision helpers ─────────────────────────────────────────

describe('decision helpers', () => {
  it('never replaces the welcome for a genuine first run', () => {
    expect(shouldShowDiagnostics(freshMachine)).toBe(false)
    expect(shouldShowDiagnostics(brokenInstall)).toBe(true)
  })

  it('keeps the original welcome path when there is no diagnosis at all', () => {
    expect(shouldShowDiagnostics(null)).toBe(false)
    expect(shouldOfferAutoStart(null)).toBe(true)
  })

  it('treats an unknown as a lead worth showing, but an info as not a fault', () => {
    expect(
      shouldShowDiagnostics({
        ...brokenInstall,
        findings: [{ id: 'a', severity: 'unknown', title: 'could not check' }],
      }),
    ).toBe(true)
    expect(
      shouldShowDiagnostics({
        ...brokenInstall,
        findings: [
          { id: 'a', severity: 'ok', title: 'fine' },
          { id: 'b', severity: 'info', title: 'nothing configured yet' },
        ],
      }),
    ).toBe(false)
  })

  it('does not show a diagnostic dump when every check passed', () => {
    expect(
      shouldShowDiagnostics({
        ...brokenInstall,
        severity: 'ok',
        findings: [{ id: 'a', severity: 'ok', title: 'fine' }],
      }),
    ).toBe(false)
  })

  it('offers Auto-Start only when we know nothing is running', () => {
    expect(
      shouldOfferAutoStart({ ...brokenInstall, gatewayProcessRunning: false }),
    ).toBe(true)
    expect(
      shouldOfferAutoStart({ ...brokenInstall, gatewayProcessRunning: true }),
    ).toBe(false)
    // Unknown → prefer the non-destructive action.
    expect(
      shouldOfferAutoStart({ ...brokenInstall, gatewayProcessRunning: null }),
    ).toBe(false)
  })

  it('names missing capabilities in plain words', () => {
    expect(describeMissingCapabilities([])).toBeNull()
    expect(describeMissingCapabilities(['health', 'chatCompletions'])).toBe(
      'health checks, chat',
    )
    expect(
      describeMissingCapabilities([
        'health',
        'chatCompletions',
        'models',
        'streaming',
        'sessions',
        'skills',
        'jobs',
        'mcp',
      ]),
    ).toContain('and 2 more')
  })
})

// ── Rendering ─────────────────────────────────────────────────────

type FetchInit = { method?: string } | undefined

function mockFetch(diagnostics: Diagnostics | 'fail') {
  const startClaude = vi.fn()
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }),
    )
  const fetchImpl = vi.fn((input: unknown, init: FetchInit) => {
    const url = String(input)
    if (url.includes('/api/setup-diagnostics')) {
      if (diagnostics === 'fail') return Promise.reject(new Error('offline'))
      return json(diagnostics)
    }
    if (url.includes('/api/start-claude')) {
      startClaude(init?.method)
      return json({ ok: false, error: 'nope' })
    }
    if (url.includes('/api/gateway-reprobe')) return json({ ok: true })
    // /api/auth-check — always failing, which is what puts this screen up.
    return Promise.reject(new Error('not connected'))
  })
  vi.stubGlobal('fetch', fetchImpl)
  return { fetchImpl, startClaude }
}

/**
 * Advance past the failure-reveal delay so the panel is rendered.
 *
 * `advanceTimersByTimeAsync` also flushes the microtask queue, so the
 * diagnostics fetch has resolved and been committed by the time this returns.
 * `waitFor` is deliberately NOT used: testing-library's fake-timer detection
 * only recognises Jest's, so under `vi.useFakeTimers()` it polls on a clock
 * that never advances and hangs until the test times out.
 */
async function revealPanel() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_000)
  })
}

describe('<ConnectionStartupScreen />', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    cleanup()
  })

  it('shows the first-run welcome, with Auto-Start, on a fresh machine', async () => {
    mockFetch(freshMachine)
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()

    expect(screen.getByText(WELCOME_COPY)).toBeTruthy()
    expect(screen.getByRole('button', { name: AUTO_START_LABEL })).toBeTruthy()
    expect(screen.queryByTestId('diagnostic-findings')).toBeNull()
  })

  it('falls back to the welcome when diagnostics cannot be fetched', async () => {
    mockFetch('fail')
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()

    expect(screen.getByText(WELCOME_COPY)).toBeTruthy()
    expect(screen.getByRole('button', { name: AUTO_START_LABEL })).toBeTruthy()
  })

  it('shows the findings instead of welcome copy when the install is broken', async () => {
    mockFetch(brokenInstall)
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()

    expect(screen.getByTestId('diagnostic-findings')).toBeTruthy()
    expect(screen.queryByText(WELCOME_COPY)).toBeNull()
    expect(screen.getByText(/already running \(process 5376\)/)).toBeTruthy()
    expect(screen.getByText(/empty settings file/)).toBeTruthy()
    // Passing checks are not paraded at the user.
    expect(screen.queryByText('Keys match.')).toBeNull()
  })

  it('names the missing capabilities rather than saying "backend not connected"', async () => {
    mockFetch(brokenInstall)
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()

    expect(screen.getByTestId('missing-capabilities').textContent).toContain(
      'health checks, chat, model list, streaming replies',
    )
  })

  it('does NOT offer Auto-Start when a gateway is already running', async () => {
    mockFetch(brokenInstall)
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()

    expect(screen.getByTestId('diagnostic-findings')).toBeTruthy()
    expect(screen.queryByRole('button', { name: AUTO_START_LABEL })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Re-check connection' }),
    ).toBeTruthy()
    expect(screen.getByText(/Hermes is already running/)).toBeTruthy()
  })

  it('does not silently auto-start when a gateway is already running', async () => {
    const { startClaude } = mockFetch(brokenInstall)
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()
    expect(startClaude).not.toHaveBeenCalled()
  })

  it('still silently auto-starts when nothing is running', async () => {
    const { startClaude } = mockFetch({
      ...brokenInstall,
      gatewayProcessRunning: false,
    })
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()
    expect(startClaude).toHaveBeenCalledWith('POST')
  })

  it('offers Auto-Start alongside the diagnosis when the install exists but is stopped', async () => {
    mockFetch({
      ...brokenInstall,
      gatewayProcessRunning: false,
      findings: [
        {
          id: 'gateway-process',
          severity: 'warning',
          title: 'Hermes Agent is installed but is not running right now.',
        },
      ],
    })
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()

    expect(screen.getByTestId('diagnostic-findings')).toBeTruthy()
    expect(screen.getByRole('button', { name: AUTO_START_LABEL })).toBeTruthy()
  })

  it('keeps the manual-setup path available in the diagnostics view', async () => {
    mockFetch(brokenInstall)
    render(<ConnectionStartupScreen onConnected={() => {}} />)
    await revealPanel()

    expect(screen.getByTestId('diagnostic-findings')).toBeTruthy()
    expect(screen.getByRole('button', { name: /manual setup/ })).toBeTruthy()
    expect(screen.getByText('Start the gateway')).toBeTruthy()
  })
})
