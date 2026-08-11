// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isEventStreamResponse,
  parseModelErrorEnvelope,
  useStreamingMessage,
} from './use-streaming-message'
import { useChatStore } from '@/stores/chat-store'

/**
 * Task #24 — per-session model switching.
 *
 * These drive the REAL hook against REAL response bodies, because every bug
 * this covers lives in the transport hop: a JSON 400 fed to the SSE parser, an
 * HTTP 200 whose assistant message is the provider's refusal, and the
 * difference between the model we sent and the model that answered.
 */

const SESSION = 'sess-model-switch'

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function streamResponse(body: string): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    },
  )
}

/** The gateway's pre-stream refusal, verbatim shape. */
function modelErrorResponse(status: number, code: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: `Model "definitely-not-a-real-model-xyz" is not available.`,
        type: 'invalid_request_error',
        param: 'model',
        code,
      },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

async function runStream(
  response: Response,
  params: { model?: string } = {},
) {
  vi.stubGlobal('fetch', vi.fn(async () => response))
  const { result } = renderHook(() => useStreamingMessage())
  await act(async () => {
    await result.current.startStreaming({
      sessionKey: SESSION,
      friendlyId: SESSION,
      message: 'go',
      ...params,
    })
  })
  return result
}

function reset() {
  useChatStore.setState({ modelSwitch: {} })
}

beforeEach(reset)
afterEach(() => {
  vi.unstubAllGlobals()
  reset()
})

// ─── pure helpers ──────────────────────────────────────────────────────────

describe('parseModelErrorEnvelope', () => {
  it('reads the OpenAI-style envelope the gateway returns for a bad model', () => {
    expect(
      parseModelErrorEnvelope(
        '{"error":{"message":"no","type":"invalid_request_error","param":"model","code":"model_not_available"}}',
      ),
    ).toEqual({ message: 'no', code: 'model_not_available', param: 'model' })
  })

  it('accepts invalid_model even without a param', () => {
    expect(
      parseModelErrorEnvelope('{"error":{"message":"bad","code":"invalid_model"}}'),
    ).toEqual({ message: 'bad', code: 'invalid_model', param: null })
  })

  it('ignores an error envelope that is not about the model', () => {
    expect(
      parseModelErrorEnvelope(
        '{"error":{"message":"rate limited","param":"messages","code":"rate_limit"}}',
      ),
    ).toBe(null)
  })

  it('ignores non-JSON bodies', () => {
    expect(parseModelErrorEnvelope('<html>502</html>')).toBe(null)
  })
})

describe('isEventStreamResponse', () => {
  it('rejects a JSON body', () => {
    expect(
      isEventStreamResponse({ headers: new Headers({ 'content-type': 'application/json' }) }),
    ).toBe(false)
  })

  it('accepts an SSE body', () => {
    expect(
      isEventStreamResponse({
        headers: new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }),
      }),
    ).toBe(true)
  })

  it('treats an absent Content-Type as inconclusive, not a refusal', () => {
    expect(isEventStreamResponse({ headers: new Headers() })).toBe(true)
  })
})

// ─── FAILURE SHAPE 1: non-SSE 400 before the stream opens ──────────────────

describe('non-SSE 400 on the send endpoint', () => {
  it('surfaces error.message instead of feeding JSON to the SSE parser', async () => {
    const errors: Array<string> = []
    vi.stubGlobal('fetch', vi.fn(async () => modelErrorResponse(400, 'model_not_available')))
    const { result } = renderHook(() =>
      useStreamingMessage({ onError: (message) => errors.push(message) }),
    )
    await act(async () => {
      await result.current.startStreaming({
        sessionKey: SESSION,
        friendlyId: SESSION,
        message: 'go',
        model: 'definitely-not-a-real-model-xyz',
      })
    })

    await waitFor(() => {
      expect(errors).toEqual([
        'Model "definitely-not-a-real-model-xyz" is not available.',
      ])
    })
  })

  it('leaves the selection unchanged — the session never moved off the old model', async () => {
    // Establish a confirmed model first.
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          frame('model_effective', { model: 'openai/gpt-4o', sessionKey: SESSION }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'openai/gpt-4o' },
    )
    expect(useChatStore.getState().getModelSwitch(SESSION).effective).toBe(
      'openai/gpt-4o',
    )

    await runStream(modelErrorResponse(400, 'model_not_available'), {
      model: 'definitely-not-a-real-model-xyz',
    })

    const state = useChatStore.getState().getModelSwitch(SESSION)
    expect(state.effective).toBe('openai/gpt-4o')
    expect(state.error).toMatchObject({
      shape: 'http-400',
      code: 'model_not_available',
      revertTo: 'openai/gpt-4o',
    })
    expect(state.pending).toBe(false)
  })

  it('handles the same envelope relayed as an SSE `error` event', async () => {
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          frame('error', {
            message: 'Model "bogus" is not available.',
            sessionKey: SESSION,
            modelError: {
              message: 'Model "bogus" is not available.',
              code: 'model_not_available',
              param: 'model',
            },
          }),
      ),
      { model: 'bogus' },
    )

    await waitFor(() => {
      expect(useChatStore.getState().getModelSwitch(SESSION).error).toMatchObject(
        { shape: 'http-400', code: 'model_not_available' },
      )
    })
  })
})

