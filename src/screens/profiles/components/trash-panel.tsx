/**
 * TrashPanel — "Recently Deleted" (G-03).
 *
 * `deleteProfile()` never deleted anything: it renames the profile directory to
 * `~/.hermes/trash/<name>-<epochMs>`. Until now nothing in the UI said so and
 * nothing could reach those directories, so a deleted profile was recoverable
 * in principle and unrecoverable in practice. This panel is the other half of
 * that: list, restore, purge.
 *
 * Restore is deliberately NOT optimistic — the server is the only thing that
 * knows whether the name is free, and a rolled-back optimistic row would be
 * more confusing than a short spinner. `['profiles']` is invalidated after.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from './confirm-dialog'
import type { TrashedProfile } from '@/server/profiles-trash'
import { formatBytes, formatRelative } from '@/lib/format'
import { toast } from '@/components/ui/toast'

type Props = {
  open: boolean
  onClose: () => void
}

export const TRASH_QUERY_KEY = ['profiles', 'trash'] as const

type TrashListResponse = { trashed: Array<TrashedProfile> }

async function fetchTrash(): Promise<TrashListResponse> {
  const res = await fetch('/api/profiles/trash-list')
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  const body = (await res.json()) as Partial<TrashListResponse>
  return { trashed: Array.isArray(body.trashed) ? body.trashed : [] }
}

type PostResult = { ok: true; name?: string }

async function postTrash(
  url: string,
  id: string,
): Promise<PostResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    name?: string
  }
  if (!res.ok || payload.error) {
    const error = new Error(payload.error ?? `Request failed (${res.status})`)
    // Callers need the status to tell "name is taken" (409) apart from a
    // genuine failure. Attaching it beats re-parsing the message.
    ;(error as Error & { status?: number }).status = res.status
    throw error
  }
  return { ok: true, name: payload.name }
}

/**
 * A 409 from restore has exactly one cause: a live profile already holds the
 * name. Saying "failed to restore" would hide the one thing the user can act
 * on, so name it and say what to do.
 */
export function restoreErrorMessage(
  error: unknown,
  originalName: string,
): string {
  const status = (error as { status?: number } | null)?.status
  if (status === 409) {
    return `An agent named "${originalName}" already exists. Rename or delete it first, then restore this copy.`
  }
  return error instanceof Error ? error.message : 'Failed to restore agent'
}

function deletedAtLabel(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return 'unknown'
  return formatRelative(ms / 1000)
}

export function TrashPanel({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<TrashedProfile | null>(null)

  const trashQuery = useQuery({
    queryKey: TRASH_QUERY_KEY,
    queryFn: fetchTrash,
    enabled: open,
    staleTime: 10_000,
  })

  async function handleRestore(entry: TrashedProfile) {
    setBusyId(entry.id)
    try {
      const result = await postTrash('/api/profiles/trash-restore', entry.id)
      toast(`Restored ${result.name ?? entry.originalName}`, { type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
    } catch (error) {
      toast(restoreErrorMessage(error, entry.originalName), { type: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  async function handlePurge(entry: TrashedProfile) {
    setBusyId(entry.id)
    try {
      await postTrash('/api/profiles/trash-purge', entry.id)
      toast(`Permanently deleted ${entry.originalName}`, { type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to delete permanently', {
        type: 'error',
      })
    } finally {
      setBusyId(null)
    }
  }

  if (!open) return null

  const entries = trashQuery.data?.trashed ?? []

  return (
    <>
      <div className="pf-drawer-backdrop" onClick={onClose} aria-hidden="true" />

      <div role="dialog" aria-label="Recently deleted agents" className="pf-drawer is-open">
        <div className="pf-drawer-header">
          <div className="pf-drawer-glyph">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 18, height: 18 }}>
              <path d="M3 4h10M6 4V2.5h4V4M5 4v9h6V4" />
            </svg>
          </div>
          <div className="pf-drawer-name">Recently Deleted</div>
          <button type="button" className="pf-drawer-close" onClick={onClose} aria-label="Close recently deleted">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="pf-drawer-body">
          <div className="pf-drawer-readonly-notice">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 5v3.5M8 11h.01" />
            </svg>
            Deleting an agent moves its folder to ~/.hermes/trash. Nothing here is
            removed from disk until you delete it permanently.
          </div>

          {trashQuery.isLoading ? (
            <div className="pf-trash-empty">Loading…</div>
          ) : trashQuery.isError ? (
            <div className="pf-trash-empty">
              Failed to load recently deleted agents.{' '}
              <button
                type="button"
                className="pf-drawer-action-btn"
                onClick={() => void trashQuery.refetch()}
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="pf-trash-empty">Nothing has been deleted.</div>
          ) : (
            <div className="pf-trash-list">
              {entries.map((entry) => (
                <div key={entry.id} className="pf-trash-row">
                  <div className="pf-trash-name">{entry.originalName}</div>
                  <div className="pf-trash-meta">
                    deleted {deletedAtLabel(entry.deletedAt)}
                    {entry.sizeBytes !== undefined && ` · ${formatBytes(entry.sizeBytes)}`}
                  </div>
                  <div className="pf-trash-actions">
                    <button
                      type="button"
                      className="pf-drawer-action-btn primary"
                      disabled={busyId !== null}
                      onClick={() => void handleRestore(entry)}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="pf-drawer-action-btn danger"
                      disabled={busyId !== null}
                      onClick={() => setPurgeTarget(entry)}
                    >
                      Delete permanently
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={purgeTarget !== null}
        title="Delete permanently?"
        message={
          `This erases "${purgeTarget?.originalName ?? ''}" and everything inside it — ` +
          'config, skills, sessions and memory files — from disk. Unlike deleting an ' +
          'agent, this cannot be undone and there is nothing left to restore.'
        }
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => {
          const target = purgeTarget!
          setPurgeTarget(null)
          void handlePurge(target)
        }}
        onCancel={() => setPurgeTarget(null)}
      />
    </>
  )
}
