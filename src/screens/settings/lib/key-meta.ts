/**
 * key-meta.ts — typed loader over the per-key metadata (contract C1).
 * Accepts the bare id (`agent.max_turns`) and the draft key
 * (`config.agent.max_turns`).
 */
import keyMetaData from '../data/key-meta.json'
import presetsData from '../data/presets.json'
import type { KeyMeta, Preset } from './key-meta-types'

const CONFIG_PREFIX = 'config.'

// JSON infers `string` for the unions; data/key-meta.data.test.ts (P1A) checks the shape.
const ALL = keyMetaData as unknown as Array<KeyMeta>
const PRESETS = presetsData as unknown as Array<Preset>
const BY_ID = new Map(ALL.map((m) => [m.id, m]))

export function getKeyMeta(key: string): KeyMeta | undefined {
  return BY_ID.get(
    key.startsWith(CONFIG_PREFIX) ? key.slice(CONFIG_PREFIX.length) : key,
  )
}

export function listKeyMeta(): Array<KeyMeta> {
  return ALL
}

export function getPresets(): Array<Preset> {
  return PRESETS
}
