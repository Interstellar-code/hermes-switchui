import { describe, it, expect } from 'vitest'
import { unionAssigneesWithProfiles } from './assignee-profile-union'

describe('unionAssigneesWithProfiles', () => {
  it('only profiles, no assignees', () => {
    const result = unionAssigneesWithProfiles([], [{ name: 'alice' }, { name: 'bob' }], null)
    expect(result).toEqual([
      { id: 'alice', label: 'alice', onDisk: true, isActive: false },
      { id: 'bob', label: 'bob', onDisk: true, isActive: false },
    ])
  })

  it('only kanban assignees, no profiles', () => {
    const result = unionAssigneesWithProfiles(
      [{ id: 'ghost', label: 'ghost', onDisk: false }],
      [],
      null,
    )
    expect(result).toEqual([{ id: 'ghost', label: 'ghost', onDisk: false }])
  })

  it('overlap — same name in both keeps onDisk', () => {
    const result = unionAssigneesWithProfiles(
      [{ id: 'alice', label: 'alice', onDisk: false }],
      [{ name: 'alice' }],
      null,
    )
    expect(result).toHaveLength(1)
    expect(result[0].onDisk).toBe(true)
  })

  it('orphans appear after on-disk profiles', () => {
    const result = unionAssigneesWithProfiles(
      [
        { id: 'ghost', label: 'ghost', onDisk: false },
        { id: 'alice', label: 'alice', onDisk: true },
      ],
      [{ name: 'alice' }],
      null,
    )
    expect(result[0].id).toBe('alice')
    expect(result[1].id).toBe('ghost')
    expect(result[1].onDisk).toBe(false)
  })

  it('empty inputs return empty array', () => {
    expect(unionAssigneesWithProfiles([], [], null)).toEqual([])
  })

  it('active profile is placed first with (active) label', () => {
    const result = unionAssigneesWithProfiles(
      [],
      [{ name: 'bob' }, { name: 'alice' }],
      'bob',
    )
    expect(result[0].id).toBe('bob')
    expect(result[0].label).toBe('bob (active)')
    expect(result[0].isActive).toBe(true)
    expect(result[1].id).toBe('alice')
  })
})
