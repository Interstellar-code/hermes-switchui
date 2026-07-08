import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { ThinkingLevel } from '../components/chat-composer-types'
import { _localModelOverride } from '@/screens/chat/local-model-override'
import { useSessionModelStore } from '@/stores/session-model-store'

export function useThinkingLevel(params: {
  activeFriendlyId: string
  resolvedSessionKey: string | undefined
  forcedSessionKey: string | undefined
}) {
  const { activeFriendlyId, resolvedSessionKey, forcedSessionKey } = params

  // Per-session thinking level — stored in sessionStorage keyed by session
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() => {
    if (typeof window === 'undefined') return 'low'
    const key = `claude-thinking-${activeFriendlyId || 'new'}`
    const stored = window.sessionStorage.getItem(key)
    if (stored === 'off' || stored === 'low' || stored === 'adaptive')
      return stored
    return 'low'
  })

  // Phase 4.1: Smart Model Suggestions
  const modelsQuery = useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await fetch('/api/models')
      if (!res.ok) return { models: [] }
      const data = await res.json()
      return data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const currentModelQuery = useQuery({
    queryKey: ['claude', 'session-status-model'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/session-status')
        if (!res.ok) return ''
        const data = await res.json()
        const payload = data.payload ?? data
        // Same logic as chat-composer: read model from status payload
        if (payload.model) return String(payload.model)
        if (payload.currentModel) return String(payload.currentModel)
        if (payload.modelAlias) return String(payload.modelAlias)
        if (payload.resolved?.modelProvider && payload.resolved?.model) {
          return `${payload.resolved.modelProvider}/${payload.resolved.model}`
        }
        return ''
      } catch {
        return ''
      }
    },
    refetchInterval: 30_000,
    retry: false,
  })

  const availableModelIds = useMemo(() => {
    const models = modelsQuery.data?.models || []
    return models.map((m: any) => m.id).filter((id: string) => id)
  }, [modelsQuery.data])

  const gatewayModel = currentModelQuery.data || ''
  // Per-session model override (set in the composer dropdown). Browser-local,
  // keyed by sessionKey. Takes precedence over the gateway-reported model so
  // the user's choice survives refresh and is sent on every chat completion.
  const sessionModelOverride = useSessionModelStore((s) =>
    s.getModel(resolvedSessionKey || forcedSessionKey || null),
  )
  const currentModel =
    _localModelOverride || sessionModelOverride || gatewayModel

  // Ref so sendMessage can always read latest thinkingLevel without being in deps
  const thinkingLevelRef = useRef<ThinkingLevel>(thinkingLevel)
  useEffect(() => {
    thinkingLevelRef.current = thinkingLevel
  }, [thinkingLevel])

  // Auto-upgrade thinking to adaptive for Claude 4.6 when session first loads
  const thinkingInitializedRef = useRef(false)
  useEffect(() => {
    if (!currentModel) return
    if (thinkingInitializedRef.current) return
    thinkingInitializedRef.current = true
    const is46 =
      currentModel.toLowerCase().includes('4-6') ||
      currentModel.toLowerCase().includes('claude-4.6')
    if (is46) {
      const key = `claude-thinking-${activeFriendlyId || 'new'}`
      const stored =
        typeof window !== 'undefined'
          ? window.sessionStorage.getItem(key)
          : null
      // Only auto-set if not explicitly configured
      if (!stored) {
        setThinkingLevel('adaptive')
      }
    }
  }, [currentModel, activeFriendlyId])

  // Persist thinking level changes to sessionStorage
  const handleThinkingLevelChange = useCallback(
    (level: ThinkingLevel) => {
      setThinkingLevel(level)
      if (typeof window !== 'undefined') {
        const key = `claude-thinking-${activeFriendlyId || 'new'}`
        window.sessionStorage.setItem(key, level)
      }
    },
    [activeFriendlyId],
  )

  return {
    thinkingLevel,
    thinkingLevelRef,
    handleThinkingLevelChange,
    currentModel,
    availableModelIds,
    modelsQuery,
    currentModelQuery,
  }
}
