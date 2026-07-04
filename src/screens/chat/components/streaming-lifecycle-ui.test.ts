import { describe, expect, it } from 'vitest'

import {
  buildCompactionNotice,
  selectVisibleLifecycleEvents,
} from './streaming-lifecycle-ui'

describe('selectVisibleLifecycleEvents', () => {
  it('keeps compaction and handoff/stall events over generic status noise', () => {
    expect(
      selectVisibleLifecycleEvents([
        { text: 'Connecting to agent', emoji: '⏳', timestamp: 1, isError: false },
        { text: 'Waiting for first tool result', emoji: '⏳', timestamp: 2, isError: false },
        { text: 'Context compacted mid-run', emoji: '🗜️', timestamp: 3, isError: false },
        { text: 'Run handed off for reconciliation', emoji: '🔄', timestamp: 4, isError: false },
        { text: 'Run stalled after handoff', emoji: '⚠️', timestamp: 5, isError: true },
      ]),
    ).toEqual([
      { text: 'Context compacted mid-run', emoji: '🗜️', timestamp: 3, isError: false },
      { text: 'Run handed off for reconciliation', emoji: '🔄', timestamp: 4, isError: false },
      { text: 'Run stalled after handoff', emoji: '⚠️', timestamp: 5, isError: true },
    ])
  })

  it('falls back to the most recent events when nothing noteworthy happened', () => {
    expect(
      selectVisibleLifecycleEvents([
        { text: 'Queued', emoji: '⏳', timestamp: 1, isError: false },
        { text: 'Accepted', emoji: '⏳', timestamp: 2, isError: false },
        { text: 'Still working', emoji: '⏳', timestamp: 3, isError: false },
        { text: 'Still working…', emoji: '⏳', timestamp: 4, isError: false },
      ], 2),
    ).toEqual([
      { text: 'Still working', emoji: '⏳', timestamp: 3, isError: false },
      { text: 'Still working…', emoji: '⏳', timestamp: 4, isError: false },
    ])
  })
})

describe('buildCompactionNotice', () => {
  it('summarizes message reduction when counts are known', () => {
    expect(
      buildCompactionNotice({
        compactionCount: 1,
        messagesBefore: 42,
        messagesAfter: 18,
      }),
    ).toBe('Context compacted • 42 → 18 messages kept')
  })

  it('falls back to a generic per-chat label', () => {
    expect(
      buildCompactionNotice({
        compactionCount: 2,
        messagesBefore: null,
        messagesAfter: null,
      }),
    ).toBe('Context compacted 2 times during this chat')
  })
})
