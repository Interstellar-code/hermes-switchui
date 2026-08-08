/**
 * use-provider-mutations.ts — every write the providers screen performs.
 *
 * All config writes go through `PATCH /api/claude-config` with bodies built by
 * the pure helpers in ../lib/write-paths, and deletes through the dedicated
 * DELETE verb. Each success invalidates the whole `['providers']` prefix plus
 * the keys other screens read, so the sidebar and chat pick up a provider
 * switch without a reload.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  buildInlineProviderPatch,
  buildProviderPatch,
  buildSetActivePatch,
} from '../lib/write-paths'
import type { ClaudeConfigPatch, ProviderDraft } from '../lib/write-paths'
import { gatewayRestart } from '@/lib/hermes-client'

export type PatchResult = {
  ok?: boolean
  error?: string
  message?: string
  requiresGatewayRestart?: boolean
}

export type DeleteResult = PatchResult & {
  removed?: string
  removedEnvKey?: string | null
  clearedActiveProvider?: boolean
}

async function patchConfig(patch: ClaudeConfigPatch): Promise<PatchResult> {
  const res = await fetch('/api/claude-config', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const payload = (await res.json().catch(() => ({}))) as PatchResult
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Save failed (HTTP ${res.status})`)
  }
  return payload
}

export function useProviderMutations() {
  const queryClient = useQueryClient()

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['providers'] }),
      // Surfaces that read the same config outside this screen.
      queryClient.invalidateQueries({ queryKey: ['claude', 'active-config'] }),
      queryClient.invalidateQueries({ queryKey: ['claude', 'config'] }),
      queryClient.invalidateQueries({ queryKey: ['env'] }),
    ])
  }

  const saveProvider = useMutation({
    mutationFn: async (
      draft: ProviderDraft & { shape?: 'providers-map' | 'inline-model' },
    ) =>
      patchConfig(
        draft.shape === 'inline-model'
          ? buildInlineProviderPatch(draft)
          : buildProviderPatch(draft),
      ),
    onSuccess: invalidate,
  })

  const setActive = useMutation({
    mutationFn: async (input: { providerId: string; model?: string }) =>
      patchConfig(buildSetActivePatch(input.providerId, input.model)),
    onSuccess: invalidate,
  })

  const deleteProvider = useMutation({
    mutationFn: async (input: {
      providerId: string
      removeKey?: boolean
    }): Promise<DeleteResult> => {
      const res = await fetch('/api/claude-config', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: input.providerId,
          removeKey: input.removeKey === true,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as DeleteResult
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error ?? `Delete failed (HTTP ${res.status})`)
      }
      return payload
    },
    onSuccess: invalidate,
  })

  /**
   * The gateway only reads config at startup, so every write above needs a
   * restart to take effect. This is the one that actually performs it —
   * `useConnectionRestart` is a stub that just calls its argument.
   */
  const restartGateway = useMutation({
    mutationFn: async () => gatewayRestart(),
    onSuccess: invalidate,
  })

  return { saveProvider, setActive, deleteProvider, restartGateway }
}
