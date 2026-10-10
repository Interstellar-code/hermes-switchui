import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GROUP_SPECS,
  SECTION_COMPONENTS,
  SECTION_SPECS,
  SECTION_SPEC_BY_ID,
  curatedSectionIdsForKey,
  dirtySectionIds,
  sectionIdForKey,
  sectionIdsForKey,
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

  /**
   * The All-settings browser claims `config.` as a fail-open catch-all, so an
   * orphan key resolves to *something* and still lights a sidebar dot instead
   * of going dirty invisibly. A key outside the config namespace has no owner
   * at all — the saver has no route for it either.
   */
  it('falls back to the All-settings catch-all for an unclaimed config key', () => {
    expect(sectionIdForKey('config.nothing.claims.this')).toBe('all-settings')
  })

  it('returns undefined for a key outside the config namespace', () => {
    expect(sectionIdForKey('hermes.nothing.claims.this')).toBe(undefined)
  })

  /**
   * The whole risk of a catch-all is that it *masks* a registry gap: a key a
   * curated section really edits would light All-settings instead of that
   * section, and look fine. Every declared key must resolve to its own owner.
   */
  it('never lets the catch-all swallow a curated section key', () => {
    for (const spec of SECTION_SPECS) {
      for (const key of spec.keys ?? []) {
        expect(sectionIdsForKey(key), `${spec.id} / ${key}`).toContain(spec.id)
        expect(sectionIdsForKey(key)).not.toContain('all-settings')
      }
    }
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

  it('routes an unknown config key to the catch-all rather than nowhere', () => {
    expect([...dirtySectionIds(new Set(['config.unknown']))]).toEqual([
      'all-settings',
    ])
  })

  it('ignores keys no section can claim instead of throwing', () => {
    expect(dirtySectionIds(new Set(['hermes.unknown'])).size).toBe(0)
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

describe('the All-settings catch-all', () => {
  const spec = SECTION_SPEC_BY_ID.get('all-settings')

  it('exists, owns the whole config namespace, and writes the store', () => {
    expect(spec).toBeTruthy()
    expect(spec?.keyPrefixes).toEqual(['config.'])
    expect(spec?.ownership).toBe('store')
  })

  it('is the only prefix owner, so nothing competes for the fall-through', () => {
    const prefixOwners = SECTION_SPECS.filter(
      (s) => (s.keyPrefixes?.length ?? 0) > 0,
    ).map((s) => s.id)
    expect(prefixOwners).toEqual(['all-settings'])
  })
})

describe('curatedSectionIdsForKey', () => {
  it('names only sections that declare the key exactly', () => {
    expect(curatedSectionIdsForKey('config.terminal.timeout')).toEqual([
      'execution',
    ])
    expect(curatedSectionIdsForKey('config.logging.level').sort()).toEqual([
      'advanced',
      'telemetry',
    ])
  })

  it('excludes the prefix catch-all, so the browser can tell curated apart', () => {
    expect(curatedSectionIdsForKey('config.nothing.claims.this')).toEqual([])
  })
})

describe('board A intent groups', () => {
  /** Groups render contiguously, so first-occurrence order is render order. */
  it('orders the groups exactly as board A renders them', () => {
    const seen = SECTION_SPECS.map((s) => s.group).filter(
      (g, i, arr) => arr.indexOf(g) === i,
    )
    expect(seen).toEqual(GROUP_SPECS.map((g) => g.label))
  })

  it('keeps every pre-regroup section id registered and reachable', () => {
    const ids = new Set(SECTION_SPECS.map((s) => s.id))
    const beforeRegroup = [
      'workspace',
      'account',
      'appearance',
      'notifications',
      'provider',
      'model-registry',
      'agent-runtime',
      'execution',
      'gateway',
      'memory-wiki',
      'skills',
      'workflows',
      'mcp-servers',
      'mcp-registered',
      'hermes-plugin',
      'storage',
      'privacy',
      'safety',
      'telemetry',
      'api-keys',
      'network',
      'performance',
      'updates',
      'shortcuts',
      'all-settings',
      'advanced',
      'raw-config',
      'danger',
    ]
    // P5B adds `health` — every pre-regroup section must still be there.
    expect(ids.has('health')).toBe(true)
    expect(
      [...beforeRegroup].every((id) => ids.has(id)),
      'every pre-regroup id still reachable',
    ).toBe(true)
    for (const id of [...beforeRegroup, 'health']) {
      expect(SECTION_COMPONENTS[id], id).toBeTruthy()
    }
  })

  it('moves sections to their board A groups', () => {
    const groupOf = (id: string) => SECTION_SPEC_BY_ID.get(id)?.group
    expect(groupOf('provider')).toBe('Models')
    expect(groupOf('agent-runtime')).toBe('Agent behavior')
    expect(groupOf('memory-wiki')).toBe('Context & memory')
    expect(groupOf('execution')).toBe('Tools & execution')
    expect(groupOf('skills')).toBe('Tools & execution')
    expect(groupOf('safety')).toBe('Safety & privacy')
    expect(groupOf('privacy')).toBe('Safety & privacy')
    expect(groupOf('storage')).toBe('Sessions & storage')
    expect(groupOf('workflows')).toBe('Automation')
    expect(groupOf('gateway')).toBe('Channels & gateway')
    expect(groupOf('notifications')).toBe('Display & language')
    expect(groupOf('shortcuts')).toBe('Display & language')
    expect(groupOf('appearance')).toBe('Appearance')
    expect(groupOf('mcp-servers')).toBe('Integrations')
    expect(groupOf('api-keys')).toBe('Integrations')
    expect(groupOf('telemetry')).toBe('System')
    expect(groupOf('workspace')).toBe('System')
    expect(groupOf('all-settings')).toBe('Advanced')
    expect(groupOf('danger')).toBe('Danger')
  })

  it('has a spec for every rendered group, and Overview leads it with health', () => {
    const labels = new Set(SECTION_SPECS.map((s) => s.group))
    for (const g of GROUP_SPECS) {
      expect(labels.has(g.label), g.label).toBe(true)
    }
    // P5B (board C): Overview now renders — first group, health section.
    expect(GROUP_SPECS[0]?.label).toBe('Overview')
    expect(SECTION_SPECS[0]?.id).toBe('health')
    expect(SECTION_SPECS[0]?.group).toBe('Overview')
  })
})
