import { afterEach, describe, expect, it, vi } from 'vitest'

import { openaiChat, parseOpenAIStream } from './openai-compat-api'

function createStreamResponse(chunks: Array<string>): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
      },
    },
  )
}

describe('parseOpenAIStream', () => {
  it('passes through ordinary content chunks', async () => {
    const response = createStreamResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = []
    for await (const chunk of parseOpenAIStream(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'content', text: 'Hello' },
      { type: 'content', text: ' world' },
    ])
  })

  it('emits synthetic tool events for Hermes tool progress frames', async () => {
    const response = createStreamResponse([
      'event: claude.tool.progress\n',
      'data: {"tool":"terminal","emoji":"💻","label":"ls -la"}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = []
    for await (const chunk of parseOpenAIStream(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      {
        type: 'tool',
        name: 'terminal',
        label: '💻 ls -la',
      },
    ])
  })

  it('handles multiple tool events even when frames are split across transport chunks', async () => {
    const response = createStreamResponse([
      'event: claude.tool.progress\ndata: {"tool":"browser_get_images","emoji":"📖","la',
      'bel":"scan page"}\n\n',
      'event: claude.tool.progress\ndata: {"tool":"browser_console","emoji":"🔎","label":"inspect DOM"}\n\n',
      'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
      'data: [DONE]\n\n',
    ])

    const chunks = []
    for await (const chunk of parseOpenAIStream(response)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      {
        type: 'tool',
        name: 'browser_get_images',
        label: '📖 scan page',
      },
      {
        type: 'tool',
        name: 'browser_console',
        label: '🔎 inspect DOM',
      },
      { type: 'content', text: 'done' },
    ])
  })
})

describe('openaiChat gateway auth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.HERMES_API_TOKEN
    delete process.env.CLAUDE_API_TOKEN
    delete process.env.OPENAI_API_KEY
  })

  it('does not send unrelated OPENAI_API_KEY credentials to the Hermes gateway', async () => {
    process.env.OPENAI_API_KEY = 'not-a-hermes-gateway-token'
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await openaiChat([{ role: 'user', content: 'hi' }], { model: 'test-model' })

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined()
  })

  it('sends only Hermes gateway tokens when configured', async () => {
    process.env.HERMES_API_TOKEN = 'hermes-token'
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await openaiChat([{ role: 'user', content: 'hi' }], { model: 'test-model' })

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer hermes-token',
    )
  })
})