// ─── FAILURE SHAPE 2: HTTP 200 whose assistant message is the refusal ──────

const AGGREGATOR_REJECTION =
  '[🦚 Manifest M302] Model "definitely-not-a-real-model-xyz" is not available ' +
  'for this agent. Use GET /v1/models to list available model IDs.'

describe('provider rejection arriving as a successful turn', () => {
  it('detects it and reverts the selection', async () => {
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          frame('model_effective', { model: 'openai/gpt-4o', sessionKey: SESSION }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'openai/gpt-4o' },
    )

    await runStream(
      streamResponse(
        frame('started', { runId: 'r2', sessionKey: SESSION }) +
          frame('model_effective', {
            model: 'definitely-not-a-real-model-xyz',
            sessionKey: SESSION,
          }) +
          frame('chunk', { text: AGGREGATOR_REJECTION, sessionKey: SESSION }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'definitely-not-a-real-model-xyz' },
    )

    await waitFor(() => {
      const state = useChatStore.getState().getModelSwitch(SESSION)
      expect(state.error).toMatchObject({
        shape: 'provider-rejection',
        revertTo: 'openai/gpt-4o',
      })
      // Un-wedged: the chip is back on the model that actually works.
      expect(state.effective).toBe('openai/gpt-4o')
    })
  })

  it('does NOT misdetect a legitimate assistant message about model availability', async () => {
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          frame('model_effective', {
            model: 'anthropic/claude-opus-4',
            sessionKey: SESSION,
          }) +
          frame('chunk', {
            text:
              'Model availability depends on your plan. Some accounts see the ' +
              'whole catalogue and others only a subset, so if a pick does not ' +
              'appear it is usually the aggregator tier rather than anything ' +
              'wrong with your configuration. Happy to walk through routing.',
            sessionKey: SESSION,
          }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'anthropic/claude-opus-4' },
    )

    await waitFor(() => {
      const state = useChatStore.getState().getModelSwitch(SESSION)
      expect(state.error).toBe(null)
      expect(state.effective).toBe('anthropic/claude-opus-4')
    })
  })

  it('does not re-check a turn that resent an already-installed model', async () => {
    // Turn 1 installs the model; turn 2 resends it and happens to quote a
    // refusal (e.g. the user pasted one). Only the installing turn is checked.
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          frame('model_effective', { model: 'openai/gpt-4o', sessionKey: SESSION }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'openai/gpt-4o' },
    )

    await runStream(
      streamResponse(
        frame('started', { runId: 'r2', sessionKey: SESSION }) +
          frame('chunk', {
            text: 'Model "openai/gpt-4o" is not available, you said?',
            sessionKey: SESSION,
          }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'openai/gpt-4o' },
    )

    expect(useChatStore.getState().getModelSwitch(SESSION).error).toBe(null)
  })
})

// ─── pending state + server-reported effective model ───────────────────────

describe('switching-model pending state', () => {
  it('is set while a send carrying a CHANGED model is in flight', async () => {
    const seen: Array<boolean> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        seen.push(useChatStore.getState().getModelSwitch(SESSION).pending)
        return streamResponse(frame('done', { state: 'complete', sessionKey: SESSION }))
      }),
    )
    const { result } = renderHook(() => useStreamingMessage())
    await act(async () => {
      await result.current.startStreaming({
        sessionKey: SESSION,
        friendlyId: SESSION,
        message: 'go',
        model: 'anthropic/claude-opus-4',
      })
    })

    expect(seen).toEqual([true])
  })

  it('is NOT set when the send repeats the model the server already confirmed', async () => {
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          frame('model_effective', { model: 'openai/gpt-4o', sessionKey: SESSION }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'openai/gpt-4o' },
    )

    const seen: Array<boolean> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        seen.push(useChatStore.getState().getModelSwitch(SESSION).pending)
        return streamResponse(frame('done', { state: 'complete', sessionKey: SESSION }))
      }),
    )
    const { result } = renderHook(() => useStreamingMessage())
    await act(async () => {
      await result.current.startStreaming({
        sessionKey: SESSION,
        friendlyId: SESSION,
        message: 'again',
        model: 'openai/gpt-4o',
      })
    })

    expect(seen).toEqual([false])
  })

  it('clears once the server reports the effective model', async () => {
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          frame('model_effective', {
            model: 'anthropic/claude-opus-4',
            sessionKey: SESSION,
          }),
      ),
      { model: 'anthropic/claude-opus-4' },
    )

    expect(useChatStore.getState().getModelSwitch(SESSION).pending).toBe(false)
  })
})

describe('effective model comes from the server', () => {
  it('records run.started`s model even when it differs from what was sent', async () => {
    await runStream(
      streamResponse(
        frame('started', { runId: 'r1', sessionKey: SESSION }) +
          // Silent server-side fallback: we asked for an alias, this answered.
          frame('model_effective', {
            model: 'openai/gpt-4o-mini',
            sessionKey: SESSION,
          }) +
          frame('done', { state: 'complete', sessionKey: SESSION }),
      ),
      { model: 'fast-alias' },
    )

    const state = useChatStore.getState().getModelSwitch(SESSION)
    expect(state.requested).toBe('fast-alias')
    expect(state.effective).toBe('openai/gpt-4o-mini')
  })
})
