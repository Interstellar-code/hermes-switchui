import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveSessionKeyValue } from '../lib/send-stream-session-headers'
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

describe('resolveSessionKeyValue', () => {
  it('prefers a non-empty stableSessionKey over sessionId', () => {
    expect(
      resolveSessionKeyValue({
        stableSessionKey: 'stable-1',
        sessionId: 'transcript-1',
      }),
    ).toBe('stable-1')
  })

  it.each([
    ['absent', undefined],
    ['empty string', ''],
    ['whitespace-only', '   '],
  ])('falls back to sessionId when stableSessionKey is %s', (_label, value) => {
    expect(
      resolveSessionKeyValue({
        stableSessionKey: value,
        sessionId: 'transcript-2',
      }),
    ).toBe('transcript-2')
  })

  it('trims surrounding whitespace on both inputs', () => {
    expect(
      resolveSessionKeyValue({
        stableSessionKey: '  stable-3  ',
        sessionId: 'transcript-3',
      }),
    ).toBe('stable-3')
    expect(
      resolveSessionKeyValue({
        stableSessionKey: undefined,
        sessionId: '  transcript-3  ',
      }),
    ).toBe('transcript-3')
  })

  it('returns an empty string when neither is present', () => {
    expect(resolveSessionKeyValue({})).toBe('')
  })
})

// Shared by the "every transport agrees" tests below. A plain JSON body is
// deliberately used for every transport (not just the non-streaming ones):
// streamChat/streamResponses's SSE line-parsers simply find no "event:"/
// "data:"/"\n\n" boundaries in `{"ok":true}` and complete with zero events,
// so this one fetch mock exercises all four transports without throwing —
// unlike an SSE-shaped body, which is invalid JSON and would make the
// non-streaming transports (sendChat, openaiChat non-stream) reject on
// `res.json()`.
function jsonResponse(): Response {
  return Response.json({ ok: true })
}

// Each transport is exercised in isolation with a fresh fetch spy so a
// per-transport bug can't be masked by an earlier transport's call.
async function captureSessionKeyHeader(
  run: () => Promise<unknown>,
): Promise<string | null> {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(jsonResponse())
  await run().catch(() => {})
  const header = fetchSpy.mock.calls.length
    ? headersFromFetchCall(fetchSpy.mock.calls[0]).get('X-Hermes-Session-Key')
    : null
  fetchSpy.mockRestore()
  return header
}

describe('Every chat transport derives the identical session-key header value', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('agrees on the header value when stableSessionKey and sessionId are both set', async () => {
    const seen: Record<string, string | null> = {}

    seen.streamChat = await captureSessionKeyHeader(() =>
      streamChat(
        'shared-session-id',
        { message: 'hi' },
        { stableSessionKey: 'shared-stable-key', onEvent: vi.fn() },
      ),
    )
    seen.sendChat = await captureSessionKeyHeader(() =>
      sendChat('shared-session-id', { message: 'hi' }, undefined, {
        stableSessionKey: 'shared-stable-key',
      }),
    )
    seen.streamResponses = await captureSessionKeyHeader(async () => {
      for await (const _ of streamResponses({
        input: 'hi',
        sessionId: 'shared-session-id',
        stableSessionKey: 'shared-stable-key',
      })) {
        // consume stream
      }
    })
    seen.openaiChat = await captureSessionKeyHeader(() =>
      openaiChat([{ role: 'user', content: 'hi' }], {
        // Explicit, so the request body is deterministic regardless of
        // getDefaultModel()'s CLAUDE_DEFAULT_MODEL env fallback.
        model: 'test-model',
        sessionId: 'shared-session-id',
        stableSessionKey: 'shared-stable-key',
        stream: false,
      }),
    )

    expect(seen.streamChat).toBe('shared-stable-key')
    expect(seen.sendChat).toBe('shared-stable-key')
    expect(seen.streamResponses).toBe('shared-stable-key')
    expect(seen.openaiChat).toBe('shared-stable-key')
  })

  it('agrees on the sessionId fallback when stableSessionKey is absent', async () => {
    const streamChatHeader = await captureSessionKeyHeader(() =>
      streamChat(
        'fallback-session-id',
        { message: 'hi' },
        { onEvent: vi.fn() },
      ),
    )
    const sendChatHeader = await captureSessionKeyHeader(() =>
      sendChat('fallback-session-id', { message: 'hi' }),
    )
    const streamResponsesHeader = await captureSessionKeyHeader(async () => {
      for await (const _ of streamResponses({
        input: 'hi',
        sessionId: 'fallback-session-id',
      })) {
        // consume stream
      }
    })
    const openaiChatHeader = await captureSessionKeyHeader(() =>
      openaiChat([{ role: 'user', content: 'hi' }], {
        model: 'test-model',
        sessionId: 'fallback-session-id',
        stream: false,
      }),
    )

    // Not omitted: every transport that sends the header for a session with
    // a stableSessionKey must also send it when stableSessionKey is absent,
    // falling back to sessionId — never silently dropping the header.
    expect(streamChatHeader).toBe('fallback-session-id')
    expect(sendChatHeader).toBe('fallback-session-id')
    expect(streamResponsesHeader).toBe('fallback-session-id')
    expect(openaiChatHeader).toBe('fallback-session-id')
  })

  it('agrees on the sessionId fallback when stableSessionKey is whitespace-only', async () => {
    const streamChatHeader = await captureSessionKeyHeader(() =>
      streamChat(
        'ws-session-id',
        { message: 'hi' },
        { stableSessionKey: '   ', onEvent: vi.fn() },
      ),
    )
    const openaiChatHeader = await captureSessionKeyHeader(() =>
      openaiChat([{ role: 'user', content: 'hi' }], {
        model: 'test-model',
        sessionId: 'ws-session-id',
        stableSessionKey: '   ',
        stream: false,
      }),
    )
    const streamResponsesHeader = await captureSessionKeyHeader(async () => {
      for await (const _ of streamResponses({
        input: 'hi',
        sessionId: 'ws-session-id',
        stableSessionKey: '   ',
      })) {
        // consume stream
      }
    })

    expect(streamChatHeader).toBe('ws-session-id')
    expect(openaiChatHeader).toBe('ws-session-id')
    expect(streamResponsesHeader).toBe('ws-session-id')
  })
})
