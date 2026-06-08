import { describe, expect, it } from 'vitest'

import { isRecoverablePersistedRun } from './run-store'
import type { PersistedRunState } from './run-store'

function run(
  status: PersistedRunState['status'],
  lastEventAt: number,
): PersistedRunState {
  return {
    runId: `run-${status}`,
    sessionKey: 'session-1',
    friendlyId: 'session-1',
    status,
    createdAt: lastEventAt,
    updatedAt: lastEventAt,
    lastEventAt,
    assistantText: '',
    thinkingText: '',
    toolCalls: [],
    lifecycleEvents: [],
  }
}

describe('isRecoverablePersistedRun', () => {
  it('does not recover non-terminal runs from a previous SwitchUI process', () => {
    expect(
      isRecoverablePersistedRun(run('active', 10_000), 20_000, 15_000),
    ).toBe(false)
  })

  it('keeps recent accepted and handoff runs recoverable', () => {
    expect(
      isRecoverablePersistedRun(run('accepted', 10_000), 35_000, 5_000),
    ).toBe(true)
    expect(
      isRecoverablePersistedRun(run('handoff', 10_000), 35_000, 5_000),
    ).toBe(true)
  })

  it('expires accepted and handoff runs without fresh activity', () => {
    expect(
      isRecoverablePersistedRun(run('accepted', 10_000), 45_001, 5_000),
    ).toBe(false)
    expect(
      isRecoverablePersistedRun(run('handoff', 10_000), 45_001, 5_000),
    ).toBe(false)
  })

  it('does not recover terminal or stalled runs', () => {
    expect(
      isRecoverablePersistedRun(run('complete', 10_000), 20_000, 5_000),
    ).toBe(false)
    expect(isRecoverablePersistedRun(run('error', 10_000), 20_000, 5_000)).toBe(
      false,
    )
    expect(
      isRecoverablePersistedRun(run('stalled', 10_000), 20_000, 5_000),
    ).toBe(false)
  })
})
