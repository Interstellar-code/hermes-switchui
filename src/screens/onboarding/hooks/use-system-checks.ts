'use client'

/**
 * use-system-checks.ts — fetches the four best-effort health probes the
 * system-check step renders, and dispatches the inline self-heal actions
 * `buildSystemChecks` may attach to a row.
 *
 * Every probe is fetched independently and never throws: a failed fetch
 * degrades to `null`, which `buildSystemChecks` already turns into an
 * `'unknown'` status rather than a false `'fail'`. This hook must preserve
 * that guarantee end to end, so nothing here pre-judges a response — the
 * raw (possibly null) payloads are handed to `buildSystemChecks` verbatim.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildSystemChecks } from '../lib/system-checks'
import type { SystemCheck } from '../lib/system-checks'
import { useProviderMutations } from '@/screens/providers/hooks/use-provider-mutations'

async function safeFetchJson(
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function postJson(url: string, signal: AbortSignal, body?: unknown) {
  try {
    await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    // Best-effort — the follow-up refetch surfaces the real state either way.
  }
}

export type UseSystemChecksResult = {
  checks: Array<SystemCheck>
  loading: boolean
  refetch: () => void
  heal: (
    action: NonNullable<SystemCheck['heal']>,
    payload?: { gatewayUrl?: string },
  ) => Promise<void>
  healing: string | null
}

export function useSystemChecks(input: {
  enabled: boolean
}): UseSystemChecksResult {
  const { enabled } = input
  const [checks, setChecks] = useState<Array<SystemCheck>>([])
  const [loading, setLoading] = useState(false)
  const [healing, setHealing] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const { restartGateway } = useProviderMutations()

  const load = useCallback(() => {
    if (!enabled) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    void Promise.all([
      safeFetchJson('/api/gateway-status', controller.signal),
      safeFetchJson('/api/system-metrics', controller.signal),
      safeFetchJson('/api/agent-version', controller.signal),
      safeFetchJson('/api/update/status', controller.signal),
    ])
      .then(([gateway, metrics, agentVersion, update]) => {
        if (controller.signal.aborted || !mountedRef.current) return
        setChecks(buildSystemChecks({ gateway, metrics, agentVersion, update }))
      })
      .finally(() => {
        if (controller.signal.aborted || !mountedRef.current) return
        setLoading(false)
      })
  }, [enabled])

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [load])

  const heal = useCallback(
    async (
      action: NonNullable<SystemCheck['heal']>,
      payload?: { gatewayUrl?: string },
    ) => {
      setHealing(action)
      const controller = new AbortController()
      try {
        if (action === 'start-agent') {
          await postJson('/api/start-agent', controller.signal)
        } else if (action === 'restart-gateway') {
          await restartGateway.mutateAsync().catch(() => undefined)
        } else if (action === 'reprobe') {
          await postJson('/api/gateway-reprobe', controller.signal)
        } else {
          const gatewayUrl = payload?.gatewayUrl?.trim()
          if (gatewayUrl) {
            try {
              await fetch('/api/connection-settings', {
                method: 'PUT',
                signal: controller.signal,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ gateway: gatewayUrl }),
              })
            } catch {
              // Best-effort — surfaced by the refetch below.
            }
          }
        }
      } finally {
        if (mountedRef.current) setHealing(null)
        load()
      }
    },
    [load, restartGateway],
  )

  return { checks, loading, refetch: load, heal, healing }
}
