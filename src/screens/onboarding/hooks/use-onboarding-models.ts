/**
 * use-onboarding-models.ts — models for the connect step's model selector.
 *
 * `GET /api/models` returns every model the gateway currently knows about
 * across all configured providers, tagged with a `provider` field — there is
 * no per-provider query param. This hook fetches once, filters client-side to
 * the provider the user is connecting, and strips the `provider/` prefix
 * hermes-agent adds internally so the UI shows the bare model id.
 *
 * Never throws: any failure (network, non-2xx, bad JSON) collapses to an
 * empty list plus an error string, so the connect step can fall back to a
 * free-text input rather than getting stuck.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  normalizeProviderId,
  stripProviderPrefix,
} from '@/lib/provider-catalog'

export type UseOnboardingModelsInput = {
  enabled: boolean
  providerId: string | null
}

export type UseOnboardingModelsResult = {
  models: Array<string>
  loading: boolean
  error: string | null
  refetch: () => void
}

type ModelsApiRow = { id?: unknown; provider?: unknown }

type ModelsApiResponse = {
  data?: Array<ModelsApiRow>
  models?: Array<ModelsApiRow>
}

export function useOnboardingModels({
  enabled,
  providerId,
}: UseOnboardingModelsInput): UseOnboardingModelsResult {
  const [models, setModels] = useState<Array<string>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  const refetch = useCallback(() => setGeneration((value) => value + 1), [])

  // Abort belongs to the effect below via its own AbortController — this ref
  // only exists so a stray unmount between renders still cancels the fetch.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()

    if (!enabled || !providerId) {
      setModels([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    const targetId = normalizeProviderId(providerId)

    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const res = await fetch('/api/models', { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const data = (await res.json()) as ModelsApiResponse
        // The old wizard checked `.data` then `.models` — both fields carry
        // the same array from the server today, but this keeps working if
        // that ever changes.
        const rows = data.data ?? data.models ?? []

        const ids = new Set<string>()
        for (const row of rows) {
          if (normalizeProviderId(String(row.provider ?? '')) !== targetId) {
            continue
          }
          if (typeof row.id !== 'string' || !row.id) continue
          ids.add(stripProviderPrefix(row.id))
        }

        if (!controller.signal.aborted) {
          setModels([...ids])
          setLoading(false)
        }
      } catch (fetchError) {
        if (controller.signal.aborted) return
        setModels([])
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Failed to load models',
        )
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [enabled, providerId, generation])

  return { models, loading, error, refetch }
}
