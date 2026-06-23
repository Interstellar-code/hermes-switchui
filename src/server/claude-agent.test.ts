import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Regression tests for #201 — startClaudeAgent() must not return ok:true
 * until the gateway has actually become healthy. Spawn a stub `hermes` binary
 * via a temp script so the production spawn() path is exercised, and stub
 * `globalThis.fetch` to drive the health probe deterministically.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.useRealTimers()
  // Force the spawn path to pick up our stub hermes binary and the
  // gateway to probe HERMES_API_URL (set below) — keep this stable
  // across the suite.
  process.env.HERMES_API_URL = 'http://127.0.0.1:8642'
  process.env.HERMES_HOME = mkdtempSync(join(tmpdir(), 'hermes-home-201-'))
  ;(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockReset()
})

afterEach(() => {
  delete process.env.HERMES_API_URL
  delete process.env.HERMES_HOME
  vi.restoreAllMocks()
})

async function loadModuleWithShortTimeout(timeoutMs: number) {
  // Re-import the module with the test-only timeout override set on its
  // module state. startClaudeAgent() reads the override at call time, so
  // setting it before the first call is sufficient.
  vi.resetModules()
  const mod = await import('./claude-agent')
  mod.__setStartupTimeoutForTests(timeoutMs)
  return mod
}

function makeStubHermesBinary(): { dir: string; bin: string } {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-bin-201-'))
  // The stub exits cleanly after "starting" — simulates a gateway that
  // would come up if anything ever connected. The health probe is what
  // startClaudeAgent() uses to decide success, not this binary.
  const script = `#!/bin/sh\nexit 0\n`
  const bin = join(dir, 'hermes')
  writeFileSync(bin, script, { mode: 0o755 })
  return { dir, bin }
}

describe('startClaudeAgent (#201)', () => {
  it('returns ok:true "started" when the gateway becomes healthy before the timeout', async () => {
    const { dir: binDir } = makeStubHermesBinary()
    // Prepend the stub directory to PATH so resolveClaudeBinary() finds it.
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`

    // First health probe (the "already running?" check) fails; subsequent
    // probes succeed. This models a gateway that wasn't running, was
    // spawned, and then came up.
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const { startClaudeAgent } = await import('./claude-agent')
    const result = await startClaudeAgent()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.message).toBe('started')
      expect(typeof result.pid).toBe('number')
    }

    rmSync(binDir, { recursive: true, force: true })
  })

  it('returns ok:false with an actionable error when the gateway never becomes healthy', async () => {
    const { dir: binDir } = makeStubHermesBinary()
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`

    // Always-failing health probe — gateway spawns but never serves /health.
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    // Collapse the 10s real wait to ~150ms so the test finishes quickly.
    const { startClaudeAgent, __setStartupTimeoutForTests, STARTUP_TIMEOUT_MS } =
      await loadModuleWithShortTimeout(150)
    // Sanity-check the public constant is the production default.
    expect(STARTUP_TIMEOUT_MS).toBe(10_000)
    // Make sure we clean the override up if this test fails mid-flight.
    try {
      const result = await startClaudeAgent()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toMatch(/did not become healthy/)
        expect(result.error).toContain('http://127.0.0.1:8642')
        // The error must surface the PID so operators can inspect/kill the
        // orphan gateway process that the spawn left behind.
        expect(result.error).toMatch(/pid: \d+/)
      }
    } finally {
      __setStartupTimeoutForTests(null)
    }

    rmSync(binDir, { recursive: true, force: true })
  })

  it('returns ok:true "already running" without spawning when the gateway is healthy on entry', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const { startClaudeAgent } = await import('./claude-agent')
    const result = await startClaudeAgent()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.message).toBe('already running')
      // No spawn happened, so no PID is reported.
      expect(result.pid).toBeUndefined()
    }
  })
})

describe('waitForClaudeAgentHealthy (helper)', () => {
  it('returns true on the first healthy probe', async () => {
    const probe = vi.fn().mockResolvedValue(true)
    const { waitForClaudeAgentHealthy } = await import('./claude-agent')
    const ok = await waitForClaudeAgentHealthy(
      'http://example.test',
      5_000,
      100,
      async () => {},
      probe,
    )
    expect(ok).toBe(true)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('returns false if the probe never succeeds before the timeout', async () => {
    const probe = vi.fn().mockResolvedValue(false)
    const sleep = vi.fn().mockResolvedValue(undefined)
    const { waitForClaudeAgentHealthy } = await import('./claude-agent')
    const ok = await waitForClaudeAgentHealthy(
      'http://example.test',
      250,
      50,
      sleep,
      probe,
    )
    expect(ok).toBe(false)
    // At least one probe attempt; the exact count depends on timing but
    // we never resolve true.
    expect(probe).toHaveBeenCalled()
    expect(sleep).toHaveBeenCalled()
  })
})
