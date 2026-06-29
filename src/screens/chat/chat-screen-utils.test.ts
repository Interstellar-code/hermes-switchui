import { describe, expect, it } from 'vitest'

import {
  advanceStickyStreamingText,
  hasUnansweredLatestUserTurn,
  isChatRuntimeBusy,
  latestTurnIsToolOnly,
  samePending,
  verbForTool,
} from './chat-screen-utils'
import type { ApprovalRequest } from '@/screens/gateway/lib/approvals-store'
import type { ChatMessage } from './types'

const approval = (over: Partial<ApprovalRequest> = {}): ApprovalRequest =>
  ({
    id: 'a1',
    status: 'pending',
    gatewayApprovalId: 'g1',
    ...over,
  }) as ApprovalRequest

describe('advanceStickyStreamingText', () => {
  it('preserves the last non-empty streaming text when a tool phase temporarily reports empty text', () => {
    const afterText = advanceStickyStreamingText({
      isStreaming: true,
      runId: 'run-1',
      rawText: 'Working through the task',
      smoothedText: 'Working through the task',
      previousState: { runId: null, text: '' },
    })

    const afterToolPhase = advanceStickyStreamingText({
      isStreaming: true,
      runId: 'run-1',
      rawText: '',
      smoothedText: '',
      previousState: afterText,
    })

    expect(afterToolPhase).toEqual({
      runId: 'run-1',
      text: 'Working through the task',
    })
  })

  it('resets sticky text when a new run starts', () => {
    const next = advanceStickyStreamingText({
      isStreaming: true,
      runId: 'run-2',
      rawText: '',
      smoothedText: '',
      previousState: { runId: 'run-1', text: 'Old stream text' },
    })

    expect(next).toEqual({ runId: 'run-2', text: '' })
  })

  it('clears sticky text when streaming ends', () => {
    const next = advanceStickyStreamingText({
      isStreaming: false,
      runId: null,
      rawText: '',
      smoothedText: '',
      previousState: { runId: 'run-1', text: 'Old stream text' },
    })

    expect(next).toEqual({ runId: null, text: '' })
  })
})

describe('hasUnansweredLatestUserTurn', () => {
  it('treats the latest accepted optimistic user message as an open turn until an assistant answer arrives', () => {
    const messages: Array<ChatMessage> = [
      {
        role: 'user',
        status: 'queued',
        __optimisticId: 'opt-1',
        content: [{ type: 'text', text: 'first prompt' }],
      },
    ]

    expect(hasUnansweredLatestUserTurn(messages)).toBe(true)
  })

  it('keeps the turn open while only a streaming assistant placeholder follows the latest user', () => {
    const messages: Array<ChatMessage> = [
      {
        role: 'user',
        status: 'queued',
        __optimisticId: 'opt-1',
        content: [{ type: 'text', text: 'first prompt' }],
      },
      {
        role: 'assistant',
        __streamingStatus: 'streaming',
        content: [],
      },
    ]

    expect(hasUnansweredLatestUserTurn(messages)).toBe(true)
  })

  it('closes the turn once a final assistant text answer follows the latest user', () => {
    const messages: Array<ChatMessage> = [
      {
        role: 'user',
        status: 'queued',
        __optimisticId: 'opt-1',
        content: [{ type: 'text', text: 'first prompt' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
      },
    ]

    expect(hasUnansweredLatestUserTurn(messages)).toBe(false)
  })

  it('does not lock old non-optimistic user-only history forever', () => {
    const messages: Array<ChatMessage> = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'old imported user message' }],
      },
    ]

    expect(hasUnansweredLatestUserTurn(messages)).toBe(false)
  })
})

describe('isChatRuntimeBusy', () => {
  it('does not treat an orphaned unanswered user turn as active runtime work', () => {
    const messages: Array<ChatMessage> = [
      {
        role: 'user',
        status: 'queued',
        __optimisticId: 'opt-interrupted',
        content: [{ type: 'text', text: 'interrupted prompt' }],
      },
    ]

    expect(hasUnansweredLatestUserTurn(messages)).toBe(true)
    expect(
      isChatRuntimeBusy({
        sending: false,
        waitingForResponse: false,
        hasActiveSend: false,
        activeIsRealtimeStreaming: false,
        derivedIsStreaming: false,
        hasPendingGeneration: false,
      }),
    ).toBe(false)
  })

  it('reports real runtime activity as busy', () => {
    expect(
      isChatRuntimeBusy({
        sending: false,
        waitingForResponse: true,
        hasActiveSend: false,
        activeIsRealtimeStreaming: false,
        derivedIsStreaming: false,
        hasPendingGeneration: false,
      }),
    ).toBe(true)
  })
})

