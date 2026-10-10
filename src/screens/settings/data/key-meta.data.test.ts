// Contract test for the C1 data files: key-meta.json (KeyMeta[]) and
// presets.json (Preset[]) are validated against the read-only schema fixture
// captured from the dashboard's GET /api/config/schema and against the
// key-meta-types.ts contract. This test is the P1A acceptance gate: it fails on
// the seed `[]` data and on any entry that drifts from the contract or schema.

import { describe, expect, it } from 'vitest'
import keyMetaJson from './key-meta.json'
import presetsJson from './presets.json'
import schemaFixture from './__fixtures__/config-schema.json'
import type { KeyMeta, Preset } from '../lib/key-meta-types'

const keyMeta = keyMetaJson as Array<KeyMeta>
const presets = presetsJson as Array<Preset>
type SchemaField = { type?: string; options?: Array<string> }
type SchemaFields = Record<string, SchemaField>
const schemaFields = (schemaFixture as { fields: SchemaFields }).fields

// Gateway-surface keys that live outside CONFIG_SCHEMA (platforms.* is a real
// gateway surface per settings-gap-audit.md:65 but is not published by
// /api/config/schema; model.provider is written via /api/model/set, not the
// config.* save path). Asserted present separately from schema membership.
const GATEWAY_SURFACE_IDS = new Set([
  'platforms.api_server.enabled',
  'platforms.api_server.extra.host',
  'platforms.api_server.extra.port',
  'model.provider',
])

const VALID_SCOPES = new Set(['hermes-config', 'env', 'switchui-local'])
const VALID_APPLIES = new Set(['live', 'next-session', 'restart'])
const VALID_TYPES = new Set([
  'bool',
  'int',
  'float',
  'enum',
  'string',
  'list',
  'map',
  'secret',
])

const REQUIRED_KEY_IDS = [
  'platforms.api_server.enabled',
  'platforms.api_server.extra.host',
  'platforms.api_server.extra.port',
  'api_server.interactive_clarify',
  'gateway.multiplex_profiles',
  'model.provider',
  'toolsets',
  'kanban.dispatch_in_gateway',
]

function requiredByKey(): Map<string, unknown> {
  return new Map(
    keyMeta
      .filter((e) => e.required !== undefined)
      .map((e) => [e.id, e.required!.value]),
  )
}

function presetRequiredViolations(
  presetList: Array<Preset>,
  required: Map<string, unknown>,
): Array<string> {
  const violations: Array<string> = []
  for (const preset of presetList) {
    for (const [key, value] of Object.entries(preset.values)) {
      if (!required.has(key)) continue
      const requiredValue = required.get(key)
      if (key === 'toolsets') {
        const ok =
          Array.isArray(value) &&
          (requiredValue as Array<string>).every((rv) =>
            (value as Array<string>).includes(rv),
          )
        if (!ok)
          violations.push(
            `${preset.id} toolsets must contain kanban (required ${JSON.stringify(requiredValue)})`,
          )
      } else if (value !== requiredValue) {
        violations.push(
          `${preset.id} ${key} must equal required ${JSON.stringify(requiredValue)}`,
        )
      }
    }
  }
  return violations
}

