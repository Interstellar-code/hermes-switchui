import { describe, expect, it } from 'vitest'
import {
  CATCH_ALL_SECTION_ID,
  buildSearchIndex,
  searchSections,
  searchSettings,
} from './search-index'
import { buildSchemaIndex } from './schema-binding'

/**
 * The sidebar used to filter 27 section *labels*, so every one of the terms
 * below — all of them real, editable settings — matched nothing at all.
 */
const SCHEMA = buildSchemaIndex({
  category_order: ['general', 'terminal', 'security'],
  fields: {
    'terminal.backend': {
      type: 'select',
      description: 'Terminal execution backend',
      category: 'terminal',
      options: ['local', 'docker'],
    },
    'terminal.docker_image': {
      type: 'string',
      description: 'Terminal → Docker Image',
      category: 'terminal',
    },
    'terminal.timeout': {
      type: 'number',
      description: 'Terminal → Timeout',
      category: 'terminal',
    },
    'security.tirith_enabled': {
      type: 'boolean',
      description: 'Enable the Tirith scanner',
      category: 'security',
    },
    'sessions.retention_days': {
      type: 'number',
      description: 'Sessions → Retention Days',
      category: 'sessions',
    },
    'discord.bot_token': {
      type: 'string',
      description: 'Discord → Bot Token',
      category: 'discord',
    },
  },
})

const INDEX = buildSearchIndex(SCHEMA)

describe('buildSearchIndex', () => {
  it('indexes every schema field', () => {
    expect(INDEX.byKey.has('config.terminal.docker_image')).toBe(true)
    expect(INDEX.entries.length).toBeGreaterThanOrEqual(6)
  })

  /**
   * Four keys the curated sections really edit are absent from the published
   * schema, so a schema-only index would make them unfindable.
   */
  it('includes registry keys the schema does not publish', () => {
    expect(INDEX.byKey.get('config.gateway.multiplex_profiles')?.sectionId).toBe(
      'gateway',
    )
    expect(
      INDEX.byKey.get('config.platforms.api_server.port')?.sectionId,
    ).toBe('gateway')
  })

  it('attributes a key to the curated section that edits it', () => {
    expect(INDEX.byKey.get('config.terminal.backend')?.sectionId).toBe('execution')
    expect(INDEX.byKey.get('config.security.tirith_enabled')?.sectionId).toBe(
      'safety',
    )
  })

  it('sends a key no curated section owns to the All-settings browser', () => {
    expect(INDEX.byKey.get('config.discord.bot_token')?.sectionId).toBe(
      CATCH_ALL_SECTION_ID,
    )
  })

  it('builds a usable index with no schema at all', () => {
    const bare = buildSearchIndex()
    // Registry keys alone still make the curated settings findable.
    expect(bare.byKey.has('config.terminal.timeout')).toBe(true)
    expect(searchSettings(bare, 'timeout').length).toBeGreaterThan(0)
  })
})

describe('searchSettings', () => {
  /** The headline case from the plan. */
  it('finds config.terminal.docker_image when you search "docker"', () => {
    const keys = searchSettings(INDEX, 'docker').map((h) => h.key)
    expect(keys).toContain('config.terminal.docker_image')
  })

  it('finds the other terms that used to match nothing', () => {
    expect(searchSettings(INDEX, 'tirith').map((h) => h.key)).toContain(
      'config.security.tirith_enabled',
    )
    expect(searchSettings(INDEX, 'retention').map((h) => h.key)).toContain(
      'config.sessions.retention_days',
    )
    expect(searchSettings(INDEX, 'port').map((h) => h.key)).toContain(
      'config.platforms.api_server.port',
    )
  })

  it('matches the dotted key path, which is the only reliable identifier', () => {
    expect(searchSettings(INDEX, 'config.terminal.timeout')[0].key).toBe(
      'config.terminal.timeout',
    )
  })

  it('ranks an exact leaf above a mere substring', () => {
    const hits = searchSettings(INDEX, 'timeout')
    expect(hits[0].key).toBe('config.terminal.timeout')
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(searchSettings(INDEX, '  DOCKER ').map((h) => h.key)).toContain(
      'config.terminal.docker_image',
    )
  })

  it('returns nothing for an empty query', () => {
    expect(searchSettings(INDEX, '   ')).toEqual([])
  })

  it('returns nothing for a term that genuinely matches nothing', () => {
    expect(searchSettings(INDEX, 'zzzznotathing')).toEqual([])
  })

  it('honours the cap', () => {
    expect(searchSettings(INDEX, 'config.', 3)).toHaveLength(3)
  })
})

describe('searchSections', () => {
  it('groups matching settings under the section that owns them', () => {
    const sections = searchSections(INDEX, 'docker')
    const execution = sections.find((s) => s.sectionId === 'execution')
    expect(execution).toBeTruthy()
    expect(execution?.hits.map((h) => h.key)).toContain(
      'config.terminal.docker_image',
    )
  })

  /** Today's behaviour has to remain a strict subset of the new behaviour. */
  it('still matches a section by its own title', () => {
    const sections = searchSections(INDEX, 'safety')
    const safety = sections.find((s) => s.sectionId === 'safety')
    expect(safety?.titleMatch).toBe(true)
  })

  it('orders sections the way the sidebar does', () => {
    const ids = searchSections(INDEX, 'config.').map((s) => s.sectionId)
    expect(ids.indexOf('execution')).toBeLessThan(ids.indexOf('safety'))
  })

  it('caps each section and reports the surplus rather than dropping it', () => {
    const sections = searchSections(INDEX, 'config.', 1)
    const withOverflow = sections.filter((s) => s.overflow > 0)
    expect(withOverflow.length).toBeGreaterThan(0)
    for (const section of sections) expect(section.hits.length).toBeLessThanOrEqual(1)
  })

  it('returns nothing for an empty query', () => {
    expect(searchSections(INDEX, '')).toEqual([])
  })
})
