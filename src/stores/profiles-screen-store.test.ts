import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FILTERS,
  applyFilterPatch,
  clampWizardStep,
  filtersToSearch,
  hasActiveFilters,
  profilesSearchSchema,
  searchToFilters,
} from './profiles-screen-store'
import type { ProfileFilterState } from './profiles-screen-store'

function filters(patch: Partial<ProfileFilterState> = {}): ProfileFilterState {
  return { ...DEFAULT_FILTERS, ...patch }
}

/** Keys the router would actually put in the query string. */
function emitted(state: ProfileFilterState): Record<string, unknown> {
  const search: Record<string, unknown> = filtersToSearch(state)
  return Object.fromEntries(
    Object.entries(search).filter(([, v]) => v !== undefined),
  )
}

describe('filtersToSearch — defaults never reach the URL (G-07)', () => {
  it('emits nothing at all for the default filter set', () => {
    // `/profiles` must stay `/profiles`, not `?tier=all&status=all&model=all…`.
    expect(emitted(DEFAULT_FILTERS)).toEqual({})
  })

  it('omits each "all" sentinel individually', () => {
    expect(emitted(filters({ tierFilter: 'all' }))).toEqual({})
    expect(emitted(filters({ statusFilter: 'all' }))).toEqual({})
    expect(emitted(filters({ modelFilter: 'all' }))).toEqual({})
    expect(emitted(filters({ tagFilter: 'all' }))).toEqual({})
  })

  it('omits an empty search and page 1', () => {
    expect(emitted(filters({ search: '', page: 1 }))).toEqual({})
  })

  it('emits only the filters that are actually set', () => {
    expect(emitted(filters({ tierFilter: '2', tagFilter: 'review' }))).toEqual({
      tier: '2',
      tag: 'review',
    })
  })

  it('emits a page past the first', () => {
    expect(emitted(filters({ page: 3 }))).toEqual({ page: 3 })
  })
})

describe('filter ⇄ search round trip', () => {
  const cases: Array<[string, ProfileFilterState]> = [
    ['defaults', DEFAULT_FILTERS],
    ['search only', filters({ search: 'trinity' })],
    ['tier only', filters({ tierFilter: '1' })],
    ['status only', filters({ statusFilter: 'draft' })],
    ['model only', filters({ modelFilter: 'claude-opus-4' })],
    ['tag only', filters({ tagFilter: 'review' })],
    ['page only', filters({ page: 7 })],
    [
      'the shareable "T2 agents tagged review"',
      filters({ tierFilter: '2', tagFilter: 'review' }),
    ],
    [
      'everything at once',
      filters({
        search: 'neo',
        tierFilter: '3',
        statusFilter: 'idle',
        modelFilter: 'gpt-4o',
        tagFilter: 'ops',
        page: 12,
      }),
    ],
  ]

  for (const [label, state] of cases) {
    it(`is identity for ${label}`, () => {
      expect(searchToFilters(filtersToSearch(state))).toEqual(state)
    })
  }

  it('survives a real parse of what the router would hand back', () => {
    const state = filters({
      search: 'review',
      tierFilter: '2',
      statusFilter: 'active',
      page: 4,
    })
    const parsed = profilesSearchSchema.parse(filtersToSearch(state))
    expect(searchToFilters(parsed)).toEqual(state)
  })
})

describe('searchToFilters — absent means default', () => {
  it('fills every default from an empty search', () => {
    expect(searchToFilters({})).toEqual(DEFAULT_FILTERS)
  })

  it('reads a deep link', () => {
    expect(
      searchToFilters({ q: 'review', tier: '2', tag: 'review', page: 2 }),
    ).toEqual(
      filters({ search: 'review', tierFilter: '2', tagFilter: 'review', page: 2 }),
    )
  })
})

