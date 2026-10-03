import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  chatQueryKeys,
  clearHistoryMessages,
  removeSessionFromCache,
} from '../chat-queries'
import { clearPendingSendForSession, resetPendingSend } from '../pending-send'
import { clearSessionDeleted, markSessionDeleted } from '../session-tombstones'
import { invalidateSessionLists, sessionsFeedKey } from '../sessions-feed'
import { clearSessionTitleState } from '../session-title-store'
import { useSessionModelStore } from '@/stores/session-model-store'
import { profileBody, readSendFailure } from '@/lib/session-scope'
import { runPool } from '@/lib/run-pool'

export type DeleteSessionResult = {
  deleteSession: (
    sessionKey: string,
    friendlyId: string,
    isActive: boolean,
  ) => Promise<void>
  deleting: boolean
  error: string | null
}

/** DELETE one session. 404 = already gone, treated as success. */
async function deleteSessionRequest(
  sessionKey: string,
  friendlyId: string,
): Promise<void> {
  const query = new URLSearchParams()
  if (sessionKey) query.set('sessionKey', sessionKey)
  if (friendlyId) query.set('friendlyId', friendlyId)
  // Only attach a JSON body (and Content-Type) when a profile is
  // ambient — keeps the unscoped request byte-identical to before.
  const scope = profileBody()
  const res = await fetch(`/api/sessions?${query.toString()}`, {
    method: 'DELETE',
    ...(Object.keys(scope).length
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(scope),
        }
      : {}),
  })
  // 404 = backend already lacks this session; treat as already-deleted so
  // stale UI rows can be cleared without a hard error.
  if (!res.ok && res.status !== 404) throw new Error(await readSendFailure(res))
}

/** Local cleanup after a confirmed delete (caches, titles, models). */
function forgetSession(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionKey: string,
  friendlyId: string,
) {
  removeSessionFromCache(queryClient, sessionKey, friendlyId)
  clearSessionTitleState(friendlyId || sessionKey)
  const clearModel = useSessionModelStore.getState().clearModel
  if (sessionKey) clearModel(sessionKey)
  if (friendlyId && friendlyId !== sessionKey) clearModel(friendlyId)
}

export function useDeleteSession(): DeleteSessionResult {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async function deleteSessionMutation(payload: {
      sessionKey: string
      friendlyId: string
      isActive: boolean
    }) {
      await deleteSessionRequest(payload.sessionKey, payload.friendlyId)
      return payload
    },
    onMutate: async function onMutate(payload) {
      setError(null)
      markSessionDeleted(payload.sessionKey || payload.friendlyId)
      clearPendingSendForSession(payload.sessionKey, payload.friendlyId)
      await queryClient.cancelQueries({ queryKey: chatQueryKeys.sessions })
      // Optimistically drop the card from the V2 sidebar feed (tombstone-backed)
      queryClient.invalidateQueries({ queryKey: sessionsFeedKey() })
    },
    onError: function onError(err, _payload, _context) {
      clearSessionDeleted(_payload.sessionKey || _payload.friendlyId)
      setError(err instanceof Error ? err.message : String(err))
      // Delete failed — tombstone cleared, refetch to restore the card
      queryClient.invalidateQueries({ queryKey: sessionsFeedKey() })
    },
    onSuccess: function onSuccess(payload) {
      forgetSession(queryClient, payload.sessionKey, payload.friendlyId)
      if (payload.isActive && (payload.sessionKey || payload.friendlyId)) {
        clearHistoryMessages(
          queryClient,
          payload.friendlyId || payload.sessionKey,
          payload.sessionKey || payload.friendlyId,
        )
      }
      if (payload.isActive) {
        resetPendingSend()
      }
      // Refetch both session-list caches so the card is removed everywhere (#218).
      invalidateSessionLists(queryClient)
    },
    onSettled: function onSettled() {
      setDeleting(false)
    },
  })

  const deleteSession = useCallback(
    async (sessionKey: string, friendlyId: string, isActive: boolean) => {
      if (!sessionKey && !friendlyId) return
      setDeleting(true)
      await mutation.mutateAsync({ sessionKey, friendlyId, isActive })
    },
    [mutation],
  )

  return { deleteSession, deleting, error }
}

/**
 * Delete many sessions: ≤4 requests in flight, tombstones up front so cards
 * vanish immediately, failed ones restored, ONE list invalidate at the end.
 * Callers navigate away themselves if the open chat was among them.
 * (Dashboard has POST /api/sessions/bulk-delete but SwitchUI has no proxy for
 * it and it skips local sessions; per-session DELETE reuses the proven route.)
 */
export function useBulkDeleteSessions() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<{
    done: number
    total: number
  } | null>(null)

  const deleteSessions = useCallback(
    async (
      sessionKeys: Array<string>,
      /** Open chat's session key — its history/pending send get cleared too. */
      activeKey?: string | null,
    ): Promise<Array<string>> => {
      setProgress({ done: 0, total: sessionKeys.length })
      try {
        for (const key of sessionKeys) {
          markSessionDeleted(key)
          clearPendingSendForSession(key, key)
        }
        await queryClient.cancelQueries({ queryKey: chatQueryKeys.sessions })
        void queryClient.invalidateQueries({ queryKey: sessionsFeedKey() })
        const results = await runPool(
          sessionKeys,
          4,
          (key) => deleteSessionRequest(key, key),
          (done) => setProgress({ done, total: sessionKeys.length }),
        )
        const failed: Array<string> = []
        results.forEach((r, i) => {
          const key = sessionKeys[i]
          if (r.status === 'fulfilled') {
            forgetSession(queryClient, key, key)
            if (key === activeKey) {
              clearHistoryMessages(queryClient, key, key)
              resetPendingSend()
            }
          } else {
            clearSessionDeleted(key)
            failed.push(key)
          }
        })
        invalidateSessionLists(queryClient)
        // Tombstones cleared for failures — refetch the feed to restore them.
        if (failed.length)
          void queryClient.invalidateQueries({ queryKey: sessionsFeedKey() })
        return failed
      } finally {
        setProgress(null)
      }
    },
    [queryClient],
  )

  return { deleteSessions, progress }
}
