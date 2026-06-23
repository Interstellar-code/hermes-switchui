import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoist mocks so vi.mock sees them before module resolution
const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn().mockReturnValue({
    unref: vi.fn(),
    pid: 12345,
  }),
}))

vi.mock('node:child_process', () => ({
  spawn,
}))

// Stub fetch for health checks
const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

// Stub process.env.CLAUDE_AGENT_PATH so resolveClaudeAgentDir returns null
// (avoids filesystem probing in tests)
beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CLAUDE_AGENT_PATH
  delete process.env.CLAUDE_API_URL
  delete process.env.HERMES_API_URL
  delete process.env.HERMES_HOME
  delete process.env.CLAUDE_HOME
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function loadMod() {
  vi.resetModules()
  return import('../claude-agent')
}

describe('startClaudeAgent', () => {
  it('returns ok:false with error when health probe never passes', async () => {
    // Health check always fails
    mockFetch.mockRejectedValue(new Error('Connection refused'))

    const mod = await loadMod()
    // Collapse the 10s timeout to 50ms so the test finishes fast
    mod.__setStartupTimeoutForTests(50)

    const result = await mod.startClaudeAgent()

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    )
    expect(result.ok === false && result.error).toContain('did not become healthy')

    mod.__setStartupTimeoutForTests(null)
  })

  it('returns ok:true/message:started when health probe passes after spawn', async () => {
    // First call (pre-check before spawn) fails so we enter the spawn path.
    // Subsequent calls (poll loop) succeed so waitForClaudeAgentHealthy returns true.
    mockFetch
      .mockRejectedValueOnce(new Error('not yet'))
      .mockResolvedValue({ ok: true, status: 200 })

    const mod = await loadMod()
    mod.__setStartupTimeoutForTests(200)

    const result = await mod.startClaudeAgent()

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: 'started',
      }),
    )

    mod.__setStartupTimeoutForTests(null)
  })
})
