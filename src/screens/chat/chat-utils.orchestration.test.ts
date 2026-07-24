import { describe, expect, it } from 'vitest'
import { normalizeSessions } from './utils'

describe('normalizeSessions orchestration titles', () => {
  it('falls back to orchestration titles for subagent sessions without explicit names', () => {
    const [session] = normalizeSessions([
      {
        key: 'agent:main:subagent:abc123',
        friendlyId: 'abc123',
        kind: 'subagent',
      },
    ])

    expect(session.derivedTitle).toBe('Subagent Worker')
  })

  it('preserves the gateway active-session flag for sidebar activity', () => {
    const [session] = normalizeSessions([
      { key: 'active-session', is_active: true },
    ])
    expect(session.isActive).toBe(true)
  })
})
