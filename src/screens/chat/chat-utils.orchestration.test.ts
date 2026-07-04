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

    expect(session?.derivedTitle).toBe('Subagent Worker')
  })
})
