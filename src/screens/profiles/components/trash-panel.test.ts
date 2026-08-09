import { describe, expect, it } from 'vitest'

import { restoreErrorMessage } from './trash-panel'

function httpError(message: string, status: number): Error {
  const error = new Error(message)
  ;(error as Error & { status?: number }).status = status
  return error
}

describe('restoreErrorMessage — G-03', () => {
  it('explains a 409 as a live name collision, not a generic failure', () => {
    const message = restoreErrorMessage(
      httpError('Profile already exists', 409),
      'trinity-copy',
    )
    expect(message).toContain('trinity-copy')
    expect(message).toContain('already exists')
    expect(message.toLowerCase()).not.toContain('failed')
  })

  it('tells the user what to do about the collision', () => {
    const message = restoreErrorMessage(httpError('Profile already exists', 409), 'x')
    expect(message.toLowerCase()).toMatch(/rename or delete/)
  })

  it('passes through the server message for other failures', () => {
    expect(restoreErrorMessage(httpError('Trashed profile not found', 404), 'x')).toBe(
      'Trashed profile not found',
    )
    expect(restoreErrorMessage(httpError('Invalid trash id', 400), 'x')).toBe(
      'Invalid trash id',
    )
  })

  it('falls back to a generic message for a non-Error rejection', () => {
    expect(restoreErrorMessage('boom', 'x')).toBe('Failed to restore agent')
    expect(restoreErrorMessage(null, 'x')).toBe('Failed to restore agent')
  })
})
