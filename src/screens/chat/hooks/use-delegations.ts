import { useQuery } from '@tanstack/react-query'
import { fetchHistory } from '../chat-queries'
import { readError } from '../utils'
import type { Delegation } from '../../../server/delegations'

type DelegationsResponse = {
  ok: boolean
  delegations?: Array<Delegation>
  error?: string
}

async function fetchDelegations(sessionKey: string): Promise<Array<Delegation>> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionKey)}/delegations`,
  )
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as DelegationsResponse
  if (!data.ok) throw new Error(data.error || 'Failed to load delegations')
  return data.delegations ?? []
}

export function useDelegations(sessionKey: string) {
  const query = useQuery({
    queryKey: ['chat', 'delegations', sessionKey],
    queryFn: () => fetchDelegations(sessionKey),
    enabled: sessionKey.length > 0,
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
    queryKey: ['chat', 'delegation-messages', childSessionId],
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
