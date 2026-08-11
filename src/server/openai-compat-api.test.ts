import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildRequestBody, parseOpenAIStream } from './openai-compat-api'

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

// ─── buildRequestBody / getDefaultModel (task #26 item 4) ──────────────────
//
// `GET /v1/models` on the gateway is the server's own advertised identity
// plus configured `model_routes` aliases, NOT a model catalog. Sending that
// identity back as an explicit `model` is a deliberate no-op per the gateway
// contract, so picking one from `/v1/models` to use as "the default model"
// risked sending a `model_routes` alias as if it were a real selection.
// Omitting `model` achieves the identical effective result with no fetch.

describe('buildRequestBody', () => {
  const originalEnv = process.env.CLAUDE_DEFAULT_MODEL

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_DEFAULT_MODEL
    else process.env.CLAUDE_DEFAULT_MODEL = originalEnv
    vi.restoreAllMocks()
  })

  it('omits `model` entirely when none is selected and no env override is set', async () => {
    delete process.env.CLAUDE_DEFAULT_MODEL
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const body = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      stream: false,
    })

    expect(body).not.toHaveProperty('model')
    // No /v1/models lookup — the gateway's identity endpoint must never be
    // queried just to fill in a default model.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes an explicit model straight through untouched', async () => {
    const body = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      stream: false,
      model: 'openai/gpt-4o',
    })

    expect(body.model).toBe('openai/gpt-4o')
  })

  it('treats the "default" sentinel the same as an unset model', async () => {
    delete process.env.CLAUDE_DEFAULT_MODEL

    const body = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      stream: false,
      model: 'default',
    })

    expect(body).not.toHaveProperty('model')
  })

  it('uses CLAUDE_DEFAULT_MODEL as the one legitimate override', async () => {
    process.env.CLAUDE_DEFAULT_MODEL = 'operator/preferred-model'

    const body = await buildRequestBody([{ role: 'user', content: 'hi' }], {
      stream: false,
    })

    expect(body.model).toBe('operator/preferred-model')
  })
})
