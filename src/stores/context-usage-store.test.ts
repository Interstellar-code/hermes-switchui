import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_COMPACTION_EVENTS,
  useContextUsageStore,
} from './context-usage-store'

const store = () => useContextUsageStore.getState()

describe('context-usage-store compaction history (#364)', () => {
  beforeEach(() => {
    store().reset()
    store().setSessionKey('k')
  })

  it('records compaction history and keeps the count in step', () => {
    store().recordCompaction({
      sessionKey: 'k',
      contextPercent: 22,
      messagesBefore: 42,
      messagesAfter: 18,
    })
    expect(store().compactionEvents).toHaveLength(1)
    expect(store().compactionEvents[0]).toMatchObject({
      messagesBefore: 42,
      messagesAfter: 18,
      contextPercent: 22,
      source: 'auto',
    })
    expect(store().compactionCount).toBe(1)
    expect(store().contextPercent).toBe(22)
  })

  it('records a compaction that arrived without a context percent', () => {
    useContextUsageStore.setState({ contextPercent: 61 })
    store().recordCompaction({
      sessionKey: 'k',
      messagesBefore: 42,
      messagesAfter: 18,
    })
    expect(store().compactionEvents[0].contextPercent).toBeNull()
    // Keeps the last known percent rather than zeroing the ring.
    expect(store().contextPercent).toBe(61)
  })

  it('caps history while the count keeps growing', () => {
    for (let i = 0; i < MAX_COMPACTION_EVENTS + 5; i += 1) {
      store().recordCompaction({ sessionKey: 'k' })
    }
    expect(store().compactionEvents).toHaveLength(MAX_COMPACTION_EVENTS)
    expect(store().compactionCount).toBe(MAX_COMPACTION_EVENTS + 5)
  })

  it('accepts events addressed by a registered alias key', () => {
    store().setSessionKey('k', ['agent:main:k', null, ''])
    store().recordCompaction({ sessionKey: 'agent:main:k' })
    expect(store().compactionEvents).toHaveLength(1)
  })

  it('ignores events for another session', () => {
    store().recordCompaction({ sessionKey: 'other' })
    store().startCompaction('other')
    expect(store().compactionEvents).toHaveLength(0)
    expect(store().compactingSince).toBeNull()
  })

  it('tracks a live compaction until it is recorded', () => {
    store().startCompaction('k')
    expect(store().compactingSince).not.toBeNull()
    store().recordCompaction({ sessionKey: 'k' })
    expect(store().compactingSince).toBeNull()
  })

  it('endCompaction clears an unfinished live compaction', () => {
    store().startCompaction('k')
    store().endCompaction('k')
    expect(store().compactingSince).toBeNull()
  })

  it('clears history when switching chats', () => {
    store().recordCompaction({ sessionKey: 'k' })
    store().setSessionKey('k2')
    expect(store().compactionEvents).toHaveLength(0)
    expect(store().compactionCount).toBe(0)
  })
})
