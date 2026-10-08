'use client'

/**
 * sidebar-bulk-actions-v2.tsx — sticky action bar shown while the sidebar is
 * in select mode (replaces the UPDATES / MARK READ row): N selected + Cancel,
 * then Move to ▸, Archive, Delete (confirmed).
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  FolderPickerList,
  useDismiss,
  useFolderFormStore,
} from './sidebar-folders-v2'
import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'
import { isChatSource } from '@/screens/chat/sessions-feed-types'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import { useBulkMoveSessions, useSessionProjectMap } from '@/lib/projects-api'
import { useBulkDeleteSessions } from '@/screens/chat/hooks/use-delete-session'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'
import { useSessionsSelectionStore } from '@/stores/sessions-selection-store'
import { useUpdateSessionFlags } from '@/screens/chat/sessions-feed'

const rawIdOf = (id: string) => id.split(':').slice(1).join(':')
const plural = (n: number) => (n === 1 ? '' : 's')
const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

/** Session key of the open chat route, URL-decoded (null off /chat/). */
function activeChatKey(pathname: string): string | null {
  if (!pathname.startsWith('/chat/')) return null
  const seg = pathname.slice('/chat/'.length).split('/')[0]
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

export function SidebarBulkActionsV2({
  items,
}: {
  /** Every feed item (so selections survive collapsed/filtered groups). */
  items: Array<SessionFeedItem>
}) {
  const selected = useSessionsSelectionStore((s) => s.selected)
  const exit = useSessionsSelectionStore((s) => s.exit)
  const setDialogOpen = useSessionsSelectionStore((s) => s.setDialogOpen)
  const profile = useResolvedProfile() ?? undefined
  const { data: map } = useSessionProjectMap(profile)
  const setMany = useSessionsSelectionStore((s) => s.setMany)
  const { updateSessionFlagsAsync } = useUpdateSessionFlags()
  const move = useBulkMoveSessions(profile)
  const { deleteSessions, progress } = useBulkDeleteSessions()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const deletingRef = useRef(false)
  const moveRef = useRef<HTMLDivElement>(null)
  useDismiss(moveRef, moveOpen, () => setMoveOpen(false))

  // The list's Esc-exits-select listener stands down while the dialog is up.
  useEffect(() => {
    setDialogOpen(confirmOpen)
    return () => setDialogOpen(false)
  }, [confirmOpen, setDialogOpen])

  // Selections the current feed no longer contains (filtered out) are
  // ignored; ones inside collapsed groups still count.
  const picked = items.filter((i) => selected[i.id])
  const selectedIds = picked.map((i) => i.id)
  const count = picked.length
  // Move/delete only make sense for chat-backed sessions.
  const chatKeys = picked
    .filter((i) => isChatSource(i.src))
    .map((i) => rawIdOf(i.id))
  const nChat = chatKeys.length
  const partial = nChat > 0 && nChat < count

  async function runMove(projectSlug: string | null) {
    setMoveOpen(false)
    try {
      const { failed, inherited } = await move.mutateAsync({
        sessionKeys: chatKeys,
        projectSlug,
      })
      const ok = nChat - failed.length - inherited.length
      const skipped = inherited.length
        ? `; ${inherited.length} inherited — pick a folder to override`
        : ''
      toast(
        failed.length
          ? `Moved ${ok} of ${nChat}; ${failed.length} failed${skipped}`
          : `${projectSlug ? 'Moved' : 'Removed'} ${ok} session${plural(ok)}${skipped}`,
        { type: failed.length || skipped ? 'warning' : 'success' },
      )
      if (!failed.length) exit()
    } catch (err) {
      toast(`Move failed: ${errMsg(err)}`, { type: 'error' })
    }
  }

  const [archiving, setArchiving] = useState(false)

  async function runArchive() {
    setArchiving(true)
    // Backend-backed chats go through the shared flag mutation (profile,
    // optimistic flip, rollback, overlay clear); local portable sessions and
    // non-chat items have no backend row and keep the local overlay.
    const backend = picked.filter(
      (i) => isChatSource(i.src) && i.sourceMeta.serverSource !== 'local',
    )
    const localIds = picked.filter((i) => !backend.includes(i)).map((i) => i.id)

    try {
      if (localIds.length > 0) {
        useSessionsLocalStore.setState((s) => ({
          archived: [...new Set([...s.archived, ...localIds])],
        }))
      }
      const results = await Promise.allSettled(
        backend.map((i) =>
          updateSessionFlagsAsync({
            sessionKey: rawIdOf(i.id),
            archived: true,
            silent: true,
          }),
        ),
      )
      const failedIds = backend
        .filter((_, n) => results[n].status === 'rejected')
        .map((i) => i.id)
      if (failedIds.length > 0) {
        const done = count - failedIds.length
        // Keep only the failures selected so a retry is one click.
        setMany(
          selectedIds.filter((id) => !failedIds.includes(id)),
          false,
        )
        toast(`Archived ${done} of ${count}; ${failedIds.length} failed`, {
          type: 'error',
        })
        return
      }
      toast(`Archived ${count} session${plural(count)}`, { type: 'success' })
      exit()
    } finally {
      setArchiving(false)
    }
  }

  async function runDelete() {
    if (deletingRef.current) return
    deletingRef.current = true
    const activeKey = activeChatKey(pathname)
    try {
      const failed = await deleteSessions(chatKeys, activeKey)
      if (
        activeKey &&
        chatKeys.includes(activeKey) &&
        !failed.includes(activeKey)
      )
        void navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: 'new' },
        })
      const ok = nChat - failed.length
      toast(
        failed.length
          ? `Deleted ${ok} of ${nChat}; ${failed.length} failed`
          : `Deleted ${ok} session${plural(ok)}`,
        { type: failed.length ? 'warning' : 'success' },
      )
      setConfirmOpen(false)
      exit()
    } catch (err) {
      toast(`Delete failed: ${errMsg(err)}`, { type: 'error' })
      setConfirmOpen(false)
    } finally {
      deletingRef.current = false
    }
  }

  const canChat = nChat > 0
  return (
    <div
      className="flex flex-col gap-1.5 shrink-0 px-3 py-2"
      data-testid="sidebar-bulk-actions"
      style={{
        borderTop: '1px solid var(--theme-accent-border, var(--theme-accent))',
        background: 'var(--theme-accent-subtle)',
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="m-chip flex-1 min-w-0 truncate"
          style={{ color: 'var(--theme-accent)' }}
          aria-live="polite"
        >
          {count} SELECTED
        </span>
        <BarButton full={false} onClick={exit}>
          CANCEL
        </BarButton>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <div
          ref={moveRef}
          className="flex-1 min-w-0"
          style={{ position: 'relative' }}
        >
          <BarButton
            disabled={!canChat || move.isPending}
            onClick={() => setMoveOpen((v) => !v)}
            title={
              partial
                ? `Move ${nChat} of ${count} selected (only chats move)`
                : undefined
            }
          >
            {partial ? `MOVE ${nChat} ▸` : 'MOVE TO ▸'}
          </BarButton>
          {moveOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 6,
                minWidth: 200,
                zIndex: 20,
                background: 'var(--theme-card)',
                border: '1px solid var(--theme-border)',
                borderRadius: 6,
                boxShadow: 'var(--theme-shadow-2)',
              }}
            >
              <FolderPickerList
                projects={map?.projects ?? []}
                onPick={(p) => void runMove(p.slug)}
                onRemove={() => void runMove(null)}
                onNewFolder={() => {
                  setMoveOpen(false)
                  useFolderFormStore.getState().show(chatKeys)
                }}
              />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <BarButton
            disabled={count === 0 || archiving}
            onClick={() => void runArchive()}
          >
            ARCHIVE
          </BarButton>
        </div>
        <div className="flex-1 min-w-0">
          <BarButton
            disabled={!canChat}
            danger
            onClick={() => setConfirmOpen(true)}
            title={
              partial
                ? `Delete ${nChat} of ${count} selected (only chats delete)`
                : undefined
            }
          >
            {partial ? `DELETE ${nChat}` : 'DELETE'}
          </BarButton>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        destructive
        busy={progress !== null}
        title={
          partial
            ? `Delete ${nChat} of ${count} selected?`
            : `Delete ${nChat} session${plural(nChat)}?`
        }
        message={
          <>
            This permanently deletes {nChat} session{plural(nChat)} and their
            messages.
            {partial && (
              <>
                {' '}
                {count - nChat} selected item{plural(count - nChat)}{' '}
                {count - nChat === 1 ? "isn't a chat" : "aren't chats"} and
                {count - nChat === 1 ? ' is' : ' are'} skipped.
              </>
            )}
            {progress && (
              <span className="block mt-1">
                Deleting {progress.done}/{progress.total}…
              </span>
            )}
          </>
        }
        confirmLabel={progress ? 'Deleting…' : `Delete ${nChat}`}
        onConfirm={() => void runDelete()}
        onCancel={() => {
          // Esc / Cancel close only the dialog — and not mid-delete.
          if (!progress && !deletingRef.current) setConfirmOpen(false)
        }}
      />
    </div>
  )
}

function BarButton({
  children,
  onClick,
  disabled,
  danger,
  title,
  full = true,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
  /** Fill the wrapper (action row); false = shrink-wrap (Cancel). */
  full?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`m-chip ${full ? 'w-full' : 'shrink-0'} rounded px-1.5 py-1 whitespace-nowrap overflow-hidden text-ellipsis`}
      style={{
        background: 'var(--theme-card)',
        border: `1px solid ${danger ? 'var(--theme-danger)' : 'var(--theme-border)'}`,
        color: danger ? 'var(--theme-danger)' : 'var(--theme-text)',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}
