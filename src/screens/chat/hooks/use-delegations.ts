import { useQuery } from '@tanstack/react-query'
import { chatQueryKeys, fetchHistory } from '../chat-queries'
import { readError } from '../utils'
import type { Delegation } from '../../../server/delegations'
import type { StreamingDelegation } from '../../../stores/chat-store'
import { getSessionProfile } from '@/lib/session-scope'

type DelegationsResponse = {
  ok: boolean
  delegations?: Array<Delegation>
  error?: string
}

/** Count persisted and live agents once when both sources describe the same child. */
export function countSessionAgents(
  delegations: Array<Pick<Delegation, 'childSessionId'>>,
  streamingDelegations: Array<Pick<StreamingDelegation, 'subagentId' | 'childSessionId'>>,
): number {
  const ids = new Set(delegations.map((delegation) => delegation.childSessionId))
  for (const delegation of streamingDelegations) {
    ids.add(delegation.childSessionId || `stream:${delegation.subagentId}`)
  }
  return ids.size
}

/**
 * A persisted child is live only while its server-derived status is running.
 * A stream event is live until it explicitly reports a terminal status, which
 * keeps the trigger responsive before the child reaches the local database.
 */
export function hasActiveSessionAgents(
  delegations: Array<Pick<Delegation, 'status'>>,
  streamingDelegations: Array<Pick<StreamingDelegation, 'status'>>,
): boolean {
  if (delegations.some((delegation) => delegation.status === 'running')) return true

  return streamingDelegations.some((delegation) => {
    const status = delegation.status?.toLowerCase()
    return !status || ![
      'completed',
      'failed',
      'error',
      'aborted',
      'cancelled',
      'canceled',
      'stopped',
    ].includes(status)
  })
}

async function fetchDelegations(sessionKey: string): Promise<Array<Delegation>> {
  if (!sessionKey || sessionKey === 'new') return []
  const query = new URLSearchParams()
  const profile = getSessionProfile()
  if (profile) query.set('profile', profile)
  const qs = query.toString()
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionKey)}/delegations${qs ? `?${qs}` : ''}`,
  )
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as DelegationsResponse
  if (!data.ok) throw new Error(data.error || 'Failed to load delegations')
  return data.delegations ?? []
}

export function useDelegations(sessionKey: string) {
  const query = useQuery({
    queryKey: chatQueryKeys.delegations(sessionKey),
    queryFn: () => fetchDelegations(sessionKey),
    enabled: Boolean(sessionKey && sessionKey !== 'new'),
    // ponytail: base 12s poll so a delegation spawned mid-session is picked up
    // (the initial fetch is empty, so a running-only interval would never restart);
    // 5s while any child is running for a live-ticking elapsed. Ceiling: one small
    // query per session every 12s — gate on streaming state if it ever shows up on a profile.
    refetchInterval: (q) => {
      const data = q.state.data
      const hasRunning = Array.isArray(data) && data.some((d) => d.status === 'running')
      return hasRunning ? 5_000 : 12_000
    },
  })

  return {
    delegations: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}

/** Drill-in: fetch a single delegation's full message transcript on demand. */
export function useDelegationMessages(childSessionId: string | null) {
  const query = useQuery({
    queryKey: chatQueryKeys.delegationMessages(childSessionId ?? ''),
    queryFn: () =>
      fetchHistory({ sessionKey: childSessionId ?? '', friendlyId: childSessionId ?? '' }),
    enabled: Boolean(childSessionId),
  })

  return {
    messages: query.data?.messages ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}
