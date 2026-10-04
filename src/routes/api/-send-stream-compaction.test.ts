import { describe, expect, it } from 'vitest'
import {
  buildUsageUpdatePayload,
  isCompactionStartSignal,
} from './-send-stream-compaction'

describe('buildUsageUpdatePayload (#364)', () => {
  it('forwards compacted=true even when context_percent is absent', () => {
    expect(
      buildUsageUpdatePayload(
        { compacted: true, messages_before: 42, messages_after: 18 },
        's1',
        'r1',
      ),
    ).toEqual({
      contextPercent: undefined,
      compacted: true,
      messagesBefore: 42,
      messagesAfter: 18,
      sessionKey: 's1',
      runId: 'r1',
    })
  })

  it('forwards a plain percent update', () => {
    expect(
      buildUsageUpdatePayload({ context_percent: 37 }, 's1', undefined),
    ).toMatchObject({ contextPercent: 37, compacted: false })
  })

  it('drops an event carrying neither a percent nor a compaction', () => {
    expect(buildUsageUpdatePayload({ compacted: false }, 's1', 'r1')).toBeNull()
    expect(
      buildUsageUpdatePayload({ context_percent: Number.NaN }, 's1', 'r1'),
    ).toBeNull()
  })
})

describe('isCompactionStartSignal (#364)', () => {
  it('matches dedicated compaction-start events', () => {
    expect(isCompactionStartSignal('compaction.started', {})).toBe(true)
    expect(isCompactionStartSignal('context.compacting', {})).toBe(true)
  })

  it('matches agent status lines announcing compaction', () => {
    expect(
      isCompactionStartSignal('status', { message: '🗜️ Compacting context…' }),
    ).toBe(true)
    expect(
      isCompactionStartSignal('tool.progress', {
        tool_name: '_thinking',
        delta: 'Compressing context (42 messages)…',
      }),
    ).toBe(true)
  })

  it('ignores routine heartbeats and completion lines', () => {
    expect(
      isCompactionStartSignal('status', {
        message: 'Pre-compaction memory flush',
      }),
    ).toBe(false)
    expect(
      isCompactionStartSignal('status', {
        message: '✓ Context compaction complete — continuing turn...',
      }),
    ).toBe(false)
    expect(
      isCompactionStartSignal('assistant.delta', {
        delta: 'I am compacting context in my answer',
      }),
    ).toBe(false)
  })
})
