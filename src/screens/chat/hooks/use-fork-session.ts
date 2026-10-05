import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateSessionLists } from '../sessions-feed'
import { profileBody, readSendFailure } from '@/lib/session-scope'

export type ForkSessionResult = {
  /** Resolves to the new session's key. */
  forkSession: (
    sessionKey: string,
    options?: { atMessageId?: string; endSource?: boolean; title?: string },
  ) => Promise<string>
  forking: boolean
  error: string | null
}

type ForkSessionResponse = {
  ok?: boolean
  sessionKey?: string
  forkedFrom?: string
  ended_source?: boolean
}

/**
 * Branch the given session.
 *
 * Note the source session is *ended* by the gateway (`end_reason: "branched"`)
 * — this is not a plain copy — so both list caches are invalidated, not just
 * patched with the new row.
 */
export function useForkSession(): ForkSessionResult {
  const queryClient = useQueryClient()
  const [forking, setForking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async function forkSessionRequest(payload: {
      sessionKey: string
      atMessageId?: string
      endSource?: boolean
      title?: string
    }) {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(payload.sessionKey)}/fork`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Optional params are omitted entirely when unset so existing
          // callers' bodies stay byte-identical and gateway defaults apply.
          body: JSON.stringify({
            ...profileBody(),
            ...(payload.atMessageId
              ? { at_message_id: payload.atMessageId }
              : {}),
            ...(typeof payload.endSource === 'boolean'
              ? { end_source: payload.endSource }
              : {}),
            ...(payload.title ? { title: payload.title } : {}),
          }),
        },
      )
      if (!res.ok) throw new Error(await readSendFailure(res))
      const data = (await res.json()) as ForkSessionResponse
      if (!data.sessionKey) {
        throw new Error('Fork succeeded but returned no session key')
      }
      return data.sessionKey
    },
    onMutate: function onMutate() {
      setError(null)
    },
    onError: function onError(err) {
      setError(err instanceof Error ? err.message : String(err))
    },
    onSuccess: function onSuccess() {
      // Both the branch and the now-ended source changed — refetch rather
      // than patch (#218: two independent session-list caches).
      invalidateSessionLists(queryClient, { refetchTotals: false })
    },
    onSettled: function onSettled() {
      setForking(false)
    },
  })

  const forkSession = useCallback(
    async (
      sessionKey: string,
      options?: {
        atMessageId?: string
        endSource?: boolean
        title?: string
      },
    ) => {
      if (!sessionKey) throw new Error('sessionKey required')
      setForking(true)
      return mutation.mutateAsync({ sessionKey, ...options })
    },
    [mutation],
  )

  return { forkSession, forking, error }
}
