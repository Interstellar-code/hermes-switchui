import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useIsFeatureAvailable } from '@/hooks/use-gateway-caps'

const DEFAULT_NAME = 'Main Agent'
const MIGRATION_GUARD = 'hermes:orchestrator-migration-done'

const LEGACY_KEYS = [
  'operations:orchestrator:name',
  'hermes-switchui-agent-name',
  'conductor:orchestrator:name',
] as const

async function fetchDashboardConfig(): Promise<Record<string, unknown>> {
  const res = await fetch('/api/dashboard-config')
  if (!res.ok) throw new Error(`dashboard-config GET failed: ${res.status}`)
  const data = (await res.json()) as { ok: boolean; config?: Record<string, unknown>; unavailable?: boolean }
  if (data.unavailable) throw new Error('config_unavailable')
  return (data.config as Record<string, unknown>) ?? {}
}

async function patchDashboardConfig(patch: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/dashboard-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch }),
  })
  if (!res.ok) throw new Error(`dashboard-config PUT failed: ${res.status}`)
}

function resolveName(cfg: Record<string, unknown>): string {
  // Tier-2: dashboard config display.agent_name
  const display = cfg.display
  if (display && typeof display === 'object') {
    const name = (display as Record<string, unknown>).agent_name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return DEFAULT_NAME
}

function pickLegacyName(): string | null {
  if (typeof window === 'undefined') return null
  for (const key of LEGACY_KEYS) {
    try {
      const v = window.localStorage.getItem(key)
      if (v && v.trim() && v.trim() !== DEFAULT_NAME) return v.trim()
    } catch { /* noop */ }
  }
  return null
}

export function useOrchestratorIdentity(): {
  name: string
  setName: (s: string) => void
  isLoading: boolean
  isReadOnly: boolean
  error: Error | null
} {
  const configAvailable = useIsFeatureAvailable('config')
  const queryClient = useQueryClient()

  const { data: cfg, isLoading, error } = useQuery<Record<string, unknown>, Error>({
    queryKey: ['orchestrator-identity'],
    queryFn: async () => {
      // Tier-1: dedicated endpoint (expected 404 today — fall through)
      try {
        const r = await fetch('/api/agents/orchestrator')
        if (r.ok) {
          const d = (await r.json()) as { name?: string }
          if (d.name && d.name.trim()) return { _resolvedName: d.name.trim() }
        }
      } catch { /* noop */ }

      // Tier-2: dashboard config
      const dashCfg = await fetchDashboardConfig()

      // One-time migration: if display.agent_name is empty and legacy keys have values
      const resolvedFromDash = resolveName(dashCfg)
      if (
        resolvedFromDash === DEFAULT_NAME &&
        typeof window !== 'undefined' &&
        !window.localStorage.getItem(MIGRATION_GUARD)
      ) {
        const legacy = pickLegacyName()
        if (legacy) {
          try {
            const display = (dashCfg.display && typeof dashCfg.display === 'object')
              ? { ...(dashCfg.display as Record<string, unknown>) }
              : {}
            await patchDashboardConfig({ display: { ...display, agent_name: legacy } })
            // Only clear legacy keys after successful write
            for (const key of LEGACY_KEYS) {
              try { window.localStorage.removeItem(key) } catch { /* noop */ }
            }
            window.localStorage.setItem(MIGRATION_GUARD, '1')
            return { ...dashCfg, display: { ...display, agent_name: legacy } }
          } catch { /* fall through, don't set guard */ }
        } else {
          // No legacy value worth migrating — mark done to avoid re-checking
          window.localStorage.setItem(MIGRATION_GUARD, '1')
        }
      }

      return dashCfg
    },
    enabled: configAvailable === true,
    staleTime: 60_000,
    retry: false,
  })

  const mutation = useMutation<void, Error, string>({
    mutationKey: ['orchestrator-identity-set'],
    mutationFn: async (nextName: string) => {
      const current = cfg ?? {}
      const display = (current.display && typeof current.display === 'object')
        ? { ...(current.display as Record<string, unknown>) }
        : {}
      await patchDashboardConfig({ display: { ...display, agent_name: nextName } })
    },
    onMutate: async (nextName: string) => {
      const previous = queryClient.getQueryData<Record<string, unknown>>(['orchestrator-identity'])
      queryClient.setQueryData<Record<string, unknown>>(['orchestrator-identity'], (old) => {
        const base = old ?? {}
        const display = (base.display && typeof base.display === 'object')
          ? { ...(base.display as Record<string, unknown>) }
          : {}
        return { ...base, display: { ...display, agent_name: nextName } }
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      const context = ctx as { previous?: Record<string, unknown> } | undefined
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['orchestrator-identity'], context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-identity'] })
    },
  })

  if (configAvailable === false) {
    return { name: DEFAULT_NAME, setName: () => {}, isLoading: false, isReadOnly: true, error: null }
  }

  if (configAvailable === null || isLoading) {
    return { name: DEFAULT_NAME, setName: () => {}, isLoading: true, isReadOnly: false, error: null }
  }

  const resolvedName = cfg ? resolveName(cfg) : DEFAULT_NAME

  function setName(s: string) {
    const next = s.trim() || DEFAULT_NAME
    mutation.mutate(next)
  }

  return {
    name: resolvedName,
    setName,
    isLoading: false,
    isReadOnly: false,
    error: error ?? null,
  }
}
