import { describe, expect, it } from 'vitest'
import schema from '../data/__fixtures__/config-schema.json'
import { getKeyMeta, listKeyMeta } from './key-meta'
import { SECTION_SPECS } from './section-registry'

const fields = (
  schema as { fields: Record<string, { options?: Array<string> }> }
).fields

describe('key-meta contract', () => {
  it('every meta id exists in the schema', () => {
    const missing = listKeyMeta()
      .map((m) => m.id)
      .filter((id) => !(id in fields))
    expect(missing).toEqual([])
  })

  it("every enum's options are a subset of the schema options", () => {
    const bad = listKeyMeta()
      .filter((m) => m.type === 'enum' && m.options && fields[m.id].options)
      .filter((m) => m.options!.some((o) => !fields[m.id].options!.includes(o)))
      .map((m) => m.id)
    expect(bad).toEqual([])
  })

  it.skipIf(listKeyMeta().length === 0)(
    'every config key used by a section has meta',
    () => {
      const keys = SECTION_SPECS.flatMap((s) => s.keys ?? []).filter((k) =>
        k.startsWith('config.'),
      )
      expect(keys.filter((k) => !getKeyMeta(k))).toEqual([])
    },
  )
})
