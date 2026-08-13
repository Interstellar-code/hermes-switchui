import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesRpcError, hermesRpc } from './hermes-rpc'
import {
  acquireSlashSession,
  invalidateSlashSession,
  resetSlashSessionsForTest,
  slashSessionSnapshot,
  withSlashSession,
} from './hermes-slash-session'
import type * as HermesRpcModuleNs from './hermes-rpc'

type HermesRpcModule = typeof HermesRpcModuleNs

vi.mock('./hermes-rpc', async () => {
  const actual = await vi.importActual<HermesRpcModule>('./hermes-rpc')
  return { ...actual, hermesRpc: vi.fn() }
})

const rpc = vi.mocked(hermesRpc)

type RpcHandlers = Record<string, ((params: any) => unknown) | undefined>

function respond(handlers: RpcHandlers) {
  rpc.mockImplementation(((method: string, params: any) => {
    const handler = handlers[method]
    if (!handler) throw new Error(`unexpected RPC ${method}`)
    return Promise.resolve(handler(params))
  }) as never)
}

describe('slash session binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSlashSessionsForTest()
  })

  afterEach(() => {
    resetSlashSessionsForTest()
  })

  it('resumes the caller\'s chat session rather than creating a fresh one', async () => {
    // The whole reason this module exists: a freshly created tui_gateway
    // session is empty, so /status and /history would report a session the
    // user has never seen.
    respond({
      'session.resume': (params) => ({
        session_id: 'handle-1',
        resumed: params.session_id,
      }),
    })

    await expect(acquireSlashSession('chat-abc')).resolves.toBe('handle-1')
    expect(rpc).toHaveBeenCalledWith(
      'session.resume',
      { session_id: 'chat-abc' },
      expect.anything(),
    )
  })

  it('creates a scratch session only when there is no chat session yet', async () => {
    respond({ 'session.create': () => ({ session_id: 'scratch' }) })

    await expect(acquireSlashSession(undefined)).resolves.toBe('scratch')
    await expect(acquireSlashSession('')).resolves.toBe('scratch')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('reuses a binding instead of spawning a second subprocess', async () => {
    respond({ 'session.resume': () => ({ session_id: 'handle-1' }) })

    await acquireSlashSession('chat-abc')
    await acquireSlashSession('chat-abc')
    await acquireSlashSession('chat-abc')

    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent binds for the same chat', async () => {
    respond({ 'session.resume': () => ({ session_id: 'handle-1' }) })

    const results = await Promise.all([
      acquireSlashSession('chat-abc'),
      acquireSlashSession('chat-abc'),
    ])

    expect(results).toEqual(['handle-1', 'handle-1'])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('caps concurrent bindings and closes the one it evicts', async () => {
    let counter = 0
    const closed: Array<string> = []
    respond({
      'session.resume': () => ({ session_id: `handle-${(counter += 1)}` }),
      'session.close': (params) => {
        closed.push(params.session_id)
        return { closed: true }
      },
    })

    // MAX_BINDINGS is 4; each binding is a real Python subprocess agent-side.
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      await acquireSlashSession(key)
    }

    expect(slashSessionSnapshot()).toHaveLength(4)
    expect(closed).toEqual(['handle-1'])
    expect(slashSessionSnapshot().map((entry) => entry.key)).not.toContain('a')
  })

  it('rebinds once when the dashboard has forgotten the session (4001)', async () => {
    let handles = 0
    respond({
      'session.resume': () => ({ session_id: `handle-${(handles += 1)}` }),
    })

    const seen: Array<string> = []
    const result = await withSlashSession('chat-abc', (handle) => {
      seen.push(handle)
      if (seen.length === 1) {
        return Promise.reject(new HermesRpcError(4001, 'session not found'))
      }
      return Promise.resolve('ok')
    })

    expect(result).toBe('ok')
    expect(seen).toEqual(['handle-1', 'handle-2'])
  })

  it('does not retry a failure that is not 4001', async () => {
    respond({ 'session.resume': () => ({ session_id: 'handle-1' }) })

    let calls = 0
    await expect(
      withSlashSession('chat-abc', () => {
        calls += 1
        return Promise.reject(new HermesRpcError(5030, 'worker failed'))
      }),
    ).rejects.toThrow('worker failed')
    expect(calls).toBe(1)
  })

  it('retries only once, so a persistently missing session still errors', async () => {
    respond({ 'session.resume': () => ({ session_id: 'handle-1' }) })

    let calls = 0
    await expect(
      withSlashSession('chat-abc', () => {
        calls += 1
        return Promise.reject(new HermesRpcError(4001, 'session not found'))
      }),
    ).rejects.toThrow('session not found')
    expect(calls).toBe(2)
  })

  it('rejects a session response with no id rather than binding to nothing', async () => {
    respond({ 'session.resume': () => ({}) })
    await expect(acquireSlashSession('chat-abc')).rejects.toThrow(
      /no session_id/i,
    )
    expect(slashSessionSnapshot()).toHaveLength(0)
  })

  it('does not cache a failed bind', async () => {
    let attempt = 0
    respond({
      'session.resume': () => {
        attempt += 1
        if (attempt === 1) throw new Error('dashboard down')
        return { session_id: 'handle-1' }
      },
    })

    await expect(acquireSlashSession('chat-abc')).rejects.toThrow('dashboard down')
    await expect(acquireSlashSession('chat-abc')).resolves.toBe('handle-1')
  })

  it('invalidate drops the binding without closing it agent-side', async () => {
    respond({ 'session.resume': () => ({ session_id: 'handle-1' }) })
    await acquireSlashSession('chat-abc')
    invalidateSlashSession('chat-abc')
    expect(slashSessionSnapshot()).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalledWith(
      'session.close',
      expect.anything(),
      expect.anything(),
    )
  })
})
