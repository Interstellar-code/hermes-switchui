/**
 * use-env-var-row.ts — reveal / edit / delete behaviour for one `.env` credential.
 *
 * Extracted from section-api-keys.tsx, which had the only correct
 * implementation of the auto-hiding reveal. section-memory-wiki.tsx had
 * reimplemented the same timer logic verbatim, and the providers drawer needed
 * it a third time — so the behaviour lives here while each surface keeps its
 * own markup (settings table rows and drawer cards are not interchangeable).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { EnvWriteResult } from '@/lib/hermes-client'
import { deleteEnv, putEnv, revealEnv } from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'

/** A revealed secret hides itself again after this long. */
export const REVEAL_TIMEOUT_MS = 30_000

/**
 * `PUT`/`DELETE /api/env` reconcile the `.env` file, any `config.yaml`
 * mirrors, and the `auth.json` credential pool in one shot (see
 * `EnvWriteResult`'s doc comment in `@/lib/hermes-client`). A user who
 * rotates a key and has a config.yaml mirror silently rewritten — or one
 * that could NOT be reconciled, leaving a stale copy in effect — needs to be
 * told; the write succeeding is not the whole story. Returns a toast-ready
 * summary, or null when the response reports nothing beyond the plain
 * success already toasted by the caller.
 */
export function describeReconciliation(
  result: EnvWriteResult,
): { message: string; severity: 'warning' | 'info' } | null {
  const notes: Array<string> = []

  const updates = result.config_updates ?? []
  if (updates.length > 0) {
    notes.push(
      `updated ${updates.length === 1 ? 'a config.yaml mirror' : `${updates.length} config.yaml mirrors`} (${updates.join(', ')})`,
    )
  }

  const scrubbed = result.config_scrubbed ?? []
  if (scrubbed.length > 0) {
    notes.push(
      `removed ${scrubbed.length === 1 ? 'a stale config.yaml reference' : `${scrubbed.length} stale config.yaml references`} (${scrubbed.join(', ')})`,
    )
  }

  const pruned = result.pool_pruned ?? []
  if (pruned.length > 0) {
    notes.push(
      `pruned ${pruned.length === 1 ? 'a stale credential-pool entry' : `${pruned.length} stale credential-pool entries`} (${pruned.join(', ')})`,
    )
  }

  const warnings = Array.isArray(result.warnings)
    ? result.warnings
    : result.warnings
      ? [result.warnings]
      : []
  const unreconciled = result.credentialsReconciled === false

  if (notes.length === 0 && warnings.length === 0 && !unreconciled) {
    return null
  }

  const parts = [...notes, ...warnings]
  if (unreconciled && warnings.length === 0) {
    parts.push(
      'could not fully reconcile — a stale copy may still be in effect elsewhere',
    )
  }

  return {
    message: parts.join('; '),
    severity: unreconciled || warnings.length > 0 ? 'warning' : 'info',
  }
}

export function humanizeEnvKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export type UseEnvVarRow = {
  revealedValue: string | null
  isRevealed: boolean
  editing: boolean
  editValue: string
  busy: boolean
  setEditValue: (value: string) => void
  toggleReveal: () => Promise<void>
  startEdit: () => void
  cancelEdit: () => void
  saveEdit: () => Promise<boolean>
  remove: () => Promise<boolean>
}

export function useEnvVarRow(envKey: string): UseEnvVarRow {
  const queryClient = useQueryClient()
  const [revealedValue, setRevealedValue] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [busy, setBusy] = useState(false)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRevealTimer = useCallback(() => {
    if (revealTimer.current) clearTimeout(revealTimer.current)
    revealTimer.current = null
  }, [])

  // A secret must never outlive the component that revealed it.
  useEffect(() => clearRevealTimer, [clearRevealTimer])

  const toggleReveal = useCallback(async () => {
    if (revealedValue !== null) {
      setRevealedValue(null)
      clearRevealTimer()
      return
    }
    try {
      const result = await revealEnv(envKey)
      setRevealedValue(result.value)
      clearRevealTimer()
      revealTimer.current = setTimeout(() => {
        setRevealedValue(null)
        revealTimer.current = null
      }, REVEAL_TIMEOUT_MS)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to reveal', {
        type: 'error',
      })
    }
  }, [clearRevealTimer, envKey, revealedValue])

  const startEdit = useCallback(() => {
    setEditValue('')
    setEditing(true)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setEditValue('')
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editValue.trim()) {
      toast('Value cannot be empty', { type: 'error' })
      return false
    }
    setBusy(true)
    try {
      const result = await putEnv(envKey, editValue.trim())
      await queryClient.invalidateQueries({ queryKey: ['env'] })
      await queryClient.invalidateQueries({ queryKey: ['providers'] })
      setEditing(false)
      setEditValue('')
      toast(`${humanizeEnvKey(envKey)} updated`, { type: 'success' })
      const reconciliation = describeReconciliation(result)
      if (reconciliation) {
        toast(reconciliation.message, { type: reconciliation.severity })
      }
      return true
    } catch {
      toast('Failed to update key', { type: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }, [editValue, envKey, queryClient])

  const remove = useCallback(async () => {
    setBusy(true)
    try {
      const result = await deleteEnv(envKey)
      await queryClient.invalidateQueries({ queryKey: ['env'] })
      await queryClient.invalidateQueries({ queryKey: ['providers'] })
      toast(`${humanizeEnvKey(envKey)} deleted`, { type: 'success' })
      const reconciliation = describeReconciliation(result)
      if (reconciliation) {
        toast(reconciliation.message, { type: reconciliation.severity })
      }
      return true
    } catch {
      toast('Failed to delete key', { type: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }, [envKey, queryClient])

  return {
    revealedValue,
    isRevealed: revealedValue !== null,
    editing,
    editValue,
    busy,
    setEditValue,
    toggleReveal,
    startEdit,
    cancelEdit,
    saveEdit,
    remove,
  }
}
