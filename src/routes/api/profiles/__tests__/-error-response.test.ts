import { describe, expect, it } from 'vitest'
import { errorResponse, statusForError } from '../-error-response'

describe('statusForError', () => {
  it.each([
    ['Profile not found', 404],
    ['Trashed profile not found', 404],
    ['Profile already exists', 409],
    ['Target profile already exists', 409],
    ['Cannot delete the active profile', 409],
    ['Default profile cannot be modified here', 403],
    ['Profile name "neo" is reserved for built-in agents', 403],
    ['Profile name "hermes-switch" is reserved for built-in agents', 403],
    ['Profile name is required', 400],
    ['Invalid profile name', 400],
    ['Trash id is required', 400],
    ['Invalid trash id', 400],
  ])('maps %j to %i', (message, expected) => {
    expect(statusForError(new Error(message))).toBe(expected)
  })

  it('falls back to 500 for an unrecognised message', () => {
    expect(statusForError(new Error('something exploded'))).toBe(500)
  })

  it('falls back to 500 for a non-Error throw', () => {
    expect(statusForError('a plain string')).toBe(500)
    expect(statusForError(undefined)).toBe(500)
    expect(statusForError({ message: 'Profile not found' })).toBe(500)
  })
})

describe('errorResponse', () => {
  it('preserves the mapped status and { error } body shape', async () => {
    const res = errorResponse(new Error('Profile not found'), 'fallback')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Profile not found' })
  })

  it('uses the fallback message and 500 for a non-Error throw', async () => {
    const res = errorResponse('boom', 'Failed to do the thing')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to do the thing' })
  })

  it('reports an unmatched Error message as 500, not the fallback', async () => {
    const res = errorResponse(new Error('a very specific unmapped failure'), 'fallback')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'a very specific unmapped failure' })
  })
})
