'use client'

/**
 * use-connect-status.ts — the four reads behind the Connect step, and the
 * self-heal actions it can offer.
 *
 * Every probe is fetched independently and never throws: a failed fetch
 * degrades to `null`, which `buildTrustBoundaries` turns into `'unknown'`
 * rather than a false `'fail'`. Nothing here pre-judges a response — the raw
 * (possibly null) payloads go to the pure builder verbatim, so every
 * interesting case is a row in that module's unit test rather than something
 * only reachable through a mocked network.
 *
 * `/api/credentials` is in the set because the third boundary cannot be
 * answered without it: `/api/claude-config`'s `configured: true` is the
 * boolean this whole rebuild is moving away from.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildTrustBoundaries } from '../lib/trust-boundaries'
import type {
  AuthCheckPayload,
  BoundaryHeal,
  CredentialsPayload,
  GatewayStatusPayload,
  TrustBoundary,
} from '../lib/trust-boundaries'
import { useProviderMutations } from '@/screens/providers/hooks/use-provider-mutations'

async function safeFetchJson<T>(
  url: string,
  signal: AbortSignal,
): Promise<T | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    return (await res.json()) as T
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

export type UseConnectStatusResult = {
  boundaries: Array<TrustBoundary>
  /** The gateway URL this workspace is talking to, when it reported one. */
  gatewayUrl: string | null
  agentVersion: string | null
  /** The raw credential report, so the provider step can reuse it. */
  credentials: CredentialsPayload
  loading: boolean
  refetch: () => void
  heal: (
    action: NonNullable<BoundaryHeal>,
    payload?: { gatewayUrl?: string },
  ) => Promise<void>
  healing: string | null
}

export function useConnectStatus(input: {
  enabled: boolean
  /**
   * The `canWriteConfig` verdict. The probes are reads and always run; the
   * heal actions POST `/api/start-agent`, `/api/gateway-reprobe`, rewrite the
   * connection settings and restart the gateway. Restarting someone's gateway
   * from a screen that says "read-only" is the violation this guard prevents.
   */
  canWrite: boolean
  /** The provider `config.yaml` names as active, for the third boundary. */
  activeProvider: string | null
}): UseConnectStatusResult {
  const { enabled, canWrite, activeProvider } = input
  const [auth, setAuth] = useState<AuthCheckPayload>(null)
  const [gateway, setGateway] = useState<GatewayStatusPayload>(null)
  const [credentials, setCredentials] = useState<CredentialsPayload>(null)
  const [agentVersion, setAgentVersion] = useState<string | null>(null)
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
      safeFetchJson<NonNullable<AuthCheckPayload>>(
        '/api/auth-check',
        controller.signal,
      ),
      safeFetchJson<NonNullable<GatewayStatusPayload>>(
        '/api/gateway-status',
        controller.signal,
      ),
      safeFetchJson<{ version?: string | null }>(
        '/api/agent-version',
        controller.signal,
      ),
      safeFetchJson<NonNullable<CredentialsPayload>>(
        '/api/credentials',
        controller.signal,
      ),
    ])
      .then(
        ([authPayload, gatewayPayload, versionPayload, credentialPayload]) => {
          if (controller.signal.aborted || !mountedRef.current) return
          setAuth(authPayload)
          setGateway(gatewayPayload)
          setAgentVersion(versionPayload?.version ?? null)
          setCredentials(credentialPayload)
        },
      )
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
      action: NonNullable<BoundaryHeal>,
      payload?: { gatewayUrl?: string },
    ) => {
      if (!canWrite) return
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
          const nextGatewayUrl = payload?.gatewayUrl?.trim()
          if (nextGatewayUrl) {
            try {
              await fetch('/api/connection-settings', {
                method: 'PUT',
                signal: controller.signal,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ gateway: nextGatewayUrl }),
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
    [canWrite, load, restartGateway],
  )

  const boundaries = buildTrustBoundaries({
    auth,
    gateway,
    credentials,
    agentVersion,
    activeProvider,
  })

  return {
    boundaries,
    gatewayUrl: gateway?.gateway?.url ?? gateway?.claudeUrl ?? null,
    agentVersion,
    credentials,
    loading,
    refetch: load,
    heal,
    healing,
  }
}
