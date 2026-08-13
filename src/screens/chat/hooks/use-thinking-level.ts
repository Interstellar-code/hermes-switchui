import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { ThinkingLevel } from '../components/chat-composer-types'
import { normalizeThinkingLevel } from '@/lib/reasoning-effort'
import { useSessionModelStore } from '@/stores/session-model-store'

export function useThinkingLevel(params: {
  activeFriendlyId: string
  /**
   * Canonical per-session key for model persistence — MUST use the exact
   * same precedence chat-screen.tsx uses to key `useSessionModelStore` on
   * write (`forcedSessionKey || resolvedSessionKey || activeSessionKey ||
   * activeFriendlyId`). A mismatched precedence here is what silently
   * dropped the per-session model on new chats (#348 task 5) — the write
   * landed under one key and this read looked under another.
   */
  modelSessionKey: string | undefined
}) {
  const { activeFriendlyId, modelSessionKey } = params

  // Per-session thinking level — stored in sessionStorage keyed by session
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() => {
    if (typeof window === 'undefined') return 'low'
    const key = `claude-thinking-${activeFriendlyId || 'new'}`
    const stored = window.sessionStorage.getItem(key)
    // Validated against the canonical level list, NOT a hand-written
    // allowlist. The allowlist here used to be `off | low | adaptive`, so a
    // stored `medium`/`high` — both offered by the picker, both persisted by
    // handleThinkingLevelChange below — was silently rehydrated as `low`.
    // Those two levels were unreachable after a reload.
    return normalizeThinkingLevel(stored) ?? 'low'
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
  // Per-session model override (set in the composer dropdown or `/model`).
  // Browser-local, keyed by sessionKey — takes precedence over the
  // gateway-reported model so the user's choice survives refresh and is
  // sent on every chat completion. Local-provider picks (ollama,
  // atomic-chat, ...) live here too now; there is no separate global
  // override to consult (see chat-composer-services.ts `switchModel`).
  const sessionModelOverride = useSessionModelStore((s) =>
    s.getModel(modelSessionKey),
  )
  const currentModel = sessionModelOverride || gatewayModel

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