describe('profilesSearchSchema — hostile / lossy input', () => {
  it('accepts numeric-looking values the router pre-parses as numbers', () => {
    // TanStack JSON.parses every raw value, so `?tier=2` arrives as 2, not "2".
    expect(profilesSearchSchema.parse({ tier: 2 }).tier).toBe('2')
    expect(profilesSearchSchema.parse({ q: 42 }).q).toBe('42')
    expect(profilesSearchSchema.parse({ tag: 7 }).tag).toBe('7')
  })

  it('drops unknown enum values instead of throwing the screen away', () => {
    expect(profilesSearchSchema.parse({ tier: 'all' }).tier).toBeUndefined()
    expect(profilesSearchSchema.parse({ tier: '9' }).tier).toBeUndefined()
    expect(
      profilesSearchSchema.parse({ status: 'archived' }).status,
    ).toBeUndefined()
  })

  it('drops an empty search rather than recording a blank filter', () => {
    expect(profilesSearchSchema.parse({ q: '' }).q).toBeUndefined()
  })

  it('drops a nonsense or out-of-range page', () => {
    expect(profilesSearchSchema.parse({ page: 'abc' }).page).toBeUndefined()
    expect(profilesSearchSchema.parse({ page: 0 }).page).toBeUndefined()
    expect(profilesSearchSchema.parse({ page: -3 }).page).toBeUndefined()
    expect(profilesSearchSchema.parse({ page: '5' }).page).toBe(5)
  })

  it('keeps the wizard deep link', () => {
    const parsed = profilesSearchSchema.parse({ edit: 'custom-agent', step: 3 })
    expect(parsed.edit).toBe('custom-agent')
    expect(parsed.step).toBe(3)
  })

  it('clamps ?step= at the schema boundary, so no caller can see 0 or 99', () => {
    expect(profilesSearchSchema.parse({ step: 99 }).step).toBe(9)
    expect(profilesSearchSchema.parse({ step: 0 }).step).toBe(1)
    expect(profilesSearchSchema.parse({ step: -5 }).step).toBe(1)
    expect(profilesSearchSchema.parse({}).step).toBeUndefined()
  })

  it('treats an unparseable ?step= as no step at all', () => {
    // Not clamped to 1 but dropped, which lands on step 1 all the same — the
    // wizard's own default — while leaving nothing for the screen to honour.
    expect(profilesSearchSchema.parse({ step: 'seven' }).step).toBeUndefined()
    expect(clampWizardStep(undefined)).toBe(1)
  })
})

describe('clampWizardStep', () => {
  it('passes every in-range step through', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(clampWizardStep(n)).toBe(n)
    }
  })

  it('clamps rather than rejects — a stale link still lands somewhere real', () => {
    expect(clampWizardStep(0)).toBe(1)
    expect(clampWizardStep(-1)).toBe(1)
    expect(clampWizardStep(10)).toBe(9)
    expect(clampWizardStep(1000)).toBe(9)
  })

  it('accepts the string form the URL may still hand over', () => {
    expect(clampWizardStep('4')).toBe(4)
    expect(clampWizardStep('12')).toBe(9)
  })

  it('falls back to step 1 for anything that is not a number', () => {
    expect(clampWizardStep(undefined)).toBe(1)
    expect(clampWizardStep(null)).toBe(1)
    expect(clampWizardStep('')).toBe(1)
    expect(clampWizardStep('abc')).toBe(1)
    expect(clampWizardStep(Number.NaN)).toBe(1)
    expect(clampWizardStep(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampWizardStep({})).toBe(1)
  })

  it('truncates a fractional step', () => {
    expect(clampWizardStep(3.7)).toBe(3)
  })
})

describe('applyFilterPatch — page reset survives the URL round trip', () => {
  it('sends any filter change back to page 1', () => {
    const current = filters({ tierFilter: '1', page: 5 })
    expect(applyFilterPatch(current, { tierFilter: '2' }).page).toBe(1)
    expect(applyFilterPatch(current, { search: 'neo' }).page).toBe(1)
    expect(applyFilterPatch(current, { statusFilter: 'idle' }).page).toBe(1)
    expect(applyFilterPatch(current, { modelFilter: 'gpt-4o' }).page).toBe(1)
    expect(applyFilterPatch(current, { tagFilter: 'ops' }).page).toBe(1)
  })

  it('keeps a page the caller asked for explicitly', () => {
    expect(applyFilterPatch(filters({ page: 5 }), { page: 6 }).page).toBe(6)
  })

  it('drops ?page= from the URL when a filter change resets it', () => {
    const current = filters({ tierFilter: '1', page: 5 })
    expect(emitted(applyFilterPatch(current, { tierFilter: '2' }))).toEqual({
      tier: '2',
    })
  })

  it('leaves the other filters alone', () => {
    const current = filters({ tierFilter: '1', tagFilter: 'ops', page: 5 })
    expect(applyFilterPatch(current, { statusFilter: 'active' })).toEqual(
      filters({
        tierFilter: '1',
        tagFilter: 'ops',
        statusFilter: 'active',
        page: 1,
      }),
    )
  })
})

describe('hasActiveFilters', () => {
  it('is false for defaults, and for a page change alone', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false)
    expect(hasActiveFilters(filters({ page: 4 }))).toBe(false)
  })

  it('is true for any real filter', () => {
    expect(hasActiveFilters(filters({ search: 'x' }))).toBe(true)
    expect(hasActiveFilters(filters({ tierFilter: '1' }))).toBe(true)
    expect(hasActiveFilters(filters({ statusFilter: 'idle' }))).toBe(true)
    expect(hasActiveFilters(filters({ modelFilter: 'gpt-4o' }))).toBe(true)
    expect(hasActiveFilters(filters({ tagFilter: 'ops' }))).toBe(true)
  })
})
