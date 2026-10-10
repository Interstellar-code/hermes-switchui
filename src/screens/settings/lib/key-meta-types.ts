// Contract C1 (MK run settings-revamp): shared shape for per-key settings metadata.
// Data lives in ../data/key-meta.json (KeyMeta[]) and ../data/presets.json (Preset[]).
export type KeyScope = 'hermes-config' | 'env' | 'switchui-local'
export type KeyApplies = 'live' | 'next-session' | 'restart'

export type KeyMeta = {
  id: string // bare dotted key as in /api/config/schema (e.g. agent.max_turns)
  label: string
  group: string // group = regrouped section id (board A)
  scope: KeyScope
  applies: KeyApplies
  type: 'bool' | 'int' | 'float' | 'enum' | 'string' | 'list' | 'map' | 'secret'
  default?: unknown
  recommended?: unknown
  range?: { min?: number; max?: number; unlimited?: unknown } // unlimited = the value meaning ∞ (null/0)
  options?: string[]
  effect: string
  tradeoff?: string
  source: string
  verified: boolean
  required?: { value: unknown; reason: string } // board C locked keys
}

export type Preset = {
  id: 'balanced' | 'power' | 'safe'
  label: string
  values: Record<string, unknown>
}
