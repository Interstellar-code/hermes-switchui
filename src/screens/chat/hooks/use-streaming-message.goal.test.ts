// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreamingMessage } from './use-streaming-message'
import { useChatStore } from '@/stores/chat-store'
import { useGoalProgressStore } from '@/stores/goal-progress-store'

/**
 * Standing-goal continuations, driven through the REAL hook against a REAL
 * send-stream body.
 *
 * ── What is being defended ────────────────────────────────────────────────
 * A goal continuation is a new assistant TURN inside one run: the gateway
 * emits `assistant.completed` for turn 1, then `goal.status` (the judge's
 * verdict on it), then `goal.continuation` carrying a NEW message id, then the
 * next turn's deltas. Measured live on a throwaway session, 2026-08-13.
 *
 * The hook accumulates text per SESSION, not per message, so without a turn
 * boundary turn 2's deltas append to turn 1's text and the whole run renders as
 * one giant merged message. That is the visible failure mode, and it is what
 * the first test here would catch.
 *
 * The frames below are what `routes/api/send-stream.ts` writes to the browser
 * (`goal_status` / `goal_continuation`), not the gateway's own event names.
 */

const SESSION = 'sess-goal'

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
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(streamResponse(body))),
  )
  const { result } = renderHook(() => useStreamingMessage())
  await act(async () => {
    await result.current.startStreaming({
      sessionKey: SESSION,
      friendlyId: SESSION,
      message: 'Begin.',
    })
  })
  return result
}

function assistantTexts(): Array<string> {
  return useChatStore
    .getState()
    .getRealtimeMessages(SESSION)
    .filter((message) => message.role === 'assistant')
    .map((message) =>
      (message.content ?? [])
        .filter((part) => (part as { type?: string }).type === 'text')
        .map((part) => (part as { text?: string }).text ?? '')
        .join(''),
    )
}

/** The three-turn run measured live, in send-stream's own vocabulary. */
const CONTINUATION_RUN =
  frame('started', { runId: 'run_goal_1', sessionKey: SESSION }) +
  frame('chunk', { text: '1', sessionKey: SESSION, runId: 'run_goal_1' }) +
  frame('goal_status', {
    message: '↻ Continuing toward goal (1/3): the count has not started.',
    status: 'active',
    verdict: 'continue',
    shouldContinue: true,
    capped: false,
    turnsUsed: 1,
    maxTurns: 3,
    messageId: 'msg_a',
    sessionKey: SESSION,
    runId: 'run_goal_1',
  }) +
  frame('goal_continuation', {
    messageId: 'msg_b',
    turn: 1,
    turnsUsed: 1,
    maxTurns: 3,
    status: 'active',
    sessionKey: SESSION,
    runId: 'run_goal_1',
  }) +
  frame('chunk', { text: '2', sessionKey: SESSION, runId: 'run_goal_1' }) +
  frame('goal_status', {
    message: '↻ Continuing toward goal (2/3): 2 sent, 3 still owed.',
    status: 'active',
    verdict: 'continue',
    shouldContinue: true,
    capped: false,
    turnsUsed: 2,
    maxTurns: 3,
    messageId: 'msg_b',
    sessionKey: SESSION,
    runId: 'run_goal_1',
  }) +
  frame('goal_continuation', {
    messageId: 'msg_c',
    turn: 2,
    turnsUsed: 2,
    maxTurns: 3,
    status: 'active',
    sessionKey: SESSION,
    runId: 'run_goal_1',
  }) +
  frame('chunk', { text: '3\n\nDONE', sessionKey: SESSION, runId: 'run_goal_1' }) +
  frame('goal_status', {
    message: '✓ Goal achieved — the count reached 3 and DONE was sent.',
    status: 'done',
    verdict: 'done',
    shouldContinue: false,
    capped: false,
    turnsUsed: 3,
    maxTurns: 3,
    messageId: 'msg_c',
    sessionKey: SESSION,
    runId: 'run_goal_1',
  }) +
  frame('done', { state: 'complete', sessionKey: SESSION, runId: 'run_goal_1' })

