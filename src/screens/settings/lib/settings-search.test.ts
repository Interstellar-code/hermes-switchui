import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SECTION,
  isKnownSection,
  searchForSection,
  sectionFromSearch,
  settingsSearchSchema,
} from './settings-search'
import { SECTION_SPECS } from './section-registry'

/**
 * The `/settings` URL contract, tested router-free — this is pure encode/decode
 * and it is where the interesting rules live. `-settings-search.test.ts` drives
 * the same schema through a real router.
 */

describe('settingsSearchSchema', () => {
  it('accepts an empty search, which is what all 11 existing call sites pass', () => {
    expect(settingsSearchSchema.parse({})).toEqual({ section: undefined })
  })

  it('decodes a section', () => {
    expect(settingsSearchSchema.parse({ section: 'safety' })).toEqual({
      section: 'safety',
    })
  })

  /**
   * TanStack's parser runs raw values through JSON.parse first, so a
   * numeric-looking param arrives as a number. A plain `z.string()` would
   * reject it and, with `.catch(undefined)`, silently drop the section.
   */
  it('coerces a non-string param instead of dropping it', () => {
    expect(settingsSearchSchema.parse({ section: 42 }).section).toBe('42')
  })

  it('degrades a malformed param to undefined rather than erroring the route', () => {
    expect(settingsSearchSchema.parse({ section: '' }).section).toBe(undefined)
    expect(settingsSearchSchema.parse({ section: null }).section).toBe(undefined)
    expect(settingsSearchSchema.parse({ section: {} }).section).toBe(undefined)
  })

  it('drops params it does not know about', () => {
    expect(settingsSearchSchema.parse({ section: 'safety', junk: 1 })).toEqual({
      section: 'safety',
    })
  })
})

describe('sectionFromSearch', () => {
  it('resolves a real section', () => {
    expect(sectionFromSearch({ section: 'safety' })).toBe('safety')
    expect(sectionFromSearch({ section: 'all-settings' })).toBe('all-settings')
  })

  it('falls back to the default for a stale or mistyped section id', () => {
    expect(sectionFromSearch({ section: 'saftey' })).toBe(DEFAULT_SECTION)
    expect(sectionFromSearch({ section: undefined })).toBe(DEFAULT_SECTION)
    expect(sectionFromSearch(undefined)).toBe(DEFAULT_SECTION)
  })

  it('resolves every id the registry publishes', () => {
    for (const spec of SECTION_SPECS) {
      expect(sectionFromSearch({ section: spec.id }), spec.id).toBe(spec.id)
    }
  })
})

describe('searchForSection', () => {
  /** `/settings` must stay bare — the router omits `undefined` entirely. */
  it('never writes the default section into the URL', () => {
    expect(searchForSection(DEFAULT_SECTION)).toEqual({ section: undefined })
  })

  it('writes a non-default section', () => {
    expect(searchForSection('safety')).toEqual({ section: 'safety' })
  })

  it('refuses to write a section that does not exist', () => {
    expect(searchForSection('nope')).toEqual({ section: undefined })
  })

  it('round-trips every section through encode → decode', () => {
    for (const spec of SECTION_SPECS) {
      expect(sectionFromSearch(searchForSection(spec.id)), spec.id).toBe(spec.id)
    }
  })

  /**
   * Spread over the previous search, `{section: undefined}` *clears* the param,
   * which is how navigating back to the default cleans the URL up.
   */
  it('clears the param when returning to the default', () => {
    const prev = { section: 'safety' }
    expect({ ...prev, ...searchForSection(DEFAULT_SECTION) }).toEqual({
      section: undefined,
    })
  })
})

describe('isKnownSection', () => {
  it('knows the deep-link targets this work ships', () => {
    expect(isKnownSection('safety')).toBe(true)
    expect(isKnownSection('raw-config')).toBe(true)
    expect(isKnownSection('all-settings')).toBe(true)
    expect(isKnownSection(undefined)).toBe(false)
  })
})
