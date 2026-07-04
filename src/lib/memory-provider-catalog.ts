import type { MemoryProvider } from '@/server/profiles-browser'

export type MemoryProviderInfo = {
  id: MemoryProvider
  label: string
  desc: string
}

export const MEMORY_PROVIDER_CATALOG: Array<MemoryProviderInfo> = [
  {
    id: 'hindsight',
    label: 'Hindsight',
    desc: 'Lightweight local memory. Stores key facts and decisions from conversations.',
  },
  {
    id: 'mem0',
    label: 'Mem0',
    desc: 'Cloud-hosted memory graph. Requires Mem0 API key in .env.',
  },
  {
    id: 'openviking',
    label: 'OpenViking',
    desc: 'Open-source memory layer with vector search support.',
  },
  {
    id: 'holographic',
    label: 'Holographic',
    desc: 'Experimental multi-dimensional memory with retrieval scoring.',
  },
  {
    id: 'retaindb',
    label: 'RetainDB',
    desc: 'Database-backed persistent memory. Survives agent restarts.',
  },
  {
    id: 'byterover',
    label: 'ByteRover',
    desc: 'Edge-cached memory provider. Low-latency retrieval.',
  },
]

export const MEMORY_PROVIDER_IDS = MEMORY_PROVIDER_CATALOG.map((provider) => provider.id)

export const MEMORY_PROVIDER_SELECT_OPTIONS = MEMORY_PROVIDER_CATALOG.map((provider) => ({
  value: provider.id,
  label: provider.label,
}))

export const MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED = [
  { value: '', label: 'Disabled' },
  ...MEMORY_PROVIDER_SELECT_OPTIONS,
]

export function getMemoryProviderInfo(provider: string | null | undefined): MemoryProviderInfo | null {
  return MEMORY_PROVIDER_CATALOG.find((entry) => entry.id === provider) ?? null
}
