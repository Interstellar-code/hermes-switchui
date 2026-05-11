export type BuiltinAgent = {
  tier: 1 | 2
  id: string
  glyph: string
  name: string
  role: string
  description: string
  tags: Array<string>
  status: 'active'
  builtin: true
}

export const BUILTIN_AGENTS: Array<BuiltinAgent> = [
  {
    tier: 1,
    id: 'hermes-switch',
    glyph: 'HS',
    name: 'Hermes Switch',
    role: 'Orchestrator',
    description: 'Routes tasks across the Tier-2 archetypes.',
    tags: ['orchestrator', 'router'],
    status: 'active',
    builtin: true,
  },
  {
    tier: 2,
    id: 'neo',
    glyph: 'NE',
    name: 'Neo',
    role: 'Builder',
    description: 'Implements features. Acts decisively.',
    tags: ['builder'],
    status: 'active',
    builtin: true,
  },
  {
    tier: 2,
    id: 'trinity',
    glyph: 'TR',
    name: 'Trinity',
    role: 'Investigator',
    description: 'Debugs and traces. Verifies edges.',
    tags: ['investigator', 'tracer'],
    status: 'active',
    builtin: true,
  },
  {
    tier: 2,
    id: 'morpheus',
    glyph: 'MO',
    name: 'Morpheus',
    role: 'Architect',
    description: 'Designs and reviews. Long-term coherence.',
    tags: ['architect', 'reviewer'],
    status: 'active',
    builtin: true,
  },
]
