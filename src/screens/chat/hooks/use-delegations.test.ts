import { describe, expect, it } from 'vitest'
import { countSessionAgents, hasActiveSessionAgents } from './use-delegations'

describe('countSessionAgents', () => {
  it('dedupes a live child session that has already persisted', () => {
    expect(
      countSessionAgents(
        [{ childSessionId: 'child-1' }, { childSessionId: 'child-2' }],
        [
          { subagentId: 'subagent-1', childSessionId: 'child-1' },
          { subagentId: 'subagent-3', childSessionId: 'child-3' },
        ],
      ),
    ).toBe(3)
  })

  it('counts a live agent before Hermes has assigned it a child session', () => {
    expect(
      countSessionAgents([], [{ subagentId: 'subagent-1' }]),
    ).toBe(1)
  })
})

describe('hasActiveSessionAgents', () => {
  it('is live while a persisted child is running', () => {
    expect(hasActiveSessionAgents([{ status: 'running' }], [])).toBe(true)
  })

  it('does not light the trigger for settled children', () => {
    expect(
      hasActiveSessionAgents(
        [{ status: 'completed' }, { status: 'failed' }],
        [{ status: 'completed' }, { status: 'error' }, { status: 'aborted' }],
      ),
    ).toBe(false)
  })

  it('lights immediately for an in-flight stream event without a status', () => {
    expect(hasActiveSessionAgents([], [{}])).toBe(true)
  })
})
