import { describe, expect, it } from 'vitest'
import schema from '../data/__fixtures__/config-schema.json'
import { SECTION_SPECS } from './section-registry'
import { getKeyMeta, listKeyMeta } from './key-meta'
import type { KeyMeta } from './key-meta-types'

const fields = (
  schema as { fields: Record<string, { options?: Array<string> }> }
).fields

// Real keys the dashboard's GET /api/config/schema never publishes (verified against
// the fixture): platforms.* is a gateway surface outside CONFIG_SCHEMA, and
// model.provider is written via POST /api/model/set, not the config.* save path.
// Anything else missing from the schema is a data bug and fails the test.
const NOT_IN_SCHEMA: Record<string, string> = {
  'model.provider':
    'written via /api/model/set, not published by /api/config/schema',
  'platforms.api_server.enabled':
    'gateway surface (PlatformConfig), outside CONFIG_SCHEMA',
  'platforms.api_server.extra.host':
    'gateway surface (PlatformConfig extra), outside CONFIG_SCHEMA',
  'platforms.api_server.extra.port':
    'gateway surface (PlatformConfig extra), outside CONFIG_SCHEMA',
}

// Section keys kept only as display fallbacks for values written by older UIs into
// the wrong nesting; never written by the revamped sections.
const LEGACY_READ_ONLY = new Set([
  'config.fallback_model',
  'config.platforms.api_server.host',
  'config.platforms.api_server.port',
])

function schemaMissingIds(meta: Array<KeyMeta>): Array<string> {
  return meta
    .filter((m) => m.scope === 'hermes-config')
    .map((m) => m.id)
    .filter((id) => !(id in fields) && !(id in NOT_IN_SCHEMA))
}

function enumSubsetViolations(meta: Array<KeyMeta>): Array<string> {
  const bad: Array<string> = []
  for (const m of meta) {
    if (m.type !== 'enum' || !m.options) continue
    const field = fields[m.id] as { options?: Array<string> } | undefined
    if (!field?.options) continue
    if (m.options.some((o) => !field.options!.includes(o))) bad.push(m.id)
  }
  return bad
}

describe('key-meta contract', () => {
  it('every hermes-config meta id exists in the schema (allow-listed gateway surfaces aside)', () => {
    expect(schemaMissingIds(listKeyMeta())).toEqual([])
  })

  it('a hermes-config id missing from the schema and the allow-list fails the check', () => {
    const bogus: KeyMeta = {
      ...listKeyMeta()[0],
      id: 'agent.not_a_real_key',
      scope: 'hermes-config',
    }
    expect(schemaMissingIds([...listKeyMeta(), bogus])).toEqual([
      'agent.not_a_real_key',
    ])
  })

  it("every enum's options are a subset of the schema options (ids without a schema field skipped)", () => {
    expect(enumSubsetViolations(listKeyMeta())).toEqual([])
  })

  it.skipIf(listKeyMeta().length === 0)(
    'every config key used by a section has meta (legacy read-only keys aside)',
    () => {
      const keys = SECTION_SPECS.flatMap((s) => s.keys ?? []).filter(
        (k) => k.startsWith('config.') && !LEGACY_READ_ONLY.has(k),
      )
      expect(keys.filter((k) => !getKeyMeta(k))).toEqual([])
    },
  )
})
