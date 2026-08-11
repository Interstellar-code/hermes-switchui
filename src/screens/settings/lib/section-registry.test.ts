import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SECTION_COMPONENTS,
  SECTION_SPECS,
  SECTION_SPEC_BY_ID,
  dirtySectionIds,
  sectionIdForKey,
  sectionOwnsKey,
} from './section-registry'

const SECTIONS_DIR = new URL('../sections/', import.meta.url)

describe('SECTION_SPECS', () => {
  it('covers every section (canary)', () => {
    expect(SECTION_SPECS.length).toBeGreaterThanOrEqual(27)
  })

  it('has unique ids', () => {
    const ids = SECTION_SPECS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a lazily-loaded body for every spec, and no orphan bodies', () => {
    const specIds = SECTION_SPECS.map((s) => s.id).sort()
    const componentIds = Object.keys(SECTION_COMPONENTS).sort()
    expect(componentIds).toEqual(specIds)
  })

  it('only declares store keys under the config. prefix', () => {
    // `config.` is the only prefix with a persistence route; anything else
    // would go to the saver's `unroutable` bucket and silently never save.
    for (const spec of SECTION_SPECS) {
      for (const key of spec.keys ?? []) {
        expect(key.startsWith('config.'), `${spec.id} declares ${key}`).toBe(true)
      }
    }
  })

  it('gives every key-owning section an ownership that includes the store', () => {
    for (const spec of SECTION_SPECS) {
      if ((spec.keys?.length ?? 0) === 0) continue
      expect(['store', 'mixed'], `${spec.id}`).toContain(spec.ownership)
    }
  })

  it('gives every mixed section its self-saved surfaces', () => {
    for (const spec of SECTION_SPECS.filter((s) => s.ownership === 'mixed')) {
      expect((spec.selfSavedSurfaces ?? []).length, spec.id).toBeGreaterThan(0)
    }
  })

  /**
   * The registry is hand-written against the section sources. If a section
   * file disappears or is renamed the lazy import would only fail at runtime,
   * inside a Suspense boundary, as a blank panel.
   */
  it('maps every spec id to a section file that exists', () => {
    const files = new Set(readdirSync(SECTIONS_DIR).filter((f) => f.endsWith('.tsx')))
    expect(files.size).toBeGreaterThan(20)
    for (const spec of SECTION_SPECS) {
      expect(files.has(`section-${spec.id}.tsx`), spec.id).toBe(true)
    }
  })

  /**
   * A key edited by a section but absent from its spec cannot light a sidebar
   * dot — which is the exact class of bug this registry exists to kill.
   */
  it.each(
    SECTION_SPECS.filter((s) => (s.keys?.length ?? 0) > 0).map((s) => [s.id, s] as const),
  )('%s declares every config key its source writes', (_id, spec) => {
    const src = readFileSync(new URL(`section-${spec.id}.tsx`, SECTIONS_DIR), 'utf8')
    const found = new Set(
      Array.from(src.matchAll(/'(config\.[a-zA-Z0-9_.]+)'/g), (m) => m[1]),
    )
    expect(found.size).toBeGreaterThan(0)
    for (const key of found) {
      expect(sectionOwnsKey(spec, key), `${spec.id} does not declare ${key}`).toBe(true)
    }
  })
})

describe('sectionIdForKey', () => {
  it('resolves an exact key to its owning section', () => {
    expect(sectionIdForKey('config.terminal.timeout')).toBe('execution')
    expect(sectionIdForKey('config.approvals.mode')).toBe('safety')
    expect(sectionIdForKey('config.network.force_ipv4')).toBe('network')
  })

  it('returns undefined for a key no section claims', () => {
    expect(sectionIdForKey('config.nothing.claims.this')).toBe(undefined)
  })

  it('prefers an exact match over any prefix rule', () => {
    // Wave 2 adds an All-settings section with `keyPrefixes: ['config.']` as a
    // fail-open catch-all. A curated section's exact key must still win.
    const prefixOwners = SECTION_SPECS.filter((s) => (s.keyPrefixes?.length ?? 0) > 0)
    for (const spec of prefixOwners) {
      expect(sectionOwnsKey(spec, 'config.terminal.timeout')).toBe(
        (spec.keyPrefixes ?? []).some((p) => 'config.terminal.timeout'.startsWith(p)),
      )
    }
    expect(sectionIdForKey('config.terminal.timeout')).toBe('execution')
  })
})

describe('dirtySectionIds', () => {
  it('maps dirty setting keys to section ids', () => {
    // The old sidebar did `dirty.has(section.id)` — a Set of keys tested
    // against an id — so the dot could never light.
    const ids = dirtySectionIds(
      new Set(['config.terminal.timeout', 'config.approvals.mode']),
    )
    expect([...ids].sort()).toEqual(['execution', 'safety'])
    expect(ids.has('workspace')).toBe(false)
  })

  it('ignores unknown keys instead of throwing', () => {
    expect(dirtySectionIds(new Set(['config.unknown'])).size).toBe(0)
  })

  it('lights every section that genuinely edits a shared key', () => {
    // config.logging.level is edited from both Telemetry and Advanced.
    const ids = dirtySectionIds(['config.logging.level'])
    expect([...ids].sort()).toEqual(['advanced', 'telemetry'])
  })

  it('is empty for an empty dirty set', () => {
    expect(dirtySectionIds(new Set()).size).toBe(0)
  })
})

describe('SECTION_SPEC_BY_ID', () => {
  it('indexes every spec', () => {
    expect(SECTION_SPEC_BY_ID.size).toBe(SECTION_SPECS.length)
    expect(SECTION_SPEC_BY_ID.get('safety')?.ownership).toBe('store')
    expect(SECTION_SPEC_BY_ID.get('raw-config')?.ownership).toBe('self-saving')
    expect(SECTION_SPEC_BY_ID.get('memory-wiki')?.ownership).toBe('mixed')
  })
})