describe('key-meta.json (contract C1)', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(keyMeta)).toBe(true)
    expect(keyMeta.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    const ids = keyMeta.map((e) => e.id)
    expect(new Set(ids).size, `duplicate ids: ${ids}`).toBe(ids.length)
  })

  it('every entry has the C1 fields with valid enum values', () => {
    for (const entry of keyMeta) {
      const ctx = `entry ${entry.id}`
      expect(typeof entry.id, ctx).toBe('string')
      expect(entry.id.length, ctx).toBeGreaterThan(0)
      expect(typeof entry.label, ctx).toBe('string')
      expect(typeof entry.group, ctx).toBe('string')
      expect(VALID_SCOPES.has(entry.scope), `${ctx} scope=${entry.scope}`).toBe(
        true,
      )
      expect(
        VALID_APPLIES.has(entry.applies),
        `${ctx} applies=${entry.applies}`,
      ).toBe(true)
      expect(VALID_TYPES.has(entry.type), `${ctx} type=${entry.type}`).toBe(
        true,
      )
      expect(typeof entry.effect, ctx).toBe('string')
      expect(entry.effect.length, ctx).toBeGreaterThan(0)
      expect(typeof entry.source, ctx).toBe('string')
      expect(typeof entry.verified, ctx).toBe('boolean')
      if (entry.tradeoff !== undefined) {
        expect(typeof entry.tradeoff, ctx).toBe('string')
      }
      if (entry.range !== undefined) {
        expect(typeof entry.range, ctx).toBe('object')
      }
      if (entry.options !== undefined) {
        expect(Array.isArray(entry.options), ctx).toBe(true)
        for (const opt of entry.options) {
          expect(typeof opt, `${ctx} option`).toBe('string')
        }
      }
      if (entry.required !== undefined) {
        expect(typeof entry.required, ctx).toBe('object')
        expect('value' in entry.required, ctx).toBe(true)
        expect(typeof entry.required.reason, ctx).toBe('string')
      }
    }
  })

  it('no applies value is outside the 3 contract values', () => {
    // belt-and-braces: the per-entry check above already asserts membership; this
    // test exists so a regression reads as a single named failure.
    const bad = keyMeta.filter((e) => !VALID_APPLIES.has(e.applies))
    expect(bad.map((e) => `${e.id}:${e.applies}`)).toEqual([])
  })

  it('enum entries always carry options', () => {
    const enumsWithoutOptions = keyMeta.filter(
      (e) => e.type === 'enum' && !e.options,
    )
    expect(enumsWithoutOptions.map((e) => e.id)).toEqual([])
  })

  it('every hermes-config id exists in the schema fixture (gateway-surface ids excepted)', () => {
    const missing = keyMeta
      .filter(
        (e) =>
          e.scope === 'hermes-config' &&
          !GATEWAY_SURFACE_IDS.has(e.id) &&
          !(e.id in schemaFields),
      )
      .map((e) => e.id)
    expect(missing).toEqual([])
  })

  it('gateway-surface ids (platforms.*, model.provider) are present', () => {
    const ids = new Set(keyMeta.map((e) => e.id))
    for (const id of GATEWAY_SURFACE_IDS) {
      expect(ids.has(id), `missing gateway-surface id ${id}`).toBe(true)
    }
  })

  it('every enum options list is a subset of the schema options for that key', () => {
    const violations: Array<string> = []
    for (const entry of keyMeta) {
      if (!entry.options) continue
      const field = schemaFields[entry.id] as SchemaField | undefined
      const schemaOptions = field?.options
      if (!schemaOptions) continue // schema lists no options for this key
      const extra = entry.options.filter((o) => !schemaOptions.includes(o))
      if (extra.length > 0) {
        violations.push(
          `${entry.id}: [${extra.join(', ')}] not in schema [${schemaOptions.join(', ')}]`,
        )
      }
    }
    expect(violations).toEqual([])
  })

  it('exactly the 8 required (locked) keys are present', () => {
    const requiredIds = keyMeta
      .filter((e) => e.required !== undefined)
      .map((e) => e.id)
      .sort()
    expect(requiredIds).toEqual([...REQUIRED_KEY_IDS].sort())
  })

  it('fallback_providers and platforms.api_server.extra.host|port ids are used', () => {
    const ids = new Set(keyMeta.map((e) => e.id))
    expect(ids.has('fallback_providers')).toBe(true)
    expect(ids.has('platforms.api_server.extra.host')).toBe(true)
    expect(ids.has('platforms.api_server.extra.port')).toBe(true)
  })

  it('the miswired legacy ids are absent', () => {
    const ids = new Set(keyMeta.map((e) => e.id))
    expect(ids.has('fallback_model')).toBe(false)
    expect(ids.has('platforms.api_server.host')).toBe(false)
    expect(ids.has('platforms.api_server.port')).toBe(false)
  })

  it('tool_use_enforcement is corrected to auto/on/off', () => {
    const entry = keyMeta.find((e) => e.id === 'agent.tool_use_enforcement')
    expect(entry).toBeDefined()
    expect(entry!.type).toBe('enum')
    expect(entry!.options).toEqual(['auto', 'on', 'off'])
  })

  it('service_tier is corrected to the schema options with the Fast mode label', () => {
    const entry = keyMeta.find((e) => e.id === 'agent.service_tier')
    expect(entry).toBeDefined()
    expect(entry!.label).toBe('Fast mode')
    expect(entry!.options).toEqual(['', 'normal', 'fast', 'auto', 'cold'])
  })

  it('gateway_timeout is an idle timeout with 0 = unlimited', () => {
    const entry = keyMeta.find((e) => e.id === 'agent.gateway_timeout')
    expect(entry).toBeDefined()
    expect(entry!.range?.unlimited).toBe(0)
    expect(entry!.effect.toLowerCase()).toContain('idle')
  })

  it('max_turns has null = unlimited', () => {
    const entry = keyMeta.find((e) => e.id === 'agent.max_turns')
    expect(entry).toBeDefined()
    expect(entry!.range?.unlimited).toBeNull()
    expect(entry!.default).toBeNull()
  })

  it('fallback_providers is a list typed entry', () => {
    const entry = keyMeta.find((e) => e.id === 'fallback_providers')
    expect(entry).toBeDefined()
    expect(entry!.type).toBe('list')
    expect(entry!.effect).toContain('fallback_model')
  })

  it('recommended values exist for keys that have a Balanced preset value', () => {
    const balanced = presets.find((p) => p.id === 'balanced')
    expect(balanced).toBeDefined()
    const byId = new Map(keyMeta.map((e) => [e.id, e]))
    for (const [key, value] of Object.entries(balanced!.values)) {
      const entry = byId.get(key)
      expect(entry, `key-meta entry for preset key ${key}`).toBeDefined()
      expect(
        entry!.recommended,
        `recommended for ${key} should equal the Balanced value`,
      ).toEqual(value)
    }
  })

  it('re-read-per-call keys are marked live with a trace (review M1/M2)', () => {
    const clarify = keyMeta.find((e) => e.id === 'agent.clarify_timeout')
    expect(clarify!.applies).toBe('live')
    expect(clarify!.source).toContain('gateway/run.py:786-791')

    const interactive = keyMeta.find(
      (e) => e.id === 'api_server.interactive_clarify',
    )
    expect(interactive!.applies).toBe('live')
    expect(interactive!.source).toContain(
      'gateway/platforms/api_server.py:2726',
    )
  })

  it('logging.level is restart with a traced consumer and schema options (review M3/LOW1)', () => {
    const entry = keyMeta.find((e) => e.id === 'logging.level')
    expect(entry!.applies).toBe('restart')
    expect(entry!.verified).toBe(true)
    expect(entry!.source).toContain('hermes_logging.py:182-184')
    expect(entry!.options).toEqual(['DEBUG', 'INFO', 'WARNING', 'ERROR'])
  })
})

