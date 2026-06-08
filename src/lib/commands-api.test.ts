import { describe, expect, it } from 'vitest'
import {
  expandUserCommandPrompt,
  findEnabledCommandBySlash,
} from './commands-api'
import type { UserCommandRecord } from './commands-api'

function command(patch: Partial<UserCommandRecord> = {}): UserCommandRecord {
  return {
    id: 'cmd_test',
    name: 'Review',
    slash: '/review',
    description: '',
    prompt: 'Review this.',
    enabled: true,
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
    ...patch,
  }
}

describe('commands-api helpers', () => {
  it('finds enabled commands by normalized slash', () => {
    expect(findEnabledCommandBySlash([command()], '/REVIEW')?.id).toBe(
      'cmd_test',
    )
    expect(
      findEnabledCommandBySlash([command({ enabled: false })], '/review'),
    ).toBeNull()
  })

  it('replaces the input placeholder', () => {
    expect(
      expandUserCommandPrompt(
        command({ prompt: 'Rewrite this:\n{{input}}' }),
        'make it shorter',
      ),
    ).toBe('Rewrite this:\nmake it shorter')
  })

  it('appends input when no placeholder exists', () => {
    expect(expandUserCommandPrompt(command(), 'focus on bugs')).toBe(
      'Review this.\n\nfocus on bugs',
    )
  })
})