describe('latestTurnIsToolOnly (F1 guard)', () => {
  it('returns false when there is no user turn', () => {
    expect(latestTurnIsToolOnly([])).toBe(false)
  })

  it('returns false when only the user turn exists (no follow-up yet)', () => {
    expect(
      latestTurnIsToolOnly([
        {
          role: 'user',
          status: 'queued',
          __optimisticId: 'opt-1',
          content: [{ type: 'text', text: 'first prompt' }],
        },
      ]),
    ).toBe(false)
  })

  it('returns true when only tool results follow the user turn', () => {
    expect(
      latestTurnIsToolOnly([
        {
          role: 'user',
          status: 'queued',
          __optimisticId: 'opt-1',
          content: [{ type: 'text', text: 'run ls' }],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: 'file1\nfile2' }],
        },
      ]),
    ).toBe(true)
  })

  it('returns true when tool results + streaming assistant placeholder follow', () => {
    expect(
      latestTurnIsToolOnly([
        {
          role: 'user',
          status: 'queued',
          __optimisticId: 'opt-1',
          content: [{ type: 'text', text: 'run ls' }],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: 'file1\nfile2' }],
        },
        {
          role: 'assistant',
          __streamingStatus: 'streaming',
          content: [],
        },
      ]),
    ).toBe(true)
  })

  it('returns false when a final assistant text answer follows', () => {
    expect(
      latestTurnIsToolOnly([
        {
          role: 'user',
          status: 'queued',
          __optimisticId: 'opt-1',
          content: [{ type: 'text', text: 'run ls' }],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: 'file1\nfile2' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here are the files.' }],
        },
      ]),
    ).toBe(false)
  })
})

describe('isChatRuntimeBusy — parity truth table (Track 2 / Phase 2.2)', () => {
  // Documents the 64-row truth table for the 6 legacy signals.
  // Phase 2.2's selectIsComposerBusy must match this for every row.
  // Sample key rows; not exhaustive.
  const baseInputs = {
    sending: false,
    waitingForResponse: false,
    hasActiveSend: false,
    activeIsRealtimeStreaming: false,
    derivedIsStreaming: false,
    hasPendingGeneration: false,
  }

  it('all-false is not busy', () => {
    expect(isChatRuntimeBusy(baseInputs)).toBe(false)
  })

  it('sending alone is busy', () => {
    expect(isChatRuntimeBusy({ ...baseInputs, sending: true })).toBe(true)
  })

  it('waitingForResponse alone is busy', () => {
    expect(
      isChatRuntimeBusy({ ...baseInputs, waitingForResponse: true }),
    ).toBe(true)
  })

  it('hasActiveSend alone is busy', () => {
    expect(isChatRuntimeBusy({ ...baseInputs, hasActiveSend: true })).toBe(
      true,
    )
  })

  it('activeIsRealtimeStreaming alone is busy', () => {
    expect(
      isChatRuntimeBusy({ ...baseInputs, activeIsRealtimeStreaming: true }),
    ).toBe(true)
  })

  it('derivedIsStreaming alone is busy', () => {
    expect(
      isChatRuntimeBusy({ ...baseInputs, derivedIsStreaming: true }),
    ).toBe(true)
  })

  it('hasPendingGeneration alone is busy', () => {
    expect(
      isChatRuntimeBusy({ ...baseInputs, hasPendingGeneration: true }),
    ).toBe(true)
  })

  it('OR semantics: any one signal makes it busy', () => {
    // Spot-check a few combined rows.
    expect(
      isChatRuntimeBusy({
        ...baseInputs,
        hasActiveSend: true,
        hasPendingGeneration: true,
      }),
    ).toBe(true)
    expect(
      isChatRuntimeBusy({
        ...baseInputs,
        sending: true,
        activeIsRealtimeStreaming: true,
      }),
    ).toBe(true)
  })
})

describe('verbForTool', () => {
  it.each([
    ['terminal', 'Running terminal'],
    ['bash', 'Running terminal'],
    ['shell', 'Running terminal'],
    ['Write', 'Writing file'],
    ['edit_file', 'Writing file'],
    ['create', 'Writing file'],
    ['Read', 'Reading file'],
    ['view', 'Reading file'],
    ['cat', 'Reading file'],
    ['search', 'Searching'],
    ['grep', 'Searching'],
    ['glob', 'Searching'],
    ['find', 'Searching'],
    ['skill', 'Loading skill'],
  ])('maps %s → %s', (name, expected) => {
    expect(verbForTool(name)).toBe(expected)
  })

  it('formats mcp / fetch / generic / empty cases', () => {
    expect(verbForTool('mcp__server__tool')).toBe('Calling mcp__server__tool')
    expect(verbForTool('fetch')).toBe('Fetching')
    expect(verbForTool('http_get')).toBe('Fetching')
    expect(verbForTool('web')).toBe('Fetching')
    expect(verbForTool('CustomThing')).toBe('Running CustomThing')
    expect(verbForTool('')).toBe('Working')
  })

  it('is case-insensitive', () => {
    expect(verbForTool('BASH')).toBe('Running terminal')
  })
})

describe('samePending', () => {
  it('returns true for structurally equal lists', () => {
    expect(samePending([approval()], [approval()])).toBe(true)
    expect(samePending([], [])).toBe(true)
  })

  it('returns false when length differs', () => {
    expect(samePending([approval()], [])).toBe(false)
  })

  it('returns false when id, status, or gatewayApprovalId differ', () => {
    expect(samePending([approval()], [approval({ id: 'a2' })])).toBe(false)
    expect(
      samePending([approval()], [approval({ status: 'approved' })]),
    ).toBe(false)
    expect(
      samePending([approval()], [approval({ gatewayApprovalId: 'g2' })]),
    ).toBe(false)
  })

  it('compares positionally', () => {
    const a = [approval({ id: 'a1' }), approval({ id: 'a2' })]
    const b = [approval({ id: 'a2' }), approval({ id: 'a1' })]
    expect(samePending(a, b)).toBe(false)
  })
})
