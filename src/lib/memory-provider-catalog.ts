/**
 * memory-provider-catalog.ts — the single description of every memory provider
 * the Hermes agent ships under `~/.hermes/hermes-agent/plugins/memory/`.
 *
 * It used to list six of the nine, which meant Settings → Memory could not
 * select the provider a machine was actually running: an install configured on
 * `matrix-memory` saw a select box that had no such option, so opening the
 * section and saving would quietly rewrite the provider to something else.
 * The list below is therefore the full on-disk set, and adding a plugin to the
 * agent means adding it here too.
 *
 * `setup` and `local` are the two facts that decide what a picker can honestly
 * recommend. Only a `none` + `local` provider works the moment it is selected —
 * everything else needs a credential, a service, a sign-in, or a binary that is
 * not installed yet.
 */
import type { MemoryProvider } from '@/server/profiles-browser'

/** What a provider needs from the user before it will load at all. */
export type MemorySetupKind = 'none' | 'api-key' | 'service' | 'oauth' | 'cli'

export type MemoryProviderInfo = {
  id: MemoryProvider
  label: string
  desc: string
  setup: MemorySetupKind
  /** Whether the store lives on this machine rather than someone else's. */
  local: boolean
  /**
   * The one provider a fresh install should be pointed at. Exactly one entry
   * carries this — `memory-choices.test.ts` pins that.
   */
  recommended?: boolean
}

export const MEMORY_PROVIDER_CATALOG: Array<MemoryProviderInfo> = [
  {
    id: 'matrix-memory',
    label: 'Matrix Memory',
    // The name is a product name and nothing else. Users who know the Matrix
    // chat protocol reliably assume a homeserver is involved, so the
    // description says what the store actually is — one SQLite file — before
    // it says anything else, and denies the network dependency outright.
    desc: 'Local memory built on the Mnemosyne engine: a single SQLite file under ~/.hermes with vector search, full-text ranking and a knowledge graph. No server, no account, no network — nothing leaves this machine. Unrelated to the Matrix chat protocol.',
    setup: 'none',
    local: true,
    recommended: true,
  },
  {
    id: 'holographic',
    label: 'Holographic',
    desc: 'Local SQLite fact store with full-text search, trust scoring and compositional retrieval. Runs on this machine with no credentials.',
    setup: 'none',
    local: true,
  },
  {
    id: 'hindsight',
    label: 'Hindsight',
    desc: 'Long-term memory with a knowledge graph, entity resolution and multi-strategy retrieval. Talks to a Hindsight service.',
    setup: 'api-key',
    local: false,
  },
  {
    id: 'mem0',
    label: 'Mem0',
    desc: 'Cloud memory graph with server-side fact extraction and deduplication. Needs a Mem0 API key.',
    setup: 'api-key',
    local: false,
  },
  {
    id: 'openviking',
    label: 'OpenViking',
    desc: 'Context database with automatic extraction, tiered retrieval and filesystem-style browsing. Needs an OpenViking endpoint to talk to.',
    setup: 'service',
    local: false,
  },
  {
    id: 'retaindb',
    label: 'RetainDB',
    desc: 'Cloud memory API with hybrid search and seven memory types. Needs a RetainDB API key.',
    setup: 'api-key',
    local: false,
  },
  {
    id: 'supermemory',
    label: 'Supermemory',
    desc: 'Semantic long-term memory with profile recall and session ingest. Needs a Supermemory API key.',
    setup: 'api-key',
    local: false,
  },
  {
    id: 'honcho',
    label: 'Honcho',
    desc: 'Cross-session user modelling with dialectic Q&A and persistent conclusions. Needs a Honcho sign-in.',
    setup: 'oauth',
    local: false,
  },
  {
    id: 'byterover',
    label: 'ByteRover',
    desc: 'Persistent knowledge tree with tiered retrieval. Driven through the brv command-line tool, which has to be installed separately.',
    setup: 'cli',
    local: false,
  },
]

export const MEMORY_PROVIDER_IDS = MEMORY_PROVIDER_CATALOG.map(
  (provider) => provider.id,
)

export const MEMORY_PROVIDER_SELECT_OPTIONS = MEMORY_PROVIDER_CATALOG.map(
  (provider) => ({
    value: provider.id,
    label: provider.label,
  }),
)

export const MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED = [
  { value: '', label: 'Disabled' },
  ...MEMORY_PROVIDER_SELECT_OPTIONS,
]

export function getMemoryProviderInfo(
  provider: string | null | undefined,
): MemoryProviderInfo | null {
  return MEMORY_PROVIDER_CATALOG.find((entry) => entry.id === provider) ?? null
}
