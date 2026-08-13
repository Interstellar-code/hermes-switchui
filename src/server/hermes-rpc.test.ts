import { WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dashboardFetch, getDashboardToken } from './gateway-capabilities'
import {
  HermesRpcClient,
  HermesRpcError,
  buildHermesRpcUrl,
  classifyRpcFrame,
  nextReconnectDelayMs,
  parseRpcFrames,
} from './hermes-rpc'
import type { AddressInfo } from 'node:net'
import type { WebSocket as NodeWebSocket } from 'ws'

vi.mock('./gateway-capabilities', () => ({
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  dashboardFetch: vi.fn(),
  getDashboardToken: vi.fn(),
}))

// ── Fake dashboard /api/ws ────────────────────────────────────────
// A real WebSocketServer, because the whole point of this module is wire
// behaviour: the unsolicited gateway.ready frame, events sharing the socket
// with responses, and reconnect.

type Responder = (
  req: { id: unknown; method: string; params: unknown },
  send: (obj: unknown) => void,
  socket: NodeWebSocket,
) => void

type FakeDashboard = {
  port: number
  /** Request URLs (path + query) seen by each accepted upgrade, in order. */
  urls: Array<string>
  sockets: Array<NodeWebSocket>
  close: () => Promise<void>
}

async function startFakeDashboard(
  respond: Responder,
  options: { sendReady?: boolean; onConnect?: (socket: NodeWebSocket) => void } = {},
): Promise<FakeDashboard> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))

  const urls: Array<string> = []
  const sockets: Array<NodeWebSocket> = []

  wss.on('connection', (socket, request) => {
    urls.push(request.url ?? '')
    sockets.push(socket)
    if (options.sendReady !== false) {
      socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'event',
          params: { type: 'gateway.ready', payload: { skin: { name: 'default' } } },
        }),
      )
    }
    options.onConnect?.(socket)
    socket.on('message', (data) => {
      const req = JSON.parse(data.toString())
      respond(req, (obj) => socket.send(JSON.stringify(obj)), socket)
    })
  })

  return {
    port: (wss.address() as AddressInfo).port,
    urls,
    sockets,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.terminate()
        wss.close(() => resolve())
      }),
  }
}

let clients: Array<HermesRpcClient> = []
let servers: Array<FakeDashboard> = []

function makeClient(port: number, extra: Record<string, unknown> = {}) {
  const client = new HermesRpcClient({
    resolveUrl: () =>
      Promise.resolve({
        url: `ws://127.0.0.1:${port}/api/ws?token=test`,
        mode: 'token' as const,
      }),
    rpcTimeoutMs: 2000,
    connectTimeoutMs: 2000,
    ...extra,
  })
  clients.push(client)
  return client
}

beforeEach(() => {
  vi.mocked(dashboardFetch).mockReset()
  vi.mocked(getDashboardToken).mockReset()
})

afterEach(async () => {
  for (const client of clients) await client.shutdown().catch(() => undefined)
  for (const server of servers) await server.close().catch(() => undefined)
  clients = []
  servers = []
})

// ── Pure helpers ──────────────────────────────────────────────────

describe('buildHermesRpcUrl', () => {
  it('swaps http for ws and hangs the credential off /api/ws', () => {
    expect(buildHermesRpcUrl('http://127.0.0.1:9119', 'token', 'abc')).toBe(
      'ws://127.0.0.1:9119/api/ws?token=abc',
    )
  })

  it('swaps https for wss and strips a trailing slash', () => {
    expect(buildHermesRpcUrl('https://dash.example.com/', 'ticket', 'T1')).toBe(
      'wss://dash.example.com/api/ws?ticket=T1',
    )
  })

  it('percent-encodes credentials so a token with url metacharacters survives', () => {
    expect(buildHermesRpcUrl('http://127.0.0.1:9119', 'token', 'a+b/c=')).toBe(
      'ws://127.0.0.1:9119/api/ws?token=a%2Bb%2Fc%3D',
    )
  })
})

