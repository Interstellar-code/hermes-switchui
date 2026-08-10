import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from './chat-store'
import type { ChatStreamEvent } from './chat-store'
import type { PendingApprovalDetail } from '../lib/approvals'

/**
 * Approval contract v1 §2: the gateway resolves an approval by `run_id` alone
 * and pops the run's queue FIFO — `approval_id` is accepted but never read.
 * Two outstanding cards for one run therefore cannot both be answered
 * correctly: clicking the second silently answers the first. The store is
 * where that invariant has to live, because the card cannot see the other
 * sessions' cards.
 */

const detail = (over: Partial<PendingApprovalDetail> = {}): PendingApprovalDetail => ({
  runId: 'run_1111',
  command: 'rm -rf /tmp/demo',
  description: 'delete temp dir',
  patternKeys: ['shell-c'],
  allowPermanent: true,
  ...over,
})

/** The `clarify | interaction` union member; `Extract` collapses to never. */
type ClarifyEvent = ChatStreamEvent & { type: 'clarify' }

const approvalEvent = (over: Partial<ClarifyEvent> = {}): ChatStreamEvent => ({
  type: 'clarify',
  transport: 'send-stream',
  clarifyId: 'approval_1',
  kind: 'approval',
  toolName: 'approval',
  question: 'delete temp dir',
  choices: ['once', 'session', 'always', 'deny'],
  approval: detail(),
  sessionKey: 'sess-a',
  runId: 'run_1111',
  ...over,
})

beforeEach(() => {
  useChatStore.setState({ pendingClarify: {} })
})
afterEach(() => {
  useChatStore.setState({ pendingClarify: {} })
})

describe('chat-store — one approval card per run', () => {
  it('keeps the FIRST card when a second approval arrives for the same run', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.processEvent(
      approvalEvent({
        clarifyId: 'approval_2',
        question: 'wipe /var',
        approval: detail({ command: 'rm -rf /var' }),
      }),
    )

    const card = useChatStore.getState().getPendingClarify('sess-a')
    // The gateway will consume the OLDEST entry, so the oldest card is the
    // only one that can be answered truthfully.
    expect(card?.clarifyId).toBe('approval_1')
    expect(card?.approval?.command).toBe('rm -rf /tmp/demo')
  })

  it('blocks a duplicate for the same run even from a different session', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.processEvent(approvalEvent({ clarifyId: 'approval_2', sessionKey: 'sess-b' }))

    expect(useChatStore.getState().getPendingClarify('sess-a')?.clarifyId).toBe(
      'approval_1',
    )
    expect(useChatStore.getState().getPendingClarify('sess-b')).toBeNull()
  })

  it('allows a second card once the first is answered', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.markClarifyResolved('sess-a', 'approval_1', 'once')
    store.processEvent(
      approvalEvent({ clarifyId: 'approval_2', question: 'second ask' }),
    )

    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.clarifyId).toBe('approval_2')
    expect(card?.resolved).toBeFalsy()
  })

  it('allows separate cards for separate runs', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.processEvent(
      approvalEvent({
        clarifyId: 'approval_2',
        sessionKey: 'sess-b',
        runId: 'run_2222',
        approval: detail({ runId: 'run_2222' }),
      }),
    )

    expect(useChatStore.getState().getPendingClarify('sess-a')?.approval?.runId).toBe(
      'run_1111',
    )
    expect(useChatStore.getState().getPendingClarify('sess-b')?.approval?.runId).toBe(
      'run_2222',
    )
  })

  it('re-delivery of the SAME approval refreshes rather than being dropped', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.processEvent(approvalEvent({ question: 'delete temp dir (retry)' }))

    expect(useChatStore.getState().getPendingClarify('sess-a')?.question).toBe(
      'delete temp dir (retry)',
    )
  })

  it('keys the card by the payload run id, not the stream run id', () => {
    useChatStore
      .getState()
      .processEvent(approvalEvent({ runId: 'run_stream_only' }))
    expect(useChatStore.getState().getPendingClarify('sess-a')?.runId).toBe(
      'run_1111',
    )
  })
})

describe('chat-store — closeApprovalCard', () => {
  it('closes an unanswered card with an explanation and unblocks', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.closeApprovalCard('sess-a', 'approval_1', 'Timed out.')

    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.resolved).toBe(true)
    expect(card?.closedNote).toBe('Timed out.')
    expect(card?.answer).toBeUndefined()
  })

  it('ignores a late close aimed at a card that has been replaced', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.closeApprovalCard('sess-a', 'approval_stale', 'Timed out.')

    expect(
      useChatStore.getState().getPendingClarify('sess-a')?.resolved,
    ).toBeFalsy()
  })

  it('never overwrites a decision the user already made', () => {
    const store = useChatStore.getState()
    store.processEvent(approvalEvent())
    store.markClarifyResolved('sess-a', 'approval_1', 'deny')
    store.closeApprovalCard('sess-a', 'approval_1', 'Timed out.')

    const card = useChatStore.getState().getPendingClarify('sess-a')
    expect(card?.answer).toBe('deny')
    expect(card?.closedNote).toBeUndefined()
  })
})
