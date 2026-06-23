import { describe, expect, it } from 'vitest'

import { resolveOrphanedToolCards } from './-send-stream-orphan-tools'

describe('resolveOrphanedToolCards', () => {
  it('returns empty array when no cards are awaiting output (happy path)', () => {
    const events = resolveOrphanedToolCards({
      awaitingOutput: new Set(),
      toolStateByCallId: new Map(),
      sessionKey: 'session-1',
      runId: 'run-1',
    })
    expect(events).toEqual([])
  })

  it('emits a complete event for an orphaned tool card', () => {
    const awaitingOutput = new Set(['toolu_1'])
    const toolStateByCallId = new Map([
      ['toolu_1', { name: 'read_file', args: { path: '/tmp/foo.txt' } }],
    ])

    const events = resolveOrphanedToolCards({
      awaitingOutput,
      toolStateByCallId,
      sessionKey: 'session-1',
      runId: 'run-1',
    })

    expect(events).toEqual([
      {
        phase: 'complete',
        name: 'read_file',
        toolCallId: 'toolu_1',
        args: { path: '/tmp/foo.txt' },
        result: undefined,
        sessionKey: 'session-1',
        runId: 'run-1',
      },
    ])
  })

  it('emits complete events for multiple orphaned tool cards', () => {
    const awaitingOutput = new Set(['toolu_1', 'toolu_2'])
    const toolStateByCallId = new Map([
      ['toolu_1', { name: 'read_file', args: { path: '/tmp/a.txt' } }],
      ['toolu_2', { name: 'write_file', args: { path: '/tmp/b.txt' } }],
    ])

    const events = resolveOrphanedToolCards({
      awaitingOutput,
      toolStateByCallId,
      sessionKey: 'session-1',
      runId: 'run-1',
    })

    expect(events).toHaveLength(2)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolCallId: 'toolu_1', phase: 'complete', result: undefined }),
        expect.objectContaining({ toolCallId: 'toolu_2', phase: 'complete', result: undefined }),
      ]),
    )
  })

  it('uses "tool" as fallback name when state is missing for a callId', () => {
    const awaitingOutput = new Set(['toolu_unknown'])
    const toolStateByCallId = new Map<string, { name: string; args: null }>()

    const events = resolveOrphanedToolCards({
      awaitingOutput,
      toolStateByCallId,
      sessionKey: 'session-1',
    })

    expect(events).toEqual([
      {
        phase: 'complete',
        name: 'tool',
        toolCallId: 'toolu_unknown',
        args: undefined,
        result: undefined,
        sessionKey: 'session-1',
        runId: undefined,
      },
    ])
  })

  it('omits args when state.args is a string (non-object args)', () => {
    const awaitingOutput = new Set(['toolu_str'])
    const toolStateByCallId = new Map([
      ['toolu_str', { name: 'bash', args: 'echo hello' }],
    ])

    const events = resolveOrphanedToolCards({
      awaitingOutput,
      toolStateByCallId,
      sessionKey: 'session-1',
    })

    expect(events[0].args).toBeUndefined()
    expect(events[0].name).toBe('bash')
  })

  it('does not mutate the awaitingOutput set', () => {
    const awaitingOutput = new Set(['toolu_1'])
    const toolStateByCallId = new Map([
      ['toolu_1', { name: 'tool_a', args: {} }],
    ])

    resolveOrphanedToolCards({
      awaitingOutput,
      toolStateByCallId,
      sessionKey: 'session-1',
    })

    expect(awaitingOutput.size).toBe(1)
  })
})
