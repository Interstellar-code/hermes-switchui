// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreamingMessage } from './use-streaming-message'
import { useChatStore } from '@/stores/chat-store'

/**
 * Issue #353 — the approval never reached the card because
 * `use-streaming-message.ts`'s `case 'clarify':` built its store event without
 * `payload.kind`, `payload.toolName` or any approval fields, while the sibling
 * resolved-case forwarded them. Everything downstream (`kind === 'approval'`
 * copy, the decision card, the resolve POST) keys off exactly those fields, so
 * nothing could work until this hop stopped dropping them.
 *
 * These drive the REAL hook against a REAL send-stream response body. A test
 * that called `processEvent` directly would pass with the bug still in place.
 */

const SESSION = 'sess-approval'

/** A browser-side send-stream frame, exactly as `send-stream.ts` writes it. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function streamResponse(body: string): Response {
  const encoder = new TextEncoder()
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
  } as unknown as Response
}

async function runStream(body: string) {
  vi.stubGlobal('fetch', vi.fn(async () => streamResponse(body)))
  const { result } = renderHook(() => useStreamingMessage())
  await act(async () => {
    await result.current.startStreaming({
      sessionKey: SESSION,
      friendlyId: SESSION,
      message: 'go',
    })
  })
  return result
}

const APPROVAL_PAYLOAD = {
  clarifyId: 'approval_ab12cd34ef',
  kind: 'approval',
  toolName: 'approval',
  question: 'copy/move file into system config path',
  choices: ['once', 'session', 'always', 'deny'],
  approval: {
    run_id: 'run_1111',
    command: 'cp ./x /etc/systemd/system/x.service',
    description: 'copy/move file into system config path',
    pattern_keys: ['shell-c'],
    allow_permanent: true,
    expires_at: '2126-08-10T09:31:00Z',
  },
  sessionKey: SESSION,
}

beforeEach(() => {
  useChatStore.setState({ pendingClarify: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useChatStore.setState({ pendingClarify: {} })
})

describe('use-streaming-message — clarify → approval', () => {
  it('forwards kind and toolName that the clarify case used to drop', async () => {
    await runStream(
      frame('started', { runId: 'run_1111', sessionKey: SESSION }) +
        frame('clarify', APPROVAL_PAYLOAD),
    )

    await waitFor(() => {
      const card = useChatStore.getState().getPendingClarify(SESSION)
      expect(card?.kind).toBe('approval')
      expect(card?.toolName).toBe('approval')
    })
  })

  it('carries every approval field through to the store', async () => {
    await runStream(
      frame('started', { runId: 'run_1111', sessionKey: SESSION }) +
        frame('clarify', APPROVAL_PAYLOAD),
    )

    await waitFor(() => {
      const card = useChatStore.getState().getPendingClarify(SESSION)
      expect(card?.approval).toEqual({
        runId: 'run_1111',
        command: 'cp ./x /etc/systemd/system/x.service',
        description: 'copy/move file into system config path',
        patternKey: undefined,
        patternKeys: ['shell-c'],
        allowPermanent: true,
        smartDenied: undefined,
        expiresAt: '2126-08-10T09:31:00Z',
      })
      // Resolution is keyed by the payload's run id, not the stream's.
      expect(card?.runId).toBe('run_1111')
      expect(card?.choices).toEqual(['once', 'session', 'always', 'deny'])
    })
  })

  it('leaves an ordinary clarify with no approval payload', async () => {
    await runStream(
      frame('started', { runId: 'run_2', sessionKey: SESSION }) +
        frame('clarify', {
          clarifyId: 'clarify-9',
          kind: 'choice',
          question: 'Which file?',
          choices: ['a.ts', 'b.ts'],
          sessionKey: SESSION,
        }),
    )

    await waitFor(() => {
      const card = useChatStore.getState().getPendingClarify(SESSION)
      expect(card?.kind).toBe('choice')
      expect(card?.approval).toBeUndefined()
    })
  })
})

/**
 * The server emits a bare `error` event (SEND_STREAM_RUN_TIMEOUT_MS, ~600s)
 * or a `done` with state:'error' well before the answer can arrive, and a
 * `started` on stream resume can race an unresolved approval too. Losing the
 * card client-side in any of these cases does not unblock the run — the
 * gateway is still waiting on `POST /v1/runs/{runId}/approval` — so an
 * unanswered approval card must survive all three. Non-approval clarify
 * kinds keep being torn down exactly as before.
 */
describe('use-streaming-message — approvals survive a dead stream', () => {
  it('survives a bare `error` event', async () => {
    await runStream(
      frame('started', { runId: 'run_1111', sessionKey: SESSION }) +
        frame('clarify', APPROVAL_PAYLOAD) +
        frame('error', { message: 'Stream timeout' }),
    )

    const card = useChatStore.getState().getPendingClarify(SESSION)
    expect(card?.kind).toBe('approval')
    expect(card?.approval?.runId).toBe('run_1111')
  })

  it('survives a `done` event with state: "error"', async () => {
    await runStream(
      frame('started', { runId: 'run_1111', sessionKey: SESSION }) +
        frame('clarify', APPROVAL_PAYLOAD) +
        frame('done', { state: 'error', errorMessage: 'Stream timeout' }),
    )

    const card = useChatStore.getState().getPendingClarify(SESSION)
    expect(card?.kind).toBe('approval')
    expect(card?.approval?.runId).toBe('run_1111')
  })

  it('a non-approval clarify is still cleared by a `started` event', async () => {
    // Sanity check on the exemption: a NON-approval clarify must still be
    // cleared by `started` exactly like today, so the exemption is scoped to
    // `kind === 'approval'` and not accidentally blanket.
    await runStream(
      frame('started', { runId: 'run_3', sessionKey: SESSION }) +
        frame('clarify', {
          clarifyId: 'clarify-10',
          kind: 'choice',
          question: 'Which file?',
          choices: ['a.ts', 'b.ts'],
          sessionKey: SESSION,
        }) +
        frame('started', { runId: 'run_3', sessionKey: SESSION }),
    )

    const card = useChatStore.getState().getPendingClarify(SESSION)
    expect(card).toBeNull()
  })

  it('a non-approval clarify is still cleared by a bare `error` event', async () => {
    await runStream(
      frame('started', { runId: 'run_4', sessionKey: SESSION }) +
        frame('clarify', {
          clarifyId: 'clarify-11',
          kind: 'text',
          question: 'What should I name it?',
          choices: null,
          sessionKey: SESSION,
        }) +
        frame('error', { message: 'Stream timeout' }),
    )

    const card = useChatStore.getState().getPendingClarify(SESSION)
    expect(card).toBeNull()
  })

  it('a non-approval clarify is still cleared by `done` with state: "error"', async () => {
    await runStream(
      frame('started', { runId: 'run_5', sessionKey: SESSION }) +
        frame('clarify', {
          clarifyId: 'clarify-12',
          kind: 'text',
          question: 'What should I name it?',
          choices: null,
          sessionKey: SESSION,
        }) +
        frame('done', { state: 'error', errorMessage: 'Stream timeout' }),
    )

    const card = useChatStore.getState().getPendingClarify(SESSION)
    expect(card).toBeNull()
  })
})
