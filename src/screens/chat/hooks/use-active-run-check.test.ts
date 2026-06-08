import { describe, expect, it } from 'vitest'

import { isRecoverableActiveRun } from './use-active-run-check'

describe('isRecoverableActiveRun', () => {
  it('treats accepted and active runs as recoverable', () => {
    expect(
      isRecoverableActiveRun({
        runId: 'run-accepted',
        sessionKey: 'session-1',
        status: 'accepted',
      }),
    ).toBe(true)
    expect(
      isRecoverableActiveRun({
        runId: 'run-active',
        sessionKey: 'session-1',
        status: 'active',
      }),
    ).toBe(true)
  })

  it('keeps only recent handoff runs recoverable', () => {
    expect(
      isRecoverableActiveRun(
        {
          runId: 'recent-handoff',
          sessionKey: 'session-1',
          status: 'handoff',
          lastEventAt: 10_000,
        },
        35_000,
      ),
    ).toBe(true)

    expect(
      isRecoverableActiveRun(
        {
          runId: 'stale-handoff',
          sessionKey: 'session-1',
          status: 'handoff',
          lastEventAt: 10_000,
        },
        45_001,
      ),
    ).toBe(false)
  })

  it('does not recover terminal or stalled runs', () => {
    expect(
      isRecoverableActiveRun({
        runId: 'run-complete',
        sessionKey: 'session-1',
        status: 'complete',
      }),
    ).toBe(false)
    expect(
      isRecoverableActiveRun({
        runId: 'run-stalled',
        sessionKey: 'session-1',
        status: 'stalled',
      }),
    ).toBe(false)
  })
})
