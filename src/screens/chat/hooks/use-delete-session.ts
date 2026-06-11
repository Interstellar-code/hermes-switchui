import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  chatQueryKeys,
  clearHistoryMessages,
  removeSessionFromCache,
} from '../chat-queries'
import { clearPendingSendForSession, resetPendingSend } from '../pending-send'
import { clearSessionDeleted, markSessionDeleted } from '../session-tombstones'
import { SESSIONS_FEED_KEY, invalidateSessionLists } from '../sessions-feed'
import { readError } from '../utils'
import { clearSessionTitleState } from '../session-title-store'
import { useSessionModelStore } from '@/stores/session-model-store'

export type DeleteSessionResult = {
  deleteSession: (
    sessionKey: string,
    friendlyId: string,
    isActive: boolean,
  ) => Promise<void>
  deleting: boolean
  error: string | null
}

export function useDeleteSession(): DeleteSessionResult {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async function deleteSessionRequest(payload: {
      sessionKey: string
      friendlyId: string
      isActive: boolean
    }) {
      const query = new URLSearchParams()
      if (payload.sessionKey) query.set('sessionKey', payload.sessionKey)
      if (payload.friendlyId) query.set('friendlyId', payload.friendlyId)
      const res = await fetch(`/api/sessions?${query.toString()}`, {
        method: 'DELETE',
      })
      // 404 = backend already lacks this session; treat as already-deleted so
      // stale UI rows can be cleared without a hard error.
      if (!res.ok && res.status !== 404) throw new Error(await readError(res))
      return payload
    },
    onMutate: async function onMutate(payload) {
      setError(null)
      markSessionDeleted(payload.sessionKey || payload.friendlyId)
      clearPendingSendForSession(payload.sessionKey, payload.friendlyId)
      await queryClient.cancelQueries({ queryKey: chatQueryKeys.sessions })
      // Optimistically drop the card from the V2 sidebar feed (tombstone-backed)
      queryClient.invalidateQueries({ queryKey: SESSIONS_FEED_KEY })
    },
    onError: function onError(err, _payload, _context) {
      clearSessionDeleted(_payload.sessionKey || _payload.friendlyId)
      setError(err instanceof Error ? err.message : String(err))
      // Delete failed — tombstone cleared, refetch to restore the card
      queryClient.invalidateQueries({ queryKey: SESSIONS_FEED_KEY })
    },
    onSuccess: function onSuccess(payload) {
      removeSessionFromCache(
        queryClient,
        payload.sessionKey,
        payload.friendlyId,
      )
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
      clearSessionTitleState(payload.friendlyId || payload.sessionKey)
      const clearModel = useSessionModelStore.getState().clearModel
      if (payload.sessionKey) clearModel(payload.sessionKey)
      if (payload.friendlyId && payload.friendlyId !== payload.sessionKey) {
        clearModel(payload.friendlyId)
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
