/**
 * Tests for startClaudeAgent() health-gating fix (issue #201).
 *
 * Strategy: mock node:child_process spawn so no real process is started,
 * mock node:fs so the binary-resolution early-returns find a candidate,
 * mock global fetch to control isClaudeAgentHealthy() probes, and use
 * vi.useFakeTimers() to advance the 10 × 1 s poll loop without real waits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'

// ── fs mock ──────────────────────────────────────────────────────────────────
// existsSync must return true so resolveClaudeBinary() finds a candidate and
// the spawn branch is taken. readFileSync returns '' (empty .env).
const { existsSync, readFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue(''),
}))

vi.mock('node:fs', () => ({
  default: { existsSync, readFileSync },
  existsSync,
  readFileSync,
}))

// ── os mock ───────────────────────────────────────────────────────────────────
const { homedir } = vi.hoisted(() => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('node:os', () => ({
  default: { homedir },
  homedir,
}))

// ── child_process mock ────────────────────────────────────────────────────────
// spawn returns a minimal ChildProcess stub; child.unref() must not throw.
const mockSpawn = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeChild(pid = 1234): Partial<ChildProcess> {
  return {
    pid,
    unref: vi.fn(),
  }
}

// ── module isolation ──────────────────────────────────────────────────────────

async function loadMod() {
  vi.resetModules()
  return import('./claude-agent')
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('startClaudeAgent – health-gated return (issue #201)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSpawn.mockReturnValue(makeFakeChild())
    // Clear env overrides that would alter gateway URL resolution
    delete process.env.HERMES_API_URL
    delete process.env.CLAUDE_API_URL
    delete process.env.HERMES_HOME
    delete process.env.CLAUDE_HOME
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns ok:true with message "already running" when gateway is healthy before spawn', async () => {
    // First fetch call (isClaudeAgentHealthy pre-check) succeeds → fast path
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const { startClaudeAgent } = await loadMod()
    const result = await startClaudeAgent()

    expect(result).toMatchObject({ ok: true, message: 'already running' })
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('returns ok:true with pid and message "started" when gateway becomes healthy within poll window', async () => {
    // Pre-check fails (not running yet), then health probe succeeds on 1st poll attempt
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })  // pre-check: not running
      .mockResolvedValueOnce({ ok: true })   // 1st poll attempt: healthy

    vi.stubGlobal('fetch', fetchMock)

    const { startClaudeAgent } = await loadMod()

    // startClaudeAgent kicks off async work; we must advance timers to unblock
    // the 1 s setTimeout inside the poll loop
    const promise = startClaudeAgent()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({ ok: true, message: 'started', pid: 1234 })
  })

  it('returns ok:false with actionable error when gateway never becomes healthy within poll window', async () => {
    // All fetch calls return unhealthy (pre-check + all 10 poll attempts)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    const { startClaudeAgent } = await loadMod()

    const promise = startClaudeAgent()
    // Advance through all 10 × 1 s poll intervals
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/gateway spawned but did not become healthy/i)
      expect(result.error).toMatch(/8642/)   // default port present in URL
      expect(result.error).toMatch(/10s/)
    }
  })

  it('returns ok:false with actionable error when fetch throws on every probe (connection refused)', async () => {
    // Pre-check throws, all poll probes throw
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const { startClaudeAgent } = await loadMod()

    const promise = startClaudeAgent()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/gateway spawned but did not become healthy/i)
    }
  })

  it('startPromise is cleared after failure so a subsequent call can retry', async () => {
    // All probes unhealthy → failure
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    const { startClaudeAgent } = await loadMod()

    const p1 = startClaudeAgent()
    await vi.runAllTimersAsync()
    const r1 = await p1
    expect(r1.ok).toBe(false)

    // Second call: gateway is now healthy (first pre-check succeeds)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const r2 = await startClaudeAgent()
    expect(r2).toMatchObject({ ok: true, message: 'already running' })
  })
})
