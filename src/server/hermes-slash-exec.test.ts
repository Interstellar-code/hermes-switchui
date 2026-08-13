import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesRpcError, hermesRpc } from './hermes-rpc'
import { getAgentVersion } from './hermes-agent-version'
import {
  SLASH_OUTPUT_LIMIT_BYTES,
  SLASH_TIMEOUT_MESSAGE,
  capSlashResult,
  classifySlashFailure,
  normalizeDispatchResult,
  runSlashCommand,
  sliceUtf8,
} from './hermes-slash-exec'
import { resetSlashSessionsForTest } from './hermes-slash-session'
import type * as HermesRpcModuleNs from './hermes-rpc'

type HermesRpcModule = typeof HermesRpcModuleNs

vi.mock('./hermes-rpc', async () => {
  const actual = await vi.importActual<HermesRpcModule>('./hermes-rpc')
  return { ...actual, hermesRpc: vi.fn() }
})

// Only the HTTP read of the agent's version is stubbed. The comparator that
// applies the floor lives in `agent-version.ts` and stays real, so the cases
// below exercise the actual ordering rather than a stub of it.
vi.mock('./hermes-agent-version', () => ({
  getAgentVersion: vi.fn(() => Promise.resolve('0.19.16')),
}))

const rpc = vi.mocked(hermesRpc)
const agentVersion = vi.mocked(getAgentVersion)

type RpcHandlers = Record<string, ((params: any) => unknown) | undefined>

function respond(handlers: RpcHandlers) {
  rpc.mockImplementation(((method: string, params: any) => {
    const handler = handlers[method]
    if (!handler) throw new Error(`unexpected RPC ${method}`)
    const value = handler(params)
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  }) as never)
}

const RESUME = { 'session.resume': () => ({ session_id: 'handle-1' }) }

describe('normalizeDispatchResult', () => {
  it('maps every arm of the union', () => {
    expect(normalizeDispatchResult({ type: 'exec', output: 'x' })).toEqual({
      type: 'exec',
      output: 'x',
    })
    expect(normalizeDispatchResult({ type: 'plugin', output: 'x' })).toEqual({
      type: 'plugin',
      output: 'x',
    })
    expect(
      normalizeDispatchResult({ type: 'send', message: 'm', notice: 'n' }),
    ).toEqual({ type: 'send', message: 'm', notice: 'n' })
    expect(
      normalizeDispatchResult({ type: 'skill', message: 'm', name: 'arxiv' }),
    ).toEqual({ type: 'skill', message: 'm', name: 'arxiv' })
    expect(
      normalizeDispatchResult({ type: 'prefill', message: 'm', notice: 'n' }),
    ).toEqual({ type: 'prefill', message: 'm', notice: 'n' })
    expect(normalizeDispatchResult({ type: 'alias', target: '/branch' })).toEqual(
      { type: 'alias', target: '/branch' },
    )
  })

  it('degrades an unknown type to an output card rather than dropping it', () => {
    expect(normalizeDispatchResult({ type: 'wat', output: 'text' })).toEqual({
      type: 'exec',
      output: 'text',
    })
    expect(normalizeDispatchResult(null)).toEqual({ type: 'exec', output: '' })
  })

  it('rejects an alias with no target', () => {
    expect(normalizeDispatchResult({ type: 'alias' })).toEqual({
      type: 'exec',
      output: '(alias)',
    })
  })
})

