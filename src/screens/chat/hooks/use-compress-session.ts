import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@/components/ui/toast'
import { useContextUsageStore } from '@/stores/context-usage-store'

type CompressResponse = {
  ok?: boolean
  error?: string
  compressed?: boolean
  message?: string
  continuationKey?: string | null
  beforeMessages?: number | null
  afterMessages?: number | null
}

/**
 * Manual compress for one chat via `/api/sessions/:key/compress`. Shared by
 * the context ring and the context-full alert. On success it refetches chat
 * queries and, when compression rotated the session, follows the continuation.
 * Resolves true only when something was actually compressed.
 */
export function useCompressSession(sessionKey: string | null | undefined) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [compressing, setCompressing] = useState(false)

  async function compress(): Promise<boolean> {
    if (!sessionKey || compressing) return false
    setCompressing(true)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionKey)}/compress`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      )
      const data = (await res.json().catch(() => ({}))) as CompressResponse
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast(data.message || 'Context compressed', {
        type: data.compressed ? 'success' : 'info',
      })
      if (!data.compressed) return false
      // Same inline divider as an auto-compaction (#364). A rotated session
      // navigates away, so only an in-place compress gets one here.
      if (!data.continuationKey) {
        useContextUsageStore.getState().recordCompaction({
          sessionKey,
          messagesBefore: data.beforeMessages ?? undefined,
          messagesAfter: data.afterMessages ?? undefined,
          source: 'manual',
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['chat'] })
      if (data.continuationKey) {
        void navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: data.continuationKey },
        })
      }
      return true
    } catch (err) {
      toast(
        `Compress failed\n${err instanceof Error ? err.message : String(err)}`,
        { type: 'error' },
      )
      return false
    } finally {
      setCompressing(false)
    }
  }

  return { compress, compressing }
}
