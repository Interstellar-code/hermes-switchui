import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getA2AFleetConversation,
  getA2AFleetConversations,
  getA2AFleetPeers,
} from './hermes-client'

describe('hermes-client A2A Fleet helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses dashboard proxy auth for the conversation list', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 0, conversations: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(getA2AFleetConversations()).resolves.toEqual({
      count: 0,
      conversations: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard-proxy/api/plugins/a2a_fleet/conversations',
      undefined,
    )
  })

  it('encodes context IDs that contain colons', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          contextId: 'handshake:hermes-switch',
          peer: 'Claude Code',
          repo_path: '/repo',
          messages: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    await getA2AFleetConversation('handshake:hermes-switch')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard-proxy/api/plugins/a2a_fleet/conversations/handshake%3Ahermes-switch',
      undefined,
    )
  })

  it('uses dashboard proxy auth for peers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 0, peers: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(getA2AFleetPeers()).resolves.toEqual({
      count: 0,
      peers: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard-proxy/api/plugins/a2a_fleet/peers',
      undefined,
    )
  })

  it('treats a stale-dashboard SPA fallback (200 text/html) as endpoint-unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><html><title>Hermes Agent - Dashboard</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    await expect(getA2AFleetConversations()).rejects.toThrow(
      /endpoint-unavailable/,
    )
  })
})