describe('parseRpcFrames', () => {
  it('splits newline-delimited frames', () => {
    const frames = parseRpcFrames('{"a":1}\n{"b":2}\n')
    expect(frames).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('drops malformed lines instead of throwing', () => {
    expect(parseRpcFrames('{"a":1}\nnot json\n{"b":2}')).toEqual([
      { a: 1 },
      { b: 2 },
    ])
  })
})

describe('classifyRpcFrame', () => {
  it('reads gateway.ready as an event, not a response', () => {
    const frame = classifyRpcFrame({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'gateway.ready', payload: { skin: {} } },
    })
    expect(frame.kind).toBe('event')
    expect(frame.kind === 'event' && frame.event.type).toBe('gateway.ready')
  })

  it('reads a result frame', () => {
    expect(classifyRpcFrame({ jsonrpc: '2.0', id: 7, result: { ok: 1 } })).toEqual({
      kind: 'result',
      id: 7,
      result: { ok: 1 },
    })
  })

  it('keeps the JSON-RPC error code', () => {
    const frame = classifyRpcFrame({
      jsonrpc: '2.0',
      id: 7,
      error: { code: 5020, message: 'boom' },
    })
    expect(frame).toEqual({
      kind: 'error',
      id: 7,
      error: { code: 5020, message: 'boom' },
    })
  })

  it('gives a null id to an unaddressed error so it settles no request', () => {
    const frame = classifyRpcFrame({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'parse error' },
    })
    expect(frame.kind === 'error' && frame.id).toBeNull()
  })

  it('classifies junk as unknown', () => {
    expect(classifyRpcFrame(null).kind).toBe('unknown')
    expect(classifyRpcFrame({ jsonrpc: '2.0' }).kind).toBe('unknown')
  })
})

describe('nextReconnectDelayMs', () => {
  it('backs off and caps', () => {
    expect(nextReconnectDelayMs(0)).toBe(1000)
    expect(nextReconnectDelayMs(2)).toBe(4000)
    expect(nextReconnectDelayMs(20)).toBe(30_000)
  })
})

// ── Transport behaviour ───────────────────────────────────────────

describe('HermesRpcClient over a live socket', () => {
  it('sends a JSON-RPC 2.0 envelope and resolves the result', async () => {
    const seen: Array<unknown> = []
    const server = await startFakeDashboard((req, send) => {
      seen.push(req)
      send({ jsonrpc: '2.0', id: req.id, result: { pairs: [['/help', 'Help']] } })
    })
    servers.push(server)

    const client = makeClient(server.port)
    const result = await client.request('commands.catalog', {})

    expect(result).toEqual({ pairs: [['/help', 'Help']] })
    expect(seen).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'commands.catalog', params: {} },
    ])
  })

  it('consumes gateway.ready without settling the request that follows it', async () => {
    const events: Array<string> = []
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: req.id, result: 'pong' })
    })
    servers.push(server)

    const client = makeClient(server.port)
    client.onEvent((event) => events.push(event.type))

    await expect(client.request('ping')).resolves.toBe('pong')
    expect(events).toContain('gateway.ready')
  })

  it('does not let an interleaved async event reject a pending request', async () => {
    const events: Array<{ type: string; payload?: unknown }> = []
    const server = await startFakeDashboard((req, send) => {
      // An unrelated notification lands between request and response.
      send({
        jsonrpc: '2.0',
        method: 'event',
        params: { type: 'background.complete', payload: { task_id: 'bg-1' } },
      })
      setTimeout(() => send({ jsonrpc: '2.0', id: req.id, result: 'late' }), 20)
    })
    servers.push(server)

    const client = makeClient(server.port)
    client.onEvent((event) => events.push(event))

    await expect(client.request('session.status')).resolves.toBe('late')
    expect(events.map((e) => e.type)).toEqual(['gateway.ready', 'background.complete'])
    expect(events[1].payload).toEqual({ task_id: 'bg-1' })
  })

  it('rejects with HermesRpcError carrying the agent error code', async () => {
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: req.id, error: { code: 5020, message: 'registry blew up' } })
    })
    servers.push(server)

    const client = makeClient(server.port)
    await expect(client.request('commands.catalog')).rejects.toMatchObject({
      name: 'HermesRpcError',
      code: 5020,
      message: 'registry blew up',
    })
    await expect(client.request('commands.catalog')).rejects.toBeInstanceOf(
      HermesRpcError,
    )
  })

  it('ignores an id:null parse-error reply rather than failing a live request', async () => {
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      setTimeout(() => send({ jsonrpc: '2.0', id: req.id, result: 'survived' }), 20)
    })
    servers.push(server)

    const client = makeClient(server.port)
    await expect(client.request('commands.catalog')).resolves.toBe('survived')
  })

  it('times out a request the server never answers', async () => {
    const server = await startFakeDashboard(() => {
      /* deliberately silent */
    })
    servers.push(server)

    const client = makeClient(server.port, { rpcTimeoutMs: 150 })
    await expect(client.request('commands.catalog')).rejects.toThrow(
      /Hermes RPC timeout after 150ms/,
    )
  })

  it('reconnects after the dashboard drops the socket', async () => {
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: req.id, result: 'ok' })
    })
    servers.push(server)

    const client = makeClient(server.port)
    // A listener keeps the socket wanted, which is what arms the reconnect.
    client.onEvent(() => undefined)

    await expect(client.request('one')).resolves.toBe('ok')
    expect(server.urls).toHaveLength(1)

    server.sockets[0].terminate()

    await vi.waitFor(
      () => {
        expect(server.urls.length).toBeGreaterThanOrEqual(2)
      },
      { timeout: 5000, interval: 50 },
    )
    await expect(client.request('two')).resolves.toBe('ok')
  }, 10_000)

  it('fails a request fast when the socket cannot be established at all', async () => {
    // Nothing is listening — a capability probe must not sit here for the
    // full RPC timeout waiting on a dashboard that is not running.
    const client = new HermesRpcClient({
      resolveUrl: () =>
        Promise.resolve({ url: 'ws://127.0.0.1:1/api/ws?token=x', mode: 'token' as const }),
      rpcTimeoutMs: 10_000,
      connectTimeoutMs: 2000,
    })
    clients.push(client)

    const started = Date.now()
    await expect(client.request('commands.catalog')).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('rejects everything in flight once shut down', async () => {
    const server = await startFakeDashboard(() => {
      /* silent */
    })
    servers.push(server)

    const client = makeClient(server.port)
    const pending = client.request('commands.catalog')
    await client.shutdown()
    await expect(pending).rejects.toThrow(/shut down/)
    await expect(client.request('anything')).rejects.toThrow(/shut down/)
  })
})