describe('presets.json (contract C1)', () => {
  it('has exactly the balanced/power/safe presets', () => {
    expect(presets.map((p) => p.id).sort()).toEqual([
      'balanced',
      'power',
      'safe',
    ])
  })

  it('every preset has a label and a values object', () => {
    for (const preset of presets) {
      expect(typeof preset.label, `preset ${preset.id}`).toBe('string')
      expect(typeof preset.values, `preset ${preset.id}`).toBe('object')
    }
  })

  it('every preset value matches its key type, enum options and range', () => {
    const byId = new Map(keyMeta.map((e) => [e.id, e]))
    const violations: Array<string> = []
    let checked = 0
    for (const preset of presets) {
      for (const [key, value] of Object.entries(preset.values)) {
        const entry = byId.get(key)
        if (!entry) continue
        checked += 1
        const ctx = `preset ${preset.id} ${key}=${JSON.stringify(value)} (type ${entry.type})`
        switch (entry.type) {
          case 'bool':
            if (typeof value !== 'boolean')
              violations.push(`${ctx}: not a boolean`)
            break
          case 'int':
            if (typeof value !== 'number' || !Number.isInteger(value))
              violations.push(`${ctx}: not an integer`)
            break
          case 'float':
            if (typeof value !== 'number')
              violations.push(`${ctx}: not a number`)
            break
          case 'string':
          case 'secret':
            if (typeof value !== 'string')
              violations.push(`${ctx}: not a string`)
            break
          case 'enum':
            if (!entry.options || !entry.options.includes(value as string))
              violations.push(
                `${ctx}: not in options [${entry.options?.join(', ')}]`,
              )
            break
          case 'list':
            if (!Array.isArray(value)) violations.push(`${ctx}: not an array`)
            break
          case 'map':
            if (typeof value !== 'object' || Array.isArray(value))
              violations.push(`${ctx}: not a plain object`)
            break
        }
        // range bounds apply to numeric values; the unlimited sentinel bypasses them
        const range = entry.range
        if (range && typeof value === 'number' && value !== range.unlimited) {
          if (range.min !== undefined && value < range.min)
            violations.push(`${ctx}: below range.min ${range.min}`)
          if (range.max !== undefined && value > range.max)
            violations.push(`${ctx}: above range.max ${range.max}`)
        }
      }
    }
    // Non-vacuous guard: every value in every preset must have been checked.
    expect(checked).toBe(72)
    expect(violations).toEqual([])
  })

  it('no preset sets a value for a required key that differs from its required value', () => {
    const violations = presetRequiredViolations(presets, requiredByKey())
    expect(violations).toEqual([])
  })

  it('the required-key contradiction check actually fires (in-test rogue fixture)', () => {
    // Proves the loop above is not vacuous: no real preset touches a required
    // key, so this rogue fixture is the evidence the check can fail. It lives
    // in the test only — data/ files are untouched.
    const rogue: Array<Preset> = [
      {
        id: 'balanced',
        label: 'rogue fixture',
        values: {
          'gateway.multiplex_profiles': false, // contradicts required true
          toolsets: ['hermes-cli'], // drops the required kanban member
          'agent.max_turns': 150, // irrelevant key: must NOT be flagged
        },
      },
    ]
    const violations = presetRequiredViolations(rogue, requiredByKey())
    expect(violations).toEqual([
      'balanced gateway.multiplex_profiles must equal required true',
      'balanced toolsets must contain kanban (required ["hermes-cli","kanban"])',
    ])
  })

  it('preset values reference keys that exist in key-meta.json', () => {
    const ids = new Set(keyMeta.map((e) => e.id))
    for (const preset of presets) {
      for (const key of Object.keys(preset.values)) {
        expect(
          ids.has(key),
          `preset ${preset.id} references unknown key ${key}`,
        ).toBe(true)
      }
    }
  })
})
