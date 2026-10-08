import { useQuery } from '@tanstack/react-query'
import { readError } from '../utils'
import {
  activeScopeKey,
  activeScopeSegments,
  getSessionProfile,
} from '@/lib/session-scope'

/**
 * One skill or MCP tool call from anywhere in the session, as returned by
 * `/api/sessions/$sessionKey/tool-usage`. Deliberately thinner than
 * `FlatToolEntry`: an older call has no output text and no reliable timestamp,
 * and the loaded window already covers everything recent.
 */
export type SessionToolUsageEntry = {
  /** Gateway tool-call id; the join key against the loaded window. */
  callId: string
  name: string
  args?: Record<string, unknown>
  isError: boolean
}

type ToolUsageResponse = {
  ok: boolean
  entries?: Array<SessionToolUsageEntry>
  error?: string
}

const NO_ENTRIES: Array<SessionToolUsageEntry> = []

/**
 * Profile-scoped key. Session ids are not unique across Hermes profiles, so a
 * bare `['chat', 'tool-usage', id]` would be a silent cross-profile cache hit.
 * `chatQueryKeys` (chat-queries.ts) is the canonical home for these keys, but it
 * is outside this task's write set — these same scope primitives keep the key
 * safe in the meantime.
 */
function sessionToolUsageKey(sessionKey: string): Array<string> {
  return [
    'chat',
    'tool-usage',
    ...activeScopeSegments(),
    activeScopeKey(sessionKey),
  ]
}

async function fetchSessionToolUsage(
  sessionKey: string,
): Promise<Array<SessionToolUsageEntry>> {
  if (!sessionKey || sessionKey === 'new') return []
  const query = new URLSearchParams()
  const profile = getSessionProfile()
  if (profile) query.set('profile', profile)
  const qs = query.toString()
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionKey)}/tool-usage${qs ? `?${qs}` : ''}`,
  )
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as ToolUsageResponse
  if (!data.ok)
    throw new Error(data.error || 'Failed to load session tool usage')
  return data.entries ?? []
}

/**
 * Whole-session skill + MCP calls, fetched only when the loaded history is
 * truncated (`historyCapped`). Below the cap the loaded window already holds
 * every call, so the request is skipped and nothing changes.
 */
export function useSessionToolUsage(params: {
  sessionKey: string
  enabled: boolean
}) {
  const { sessionKey, enabled } = params
  const hasSession = Boolean(sessionKey && sessionKey !== 'new')

  const query = useQuery({
    queryKey: sessionToolUsageKey(sessionKey),
    queryFn: () => fetchSessionToolUsage(sessionKey),
    enabled: enabled && hasSession,
    // The loaded window covers calls made after the page was loaded, so a
    // minute of staleness costs at most one undercount on a very old session.
    staleTime: 60_000,
  })

  return {
    entries: query.data ?? NO_ENTRIES,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}