// ── Auth-mode detection ───────────────────────────────────────────

describe('HermesRpcClient auth mode', () => {
  it('uses ?ticket= when the dashboard mints one (gated mode)', async () => {
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: req.id, result: 'ok' })
    })
    servers.push(server)

    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response(JSON.stringify({ ticket: 'T-1', ttl_seconds: 30 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const client = new HermesRpcClient({
      baseUrl: () => `http://127.0.0.1:${server.port}`,
      rpcTimeoutMs: 2000,
      connectTimeoutMs: 2000,
    })
    clients.push(client)

    await expect(client.request('ping')).resolves.toBe('ok')
    expect(server.urls[0]).toBe('/api/ws?ticket=T-1')
    expect(client.getSnapshot().authMode).toBe('ticket')
    expect(getDashboardToken).not.toHaveBeenCalled()
  })

  it('falls back to ?token= when the ticket endpoint rejects (loopback mode)', async () => {
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: req.id, result: 'ok' })
    })
    servers.push(server)

    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('{"detail":"Unauthorized"}', { status: 401 }),
    )
    vi.mocked(getDashboardToken).mockResolvedValue('sess-token')

    const client = new HermesRpcClient({
      baseUrl: () => `http://127.0.0.1:${server.port}`,
      rpcTimeoutMs: 2000,
      connectTimeoutMs: 2000,
    })
    clients.push(client)

    await expect(client.request('ping')).resolves.toBe('ok')
    expect(server.urls[0]).toBe('/api/ws?token=sess-token')
    expect(client.getSnapshot().authMode).toBe('token')
  })

  it('mints a fresh single-use ticket per connection attempt', async () => {
    let minted = 0
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: req.id, result: 'ok' })
    })
    servers.push(server)

    vi.mocked(dashboardFetch).mockImplementation(() => {
      minted += 1
      return Promise.resolve(
        new Response(JSON.stringify({ ticket: `T-${minted}` }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    const client = new HermesRpcClient({
      baseUrl: () => `http://127.0.0.1:${server.port}`,
      rpcTimeoutMs: 2000,
      connectTimeoutMs: 2000,
    })
    clients.push(client)
    client.onEvent(() => undefined)

    await client.request('ping')
    server.sockets[0].terminate()

    await vi.waitFor(
      () => {
        expect(server.urls.length).toBeGreaterThanOrEqual(2)
      },
      { timeout: 5000, interval: 50 },
    )
    expect(server.urls[0]).toBe('/api/ws?ticket=T-1')
    expect(server.urls[1]).toBe('/api/ws?ticket=T-2')
  }, 10_000)

  it('fails without falling back to a token when a known-gated mint fails', async () => {
    const server = await startFakeDashboard((req, send) => {
      send({ jsonrpc: '2.0', id: req.id, result: 'ok' })
    })
    servers.push(server)

    vi.mocked(dashboardFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ticket: 'T-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.mocked(getDashboardToken).mockResolvedValue('sess-token')

    const client = new HermesRpcClient({
      baseUrl: () => `http://127.0.0.1:${server.port}`,
      rpcTimeoutMs: 2000,
      connectTimeoutMs: 2000,
    })
    clients.push(client)

    await client.request('ping')
    expect(client.getSnapshot().authMode).toBe('ticket')

    // Mint now fails; a gated dashboard rejects ?token= unconditionally, so
    // silently downgrading would just produce a confusing 4401.
    vi.mocked(dashboardFetch).mockResolvedValue(
      new Response('nope', { status: 500 }),
    )
    server.sockets[0].terminate()
    await vi.waitFor(() => {
      expect(client.getSnapshot().connected).toBe(false)
    })

    await expect(client.request('ping')).rejects.toThrow()
    expect(server.urls.every((url) => url.startsWith('/api/ws?ticket='))).toBe(true)
  }, 10_000)
})
