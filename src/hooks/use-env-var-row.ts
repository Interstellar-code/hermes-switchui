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
import { deleteEnv, putEnv, revealEnv } from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'

/** A revealed secret hides itself again after this long. */
export const REVEAL_TIMEOUT_MS = 30_000

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
      await putEnv(envKey, editValue.trim())
      await queryClient.invalidateQueries({ queryKey: ['env'] })
      await queryClient.invalidateQueries({ queryKey: ['providers'] })
      setEditing(false)
      setEditValue('')
      toast(`${humanizeEnvKey(envKey)} updated`, { type: 'success' })
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
      await deleteEnv(envKey)
      await queryClient.invalidateQueries({ queryKey: ['env'] })
      await queryClient.invalidateQueries({ queryKey: ['providers'] })
      toast(`${humanizeEnvKey(envKey)} deleted`, { type: 'success' })
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
