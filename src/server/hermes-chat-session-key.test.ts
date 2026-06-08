import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendChat, streamChat } from './hermes-api'
import { openaiChat } from './openai-compat-api'
import { streamResponses } from './responses-api'

function headersFromFetchCall(call: Array<unknown>): Headers {
  const init = call[1] as RequestInit
  return new Headers(init.headers)
}

function sseResponse(payloads: Array<Record<string, unknown>>): Response {
  const body = payloads
    .map((payload) => `data: ${JSON.stringify(payload)}\n\n`)
    .join('')
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('Hermes chat session key forwarding', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards X-Hermes-Session-Key on enhanced streaming chat', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ delta: 'ok' }]))

    await streamChat(
      'transcript-session-1',
      { message: 'hello' },
      { stableSessionKey: 'stable-chat-1', onEvent: vi.fn() },
    )

    expect(
      headersFromFetchCall(fetchSpy.mock.calls[0]).get('X-Hermes-Session-Key'),
    ).toBe('stable-chat-1')
  })

  it('forwards X-Hermes-Session-Key on enhanced non-streaming chat', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ ok: true }))

    await sendChat('transcript-session-2', { message: 'hello' }, undefined, {
      stableSessionKey: 'stable-chat-2',
    })

    expect(
      headersFromFetchCall(fetchSpy.mock.calls[0]).get('X-Hermes-Session-Key'),
    ).toBe('stable-chat-2')
  })

  it('forwards X-Hermes-Session-Key on Hermes Responses API chat', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(sseResponse([{ type: 'response.completed' }]))

    for await (const _ of streamResponses({
      input: 'hello',
      sessionId: 'transcript-session-3',
      stableSessionKey: 'stable-chat-3',
    })) {
      // consume stream
    }

    expect(
      headersFromFetchCall(fetchSpy.mock.calls[0]).get('X-Hermes-Session-Key'),
    ).toBe('stable-chat-3')
  })

  it('forwards X-Hermes-Session-Key on Hermes OpenAI-compatible chat', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: 'ok' } }] }),
      )

    await openaiChat([{ role: 'user', content: 'hello' }], {
      model: 'test-model',
      sessionId: 'transcript-session-4',
      stableSessionKey: 'stable-chat-4',
      stream: false,
    })

    expect(
      headersFromFetchCall(fetchSpy.mock.calls[0]).get('X-Hermes-Session-Key'),
    ).toBe('stable-chat-4')
  })

  it('does not send Hermes session key headers to local-provider base URLs', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: 'ok' } }] }),
      )

    await openaiChat([{ role: 'user', content: 'hello' }], {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'test-model',
      sessionId: 'local-session',
      stableSessionKey: 'stable-chat-local',
      stream: false,
    })

    expect(
      headersFromFetchCall(fetchSpy.mock.calls[0]).get('X-Hermes-Session-Key'),
    ).toBeNull()
  })
})