describe('runSlashCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Above the floor unless a case says otherwise.
    agentVersion.mockResolvedValue('0.19.16')
    resetSlashSessionsForTest()
  })

  afterEach(() => {
    resetSlashSessionsForTest()
  })

  it('refuses before it opens a session — no RPC at all', async () => {
    respond({})
    const outcome = await runSlashCommand('/yolo', { chatSessionId: 'chat-1' })
    expect(outcome).toMatchObject({ ok: false, refused: true, command: '/yolo' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a client that asks for a command with arguments', async () => {
    respond({})
    const outcome = await runSlashCommand('/help --json', {
      chatSessionId: 'chat-1',
    })
    expect(outcome.ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends the bare canonical command, never the raw client string', async () => {
    const seen: Array<unknown> = []
    respond({
      ...RESUME,
      'slash.exec': (params) => {
        seen.push(params)
        return { output: 'Available commands:' }
      },
    })

    // Uppercase on purpose: the point is that the canonical, lowercased,
    // argument-free form reaches the RPC, never the raw client string.
    const outcome = await runSlashCommand('/HELP', { chatSessionId: 'chat-1' })
    expect(outcome).toMatchObject({
      ok: true,
      command: '/help',
      result: { type: 'exec', output: 'Available commands:' },
    })
    expect(seen).toEqual([{ session_id: 'handle-1', command: '/help' }])
  })

  it('sends an argument-restricted command WITH its flag', async () => {
    // The hazard this pins: sending `decision.command` alone would turn an
    // allowed, read-only `/compress --preview` into a bare `/compress`, which
    // compresses the conversation and rotates the session. The flag must reach
    // the wire.
    const seen: Array<unknown> = []
    respond({
      ...RESUME,
      'slash.exec': (params) => {
        seen.push(params)
        return { output: 'Preview — no changes made.' }
      },
    })

    const outcome = await runSlashCommand('/COMPRESS --Preview', {
      chatSessionId: 'chat-1',
    })
    expect(outcome).toMatchObject({ ok: true, command: '/compress' })
    expect(seen).toEqual([
      { session_id: 'handle-1', command: '/compress --preview' },
    ])
  })

  it('never reaches the agent with a bare /compress', async () => {
    respond({})
    for (const input of ['/compress', '/compress here 5', '/compress --preview x']) {
      const outcome = await runSlashCommand(input, { chatSessionId: 'chat-1' })
      expect(outcome, input).toMatchObject({ ok: false, refused: true })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends /debug WITH `local`, the only form that does not upload', async () => {
    // Same hazard as /compress --preview and worse: dropping the argument
    // turns an allowed local render into a bare /debug, which uploads an
    // unredacted state dump to a PUBLIC paste.
    const seen: Array<unknown> = []
    respond({
      ...RESUME,
      'slash.exec': (params) => {
        seen.push(params)
        return { output: 'Collecting debug report...' }
      },
    })

    const outcome = await runSlashCommand('/DEBUG Local', {
      chatSessionId: 'chat-1',
    })
    expect(outcome).toMatchObject({ ok: true, command: '/debug' })
    expect(seen).toEqual([{ session_id: 'handle-1', command: '/debug local' }])
  })

  it('never reaches the agent with a /debug form that uploads', async () => {
    respond({})
    for (const input of ['/debug', '/debug nous', '/debug local nous']) {
      const outcome = await runSlashCommand(input, { chatSessionId: 'chat-1' })
      expect(outcome, input).toMatchObject({ ok: false, refused: true })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends /insights with its day count, and refuses anything else', async () => {
    const seen: Array<unknown> = []
    respond({
      ...RESUME,
      'slash.exec': (params) => {
        seen.push(params)
        return { output: 'Last 3 days' }
      },
    })

    await runSlashCommand('/insights 3', { chatSessionId: 'chat-1' })
    await runSlashCommand('/insights', { chatSessionId: 'chat-1' })
    expect(seen).toEqual([
      { session_id: 'handle-1', command: '/insights 3' },
      { session_id: 'handle-1', command: '/insights' },
    ])

    const before = rpc.mock.calls.length
    for (const input of ['/insights --preview', '/insights; rm -rf', '/insights 0']) {
      const outcome = await runSlashCommand(input, { chatSessionId: 'chat-1' })
      expect(outcome, input).toMatchObject({ ok: false, refused: true })
    }
    expect(rpc.mock.calls.length).toBe(before)
  })

  it('dispatches /learn on the dispatch route, arguments intact', async () => {
    // `/learn` is in _PENDING_INPUT_COMMANDS, so slash.exec would only forward
    // it to command.dispatch anyway. Going direct keeps the {type:'send'}
    // answer shape expected rather than sniffed — and its arguments are the
    // payload, so dropping them would change what gets learned.
    const seen: Array<unknown> = []
    respond({
      ...RESUME,
      'command.dispatch': (params) => {
        seen.push(params)
        return { type: 'send', message: '[/learn] …' }
      },
    })

    const outcome = await runSlashCommand('/learn ./src/server RPC layer only', {
      chatSessionId: 'chat-1',
    })
    expect(outcome).toMatchObject({
      ok: true,
      command: '/learn',
      result: { type: 'send', message: '[/learn] …' },
    })
    expect(seen).toEqual([
      {
        session_id: 'handle-1',
        name: '/learn',
        arg: './src/server RPC layer only',
      },
    ])
  })

  it('surfaces the mirror warning alongside the output', async () => {
    respond({
      ...RESUME,
      'slash.exec': () => ({ output: 'done', warning: 'session busy' }),
    })
    const outcome = await runSlashCommand('/help', { chatSessionId: 'c' })
    expect(outcome).toMatchObject({
      ok: true,
      result: { type: 'exec', output: 'done', warning: 'session busy' },
    })
  })

  it('dispatches a skill command with its arguments, on `name`', async () => {
    // `command.dispatch` reads `name`, not `command`. Passing `command` makes
    // it dispatch the empty string and answer 4018 — verified live.
    const seen: Array<unknown> = []
    respond({
      ...RESUME,
      'command.dispatch': (params) => {
        seen.push(params)
        return { type: 'skill', message: 'skill body', name: 'arxiv' }
      },
    })

    const outcome = await runSlashCommand('/arxiv attention paper', {
      chatSessionId: 'chat-1',
      skillCommands: new Set(['/arxiv']),
    })

    expect(outcome).toMatchObject({
      ok: true,
      result: { type: 'skill', message: 'skill body' },
    })
    expect(seen).toEqual([
      { session_id: 'handle-1', name: '/arxiv', arg: 'attention paper' },
    ])
  })

  it('falls back to command.dispatch when slash.exec answers 4018', async () => {
    const calls: Array<string> = []
    respond({
      ...RESUME,
      'slash.exec': () => {
        calls.push('slash.exec')
        return new HermesRpcError(4018, 'blocked in the worker')
      },
      'command.dispatch': () => {
        calls.push('command.dispatch')
        return { type: 'exec', output: 'from dispatch' }
      },
    })

    const outcome = await runSlashCommand('/help', { chatSessionId: 'chat-1' })
    expect(calls).toEqual(['slash.exec', 'command.dispatch'])
    expect(outcome).toMatchObject({
      ok: true,
      result: { type: 'exec', output: 'from dispatch' },
    })
  })

  it('does not fall back on any other error code', async () => {
    respond({
      ...RESUME,
      'slash.exec': () => new HermesRpcError(5030, 'worker failed to start'),
    })
    await expect(
      runSlashCommand('/help', { chatSessionId: 'chat-1' }),
    ).rejects.toThrow('worker failed to start')
  })

  it('passes through a union that slash.exec forwarded verbatim', async () => {
    respond({
      ...RESUME,
      'slash.exec': () => ({ type: 'prefill', message: 'redo this', notice: 'n' }),
    })
    const outcome = await runSlashCommand('/help', { chatSessionId: 'c' })
    expect(outcome).toMatchObject({
      ok: true,
      result: { type: 'prefill', message: 'redo this' },
    })
  })

  it('resolves an alias before checking the allowlist', async () => {
    respond({})
    const outcome = await runSlashCommand('/compact', {
      chatSessionId: 'chat-1',
      aliases: { '/compact': '/compress' },
    })
    expect(outcome).toMatchObject({ ok: false, command: '/compress' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('runSlashCommand — the agent-version floor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentVersion.mockResolvedValue('0.19.16')
    resetSlashSessionsForTest()
  })

  afterEach(() => {
    resetSlashSessionsForTest()
  })

  it('reads the version itself rather than taking it from the caller', async () => {
    // The floor is a control, not a picker filter, so it cannot depend on
    // anything the request carried. `RunSlashCommandOptions` has no
    // `agentVersion` field at all — this asserts the read happens here.
    respond({ ...RESUME, 'slash.exec': () => ({ output: 'ok' }) })
    await runSlashCommand('/help', { chatSessionId: 'chat-1' })
    expect(agentVersion).toHaveBeenCalled()
  })

  it('refuses an allowlisted command below the floor, before opening a session', async () => {
    agentVersion.mockResolvedValue('0.19.9')
    respond({})

    const outcome = await runSlashCommand('/compress --preview', {
      chatSessionId: 'chat-1',
    })
    expect(outcome).toMatchObject({ ok: false, refused: true, command: '/compress' })
    if (outcome.ok) return
    expect(outcome.reason).toContain('0.19.16')
    expect(outcome.reason).toContain('0.19.9')
    // Nothing reached the agent — not even `session.resume`. Below the floor
    // `/compress --preview` is a real compression, so the refusal has to land
    // before any RPC, not after one.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses when the version cannot be read at all', async () => {
    agentVersion.mockResolvedValue(null)
    respond({})

    const outcome = await runSlashCommand('/history', { chatSessionId: 'chat-1' })
    expect(outcome).toMatchObject({ ok: false, refused: true })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('still dispatches a skill command below the floor', async () => {
    agentVersion.mockResolvedValue('0.19.9')
    respond({
      ...RESUME,
      'command.dispatch': (params: any) => ({
        type: 'skill',
        message: `skill: ${params.name} ${params.arg}`,
        name: 'arxiv',
      }),
    })

    const outcome = await runSlashCommand('/arxiv attention paper', {
      chatSessionId: 'chat-1',
      skillCommands: new Set(['/arxiv']),
    })
    expect(outcome).toMatchObject({
      ok: true,
      command: '/arxiv',
      result: { type: 'skill', message: 'skill: /arxiv attention paper' },
    })
  })

  it('still dispatches a bundle slug below the floor', async () => {
    agentVersion.mockResolvedValue('0.19.9')
    respond({
      ...RESUME,
      'command.dispatch': () => ({ type: 'send', message: 'bundle prompt' }),
    })

    const outcome = await runSlashCommand('/research-stack summarise', {
      chatSessionId: 'chat-1',
      bundleCommands: new Set(['/research-stack']),
    })
    expect(outcome).toMatchObject({
      ok: true,
      result: { type: 'send', message: 'bundle prompt' },
    })
  })
})

// ── The output cap ────────────────────────────────────────────────────────
// `/debug local` measured 1,153,097 bytes live on 2026-08-13 (installed
// v0.19.16, throwaway session) against 69 bytes for `/profile`. Nothing capped
// it. These pin the boundary and, more importantly, that a truncated payload
// says so.

describe('sliceUtf8', () => {
  it('never splits a multi-byte character', () => {
    // Each `é` is 2 bytes, so a 5-byte cut lands mid-character on the third.
    const text = 'ééé'
    expect(Buffer.byteLength(text, 'utf8')).toBe(6)
    const cut = sliceUtf8(text, 5)
    expect(cut).toBe('éé')
    expect(cut).not.toContain('�')
  })

  it('cuts cleanly on an exact boundary, and on 4-byte characters', () => {
    expect(sliceUtf8('ééé', 4)).toBe('éé')
    // 😀 is 4 bytes; every cut inside it must drop the whole character.
    for (const max of [4, 5, 6, 7]) {
      expect(sliceUtf8('😀😀', max), String(max)).toBe('😀')
    }
  })

  it('returns the input untouched when it already fits', () => {
    expect(sliceUtf8('short', 64)).toBe('short')
    expect(sliceUtf8('abc', 3)).toBe('abc')
  })
})

describe('capSlashResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentVersion.mockResolvedValue('0.19.16')
    resetSlashSessionsForTest()
  })

  afterEach(() => {
    resetSlashSessionsForTest()
  })

  const under = 'x'.repeat(SLASH_OUTPUT_LIMIT_BYTES)
  const over = 'x'.repeat(SLASH_OUTPUT_LIMIT_BYTES + 1)

  it('leaves an output of exactly the limit alone', () => {
    const result = capSlashResult({ type: 'exec', output: under })
    expect(result).toEqual({ type: 'exec', output: under })
  })

  it('truncates one byte over, and says how big the real output was', () => {
    const result = capSlashResult({ type: 'exec', output: over })
    if (result.type !== 'exec') throw new Error('wrong arm')

    // The kept text is exactly the limit; the notice is additional, so the
    // payload does not silently become the cap either.
    expect(result.output.startsWith(under)).toBe(true)
    expect(result.output).toContain('output truncated by SwitchUI')
    // The REAL size, not the kept size — a truncation that hides its own
    // scale is the failure mode this exists to prevent.
    expect(result.output).toContain('65,537 bytes')
    expect(result.output).toContain('65,536')
    // And where the rest lives, since the bulk of a /debug dump is agent.log.
    expect(result.output).toContain('/api/logs')
    expect(result.warning).toContain('Output truncated')
  })

  it('keeps an existing mirror warning alongside the truncation warning', () => {
    const result = capSlashResult({
      type: 'exec',
      output: over,
      warning: 'live session sync failed: boom',
    })
    if (result.type !== 'exec') throw new Error('wrong arm')
    expect(result.warning).toContain('live session sync failed: boom')
    expect(result.warning).toContain('Output truncated')
  })

  it('caps prompt-bearing arms too — an unbounded prompt is the same defect', () => {
    for (const result of [
      capSlashResult({ type: 'send', message: over }),
      capSlashResult({ type: 'skill', message: over, name: 'arxiv' }),
      capSlashResult({ type: 'prefill', message: over, notice: 'n' }),
    ]) {
      if (result.type === 'exec' || result.type === 'plugin' || result.type === 'alias') {
        throw new Error('wrong arm')
      }
      expect(result.message).toContain('output truncated by SwitchUI')
    }
    expect(capSlashResult({ type: 'send', message: under })).toEqual({
      type: 'send',
      message: under,
    })
  })

  it('leaves an alias target alone — it is a command name, not output', () => {
    expect(capSlashResult({ type: 'alias', target: '/branch' })).toEqual({
      type: 'alias',
      target: '/branch',
    })
  })

  it('applies through runSlashCommand, so every caller gets it', async () => {
    // The cap lives in runSlashCommand rather than in the route: the route is
    // one caller of several possible ones, and a future one must not have to
    // remember. This is the assertion that keeps it there.
    respond({
      ...RESUME,
      'slash.exec': () => ({ output: 'y'.repeat(SLASH_OUTPUT_LIMIT_BYTES * 2) }),
    })
    const outcome = await runSlashCommand('/debug local', { chatSessionId: 'c' })
    if (!outcome.ok || outcome.result.type !== 'exec') throw new Error('failed')
    expect(Buffer.byteLength(outcome.result.output, 'utf8')).toBeLessThan(
      SLASH_OUTPUT_LIMIT_BYTES + 1024,
    )
    expect(outcome.result.output).toContain('131,072 bytes')
  })
})

// ── Failure classification ────────────────────────────────────────────────

describe('classifySlashFailure', () => {
  it('maps a 4xxx to a 4xx and keeps the agent’s message verbatim', () => {
    const cases: Array<[number, string, number, string]> = [
      [4004, 'usage: /subgoal remove <n>', 400, 'invalid-input'],
      [4004, '<n> must be an integer', 400, 'invalid-input'],
      [4004, 'index out of range (1..1)', 400, 'invalid-input'],
      [4002, 'text is required', 400, 'invalid-input'],
      [4018, 'not a quick/plugin/bundle/skill command: nope', 400, 'unroutable'],
      [4001, 'session not found', 404, 'session-gone'],
      [4007, 'session not found', 404, 'session-gone'],
      [4009, 'session busy', 409, 'busy'],
      [4027, 'session is already in flight for handoff', 409, 'busy'],
      [4090, 'too many active sessions', 429, 'rate-limited'],
      // Unlisted 4xxx still lands in the caller-side family — the rule is the
      // range, not a lookup table, because `_err` has no code table to copy.
      [4026, 'no home channel configured for slack', 400, 'invalid-input'],
      [4044, 'no such process: 7', 400, 'invalid-input'],
    ]
    for (const [code, message, status, kind] of cases) {
      const failure = classifySlashFailure(new HermesRpcError(code, message))
      expect(failure, `${code} ${message}`).toEqual({
        status,
        kind,
        message,
        agentCode: code,
        guidance: true,
      })
    }
  })

  it('leaves every 5xxx a 5xx — flattening one would hide an outage', () => {
    for (const code of [5000, 5008, 5009, 5019, 5030, 5063]) {
      const failure = classifySlashFailure(new HermesRpcError(code, 'boom'))
      expect(failure.status, String(code)).toBe(502)
      expect(failure.status, String(code)).toBeGreaterThanOrEqual(500)
      expect(failure.kind, String(code)).toBe('agent-error')
      expect(failure.guidance, String(code)).toBe(false)
    }
  })

  it('treats JSON-RPC framing codes as ours', () => {
    for (const code of [-32600, -32601, -32602, -32603, -32700]) {
      const failure = classifySlashFailure(new HermesRpcError(code, 'bad frame'))
      expect(failure.status, String(code)).toBe(502)
      expect(failure.guidance, String(code)).toBe(false)
    }
  })

  it('rewrites only the timeout, because its raw text explains nothing', () => {
    const failure = classifySlashFailure(
      new Error('Hermes RPC timeout after 30000ms for slash.exec'),
    )
    expect(failure).toEqual({
      status: 504,
      kind: 'timeout',
      message: SLASH_TIMEOUT_MESSAGE,
      agentCode: null,
      guidance: false,
    })
  })

  it('maps a plain transport failure to 502', () => {
    expect(classifySlashFailure(new Error('socket closed'))).toEqual({
      status: 502,
      kind: 'agent-error',
      message: 'socket closed',
      agentCode: null,
      guidance: false,
    })
    expect(classifySlashFailure('not an error')).toMatchObject({
      status: 502,
      message: 'Command failed',
    })
  })
})
