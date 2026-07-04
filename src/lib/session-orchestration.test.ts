import { describe, expect, it } from 'vitest'
import {
  getSessionKindBadgeLabel,
  getSessionOrchestrationMeta,
} from './session-orchestration'

describe('session-orchestration', () => {
  it('describes subagent sessions as delegated inherited workers', () => {
    expect(
      getSessionOrchestrationMeta('agent:main:subagent:abc123', 'subagent'),
    ).toEqual({
      title: 'Subagent Worker',
      badgeLabel: 'Subagent',
      detail: 'Delegated worker · inherits parent session context',
    })
  })

  it('describes main and cron sessions coherently', () => {
    expect(getSessionOrchestrationMeta('agent:main:main', 'main').title).toBe('Main Agent')
    expect(getSessionOrchestrationMeta('agent:main:cron:job1', 'cron').badgeLabel).toBe('Cron')
  })

  it('falls back to capitalized kind labels for other session kinds', () => {
    expect(getSessionKindBadgeLabel('chat')).toBe('Chat')
    expect(getSessionKindBadgeLabel('delegate')).toBe('Delegate')
  })
})