beforeEach(() => {
  useChatStore.setState({
    realtimeMessages: new Map(),
    streamingState: new Map(),
  })
  useGoalProgressStore.setState({ bySession: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useChatStore.setState({
    realtimeMessages: new Map(),
    streamingState: new Map(),
  })
  useGoalProgressStore.setState({ bySession: {} })
})

describe('use-streaming-message — goal continuations', () => {
  it('renders each continuation as its own assistant message', async () => {
    await runStream(CONTINUATION_RUN)

    await waitFor(() => {
      expect(assistantTexts()).toEqual(['1', '2', '3\n\nDONE'])
    })
    // The failure this guards against is subtle: with the boundary removed the
    // suite still "passes" a length check if you only assert the last message,
    // because the merged text ENDS with the final turn. Assert the whole list.
    expect(assistantTexts().join('|')).not.toContain('12')
  })

  it('records the judge’s verdicts with their turn counters', async () => {
    await runStream(CONTINUATION_RUN)

    await waitFor(() => {
      const entries = useGoalProgressStore.getState().bySession[SESSION] ?? []
      expect(entries).toHaveLength(3)
      expect(entries.map((entry) => entry.turnsUsed)).toEqual([1, 2, 3])
      expect(entries[0].message).toMatch(/Continuing toward goal \(1\/3\)/)
      expect(entries[2].status).toBe('done')
      expect(entries[2].shouldContinue).toBe(false)
      expect(entries[2].maxTurns).toBe(3)
    })
  })

  it('drops the previous run’s verdicts when a new run starts', async () => {
    await runStream(CONTINUATION_RUN)
    await waitFor(() =>
      expect(useGoalProgressStore.getState().bySession[SESSION]).toHaveLength(3),
    )

    await runStream(
      frame('started', { runId: 'run_goal_2', sessionKey: SESSION }) +
        frame('chunk', { text: 'ok', sessionKey: SESSION, runId: 'run_goal_2' }) +
        frame('done', { state: 'complete', sessionKey: SESSION, runId: 'run_goal_2' }),
    )

    await waitFor(() =>
      expect(
        useGoalProgressStore.getState().bySession[SESSION] ?? [],
      ).toHaveLength(0),
    )
  })

  it('is inert for the 99% case — a run with no goal is unchanged', async () => {
    // Neither event fires unless the session has a goal, so the ordinary path
    // must be untouched: one message, no goal card.
    await runStream(
      frame('started', { runId: 'run_plain', sessionKey: SESSION }) +
        // Deltas accumulate — this is `assistant.delta` twice, not a replace.
        frame('chunk', { text: 'hello ', sessionKey: SESSION, runId: 'run_plain' }) +
        frame('chunk', { text: 'there', sessionKey: SESSION, runId: 'run_plain' }) +
        frame('done', { state: 'complete', sessionKey: SESSION, runId: 'run_plain' }),
    )

    await waitFor(() => expect(assistantTexts()).toEqual(['hello there']))
    expect(useGoalProgressStore.getState().bySession[SESSION] ?? []).toHaveLength(
      0,
    )
  })

  it('ignores an unknown event instead of failing the stream', async () => {
    // The gateway warns that clients which hard-fail on unrecognised SSE events
    // break on every additive change — which is exactly how goal.status and
    // goal.continuation arrived. The switch has no `default:` arm, and that
    // tolerance is load-bearing rather than an oversight.
    await runStream(
      frame('started', { runId: 'run_odd', sessionKey: SESSION }) +
        frame('goal.telepathy', { nothing: true, sessionKey: SESSION }) +
        frame('chunk', { text: 'still fine', sessionKey: SESSION, runId: 'run_odd' }) +
        frame('done', { state: 'complete', sessionKey: SESSION, runId: 'run_odd' }),
    )

    await waitFor(() => expect(assistantTexts()).toEqual(['still fine']))
  })

  it('keeps a goal_status with no message off the card', async () => {
    // `goal.status` is only emitted when the judge produced a line, but the
    // browser must not render an empty card if that ever changes.
    await runStream(
      frame('started', { runId: 'run_blank', sessionKey: SESSION }) +
        frame('goal_status', {
          message: '',
          status: 'active',
          shouldContinue: true,
          turnsUsed: 1,
          maxTurns: 20,
          sessionKey: SESSION,
        }) +
        frame('chunk', { text: 'x', sessionKey: SESSION, runId: 'run_blank' }) +
        frame('done', { state: 'complete', sessionKey: SESSION, runId: 'run_blank' }),
    )

    await waitFor(() => expect(assistantTexts()).toEqual(['x']))
    expect(useGoalProgressStore.getState().bySession[SESSION] ?? []).toHaveLength(
      0,
    )
  })
})
