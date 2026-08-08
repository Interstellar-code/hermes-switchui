'use client'

/**
 * use-onboarding-save.ts — THE onboarding write path. There is no other one.
 *
 * Every byte the wizard puts into ~/.hermes/config.yaml or ~/.hermes/.env
 * leaves through `save()` below, and `save()` asks `canWriteConfig` before it
 * does anything else. Concentrating it here is the point: the previous wizard
 * wrote from four different callbacks, so "does a relaunch overwrite a working
 * setup?" could only be answered by reading all four and hoping none was
 * missed. Now the answer is one function, and a step component that wants to
 * write has to accept an `onSave` prop wired to this hook — it cannot reach
 * `/api/claude-config` on its own without that being obvious in review.
 *
 * The three read-ish operations (`verify`, `liveTest`, `restart`) live here
 * too because they are the natural follow-ups to a save and they all need the
 * same lifetime discipline: `verify` polls for up to 20 seconds, so its
 * AbortController is scoped to this hook and aborted on unmount — a poll that
 * outlives the wizard would keep hitting /api/models behind a closed dialog.
 * `liveTest` spends real tokens and is never called automatically.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildOnboardingPatch } from '../lib/onboarding-write'
import { canWriteConfig } from '../lib/relaunch-lock'
import type { OnboardingMode } from '../lib/onboarding-mode'
import type { OnboardingStepId } from '../lib/onboarding-steps'
import type {
  OnboardingDraft,
  OnboardingTransient,
} from '../lib/onboarding-storage'
import type { ProviderChoice } from '../lib/provider-choices'
import type {
  LiveTestOutcome,
  VerifyOutcome,
} from '@/screens/providers/lib/verify-provider'
import {
  sendLiveTestPrompt,
  verifyProviderVisible,
} from '@/screens/providers/lib/verify-provider'
import { useProviderMutations } from '@/screens/providers/hooks/use-provider-mutations'

const GATEWAY_STATUS_KEY = ['onboarding', 'save-gateway-status'] as const

const LOCKED_MESSAGE =
  'Changes are locked for this run. Choose "Change setup" on the summary first — nothing has been written.'

type GatewayStatusPayload = { dashboard?: { available?: boolean } }

async function fetchGatewayStatus(): Promise<GatewayStatusPayload | null> {
  try {
    const res = await fetch('/api/gateway-status')
    if (!res.ok) return null
    return (await res.json()) as GatewayStatusPayload
  } catch {
    return null
  }
}

export type UseOnboardingSaveInput = {
  mode: OnboardingMode
  unlocked: boolean
  /** The step the user is standing on — part of the lock, not decoration. */
  stepId: OnboardingStepId
}

export type OnboardingSaveInput = {
  choice: ProviderChoice
  draft: OnboardingDraft & OnboardingTransient
}

export type UseOnboardingSaveResult = {
  /** Resolves false — without any network call — when the lock refuses. */
  save: (input: OnboardingSaveInput) => Promise<boolean>
  saving: boolean
  saveError: string | null
  saved: boolean
  reset: () => void
  verify: (providerId: string) => Promise<void>
  verifying: boolean
  verifyOutcome: VerifyOutcome | null
  liveTest: () => Promise<void>
  liveTesting: boolean
  liveOutcome: LiveTestOutcome | null
  restart: () => Promise<void>
  restarting: boolean
  canRestart: boolean
}

export function useOnboardingSave({
  mode,
  unlocked,
  stepId,
}: UseOnboardingSaveInput): UseOnboardingSaveResult {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyOutcome, setVerifyOutcome] = useState<VerifyOutcome | null>(null)
  const [liveTesting, setLiveTesting] = useState(false)
  const [liveOutcome, setLiveOutcome] = useState<LiveTestOutcome | null>(null)

  const { restartGateway } = useProviderMutations()

  // One controller for the hook's whole lifetime. Cleared on unmount as well
  // as aborted so a remount (StrictMode's double-invoke, or a reopened
  // wizard) gets a fresh one instead of inheriting an already-aborted signal.
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const statusQuery = useQuery({
    queryKey: GATEWAY_STATUS_KEY,
    queryFn: fetchGatewayStatus,
    retry: false,
  })

  const save = useCallback(
    async ({ choice, draft }: OnboardingSaveInput): Promise<boolean> => {
      // FIRST, before any state change and before any fetch: a refused write
      // must leave no trace on the network at all.
      if (!canWriteConfig({ mode, unlocked, stepId })) {
        setSaveError(LOCKED_MESSAGE)
        return false
      }

      setSaving(true)
      setSaveError(null)

      try {
        // The body is built by `onboarding-write.ts`, which delegates to the
        // providers screen's `write-paths.ts`. Never hand-rolled here: the
        // gateway's accepted shape has one owner.
        const patch = buildOnboardingPatch({
          choice,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey ?? '',
          defaultModel: draft.defaultModel,
          makeActive: draft.makeActive,
        })

        const res = await fetch('/api/claude-config', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const payload = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
        }
        if (!res.ok || payload.ok === false) {
          throw new Error(payload.error ?? `Save failed (HTTP ${res.status})`)
        }

        if (mountedRef.current) setSaved(true)
        return true
      } catch (error) {
        if (mountedRef.current) {
          setSaveError(error instanceof Error ? error.message : 'Save failed')
        }
        return false
      } finally {
        if (mountedRef.current) setSaving(false)
      }
    },
    [mode, stepId, unlocked],
  )

  const reset = useCallback(() => {
    setSaved(false)
    setSaveError(null)
  }, [])

  const verify = useCallback(async (providerId: string) => {
    if (!providerId) return
    if (!abortRef.current) abortRef.current = new AbortController()
    const { signal } = abortRef.current

    setVerifying(true)
    try {
      const outcome = await verifyProviderVisible(providerId, { signal })
      if (mountedRef.current && !signal.aborted) setVerifyOutcome(outcome)
    } finally {
      if (mountedRef.current) setVerifying(false)
    }
  }, [])

  const liveTest = useCallback(async () => {
    setLiveTesting(true)
    try {
      const outcome = await sendLiveTestPrompt()
      if (mountedRef.current) setLiveOutcome(outcome)
    } finally {
      if (mountedRef.current) setLiveTesting(false)
    }
  }, [])

  const restart = useCallback(async () => {
    try {
      await restartGateway.mutateAsync()
    } catch {
      // Best-effort: the verify step re-reads real gateway state either way,
      // and a failed restart is not a reason to strand the user on this step.
    }
  }, [restartGateway])

  return {
    save,
    saving,
    saveError,
    saved,
    reset,
    verify,
    verifying,
    verifyOutcome,
    liveTest,
    liveTesting,
    liveOutcome,
    restart,
    restarting: restartGateway.isPending,
    canRestart: statusQuery.data?.dashboard?.available === true,
  }
}
