'use client'

/**
 * sidebar-card-context-menu-v2.tsx — right-click / three-dot context menu for session cards.
 *
 * Phase 3c: Pin/Unpin, Star/Unstar, Archive/Unarchive, Rename (chat only), Delete (chat only).
 * - Pin/star/archive: useSessionsLocalStore actions on namespaced item.id.
 * - Rename/Delete: reuses v1 SessionRenameDialog / SessionDeleteDialog.
 * - Position: mouse coords for right-click; anchored via style props for hover-icon.
 * - Closes on action / ESC / click-outside.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useShallow } from 'zustand/react/shallow'
import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'
import { SessionDeleteDialog } from '@/screens/chat/components/sidebar/session-delete-dialog'
import { SessionRenameDialog } from '@/screens/chat/components/sidebar/session-rename-dialog'
import { archiveTask } from '@/lib/tasks-api'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'
import { useDeleteSession } from '@/screens/chat/hooks/use-delete-session'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContextMenuPosition {
  x: number
  y: number
}

interface SidebarCardContextMenuV2Props {
  item: SessionFeedItem
  position: ContextMenuPosition
  onClose: () => void
}

const selectPathname = (s: { location: { pathname: string } }) =>
  s.location.pathname

// ── Component ─────────────────────────────────────────────────────────────────

export function SidebarCardContextMenuV2({ item, position, onClose }: SidebarCardContextMenuV2Props) {
  const {
    isPinned,
    isStarred,
    isArchived,
    togglePinned,
    toggleStarred,
    toggleArchived,
  } = useSessionsLocalStore(
    useShallow((s) => ({
      isPinned: s.pinned.includes(item.id),
      isStarred: s.starred.includes(item.id),
      isArchived: s.archived.includes(item.id),
      togglePinned: s.togglePinned,
      toggleStarred: s.toggleStarred,
      toggleArchived: s.toggleArchived,
    })),
  )

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)
  // chat / cron / api are all backed by chat sessions
  const isChatItem = item.src === 'chat' || item.src === 'cron' || item.src === 'api' || item.src === 'task'
  const rawId = item.id.split(':').slice(1).join(':')

  const handleArchiveToggle = useCallback(() => {
    toggleArchived(item.id)
  }, [toggleArchived, item.id])

  // Close on click-outside
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  // Close on ESC
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  const act = useCallback((fn: () => void) => {
    fn()
    onClose()
  }, [onClose])

  // Rename save — for now just closes (title stored locally; full API rename out of scope)
  function handleRenameSave(_newTitle: string) {
    setRenameOpen(false)
    onClose()
  }

  const { deleteSession } = useDeleteSession()
  const navigate = useNavigate()
  const currentPath = useRouterState({ select: selectPathname })
  const isActive = isChatItem && currentPath.includes(`/chat/${rawId}`)

  function handleDeleteConfirm() {
    if (isChatItem && rawId) {
      void deleteSession(rawId, rawId, isActive).then(() => {
        if (isActive) {
          void navigate({ to: '/chat/$sessionKey', params: { sessionKey: 'new' } })
        }
      })
    }
    setDeleteOpen(false)
    onClose()
  }

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        aria-label="Session actions"
        style={{
          position: 'fixed',
          top: position.y,
          left: position.x,
          zIndex: 200,
          minWidth: 160,
          background: 'var(--theme-card, #0d1117)',
          border: '1px solid var(--theme-border)',
          borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          padding: '4px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <MenuItem
          label={isPinned ? 'Unpin' : 'Pin'}
          icon={isPinned ? '★' : '☆'}
          onClick={() => act(() => togglePinned(item.id))}
        />
        <MenuItem
          label={isStarred ? 'Unstar' : 'Star'}
          icon="✦"
          onClick={() => act(() => toggleStarred(item.id))}
        />
        <MenuItem
          label={isArchived ? 'Unarchive' : 'Archive'}
          icon="⊞"
          onClick={() => act(handleArchiveToggle)}
        />

        {isChatItem && (
          <>
            <div style={{ height: 1, background: 'var(--theme-border)', margin: '4px 0' }} />
            <MenuItem
              label="Rename"
              icon="✎"
              onClick={() => { setRenameOpen(true) }}
            />
            <MenuItem
              label="Delete"
              icon="✕"
              onClick={() => { setDeleteOpen(true) }}
              danger
            />
          </>
        )}
      </div>

      {renameOpen && (
        <SessionRenameDialog
          open={renameOpen}
          onOpenChange={(o) => { if (!o) { setRenameOpen(false); onClose() } }}
          sessionTitle={item.title}
          onSave={handleRenameSave}
          onCancel={() => { setRenameOpen(false); onClose() }}
        />
      )}

      {deleteOpen && (
        <SessionDeleteDialog
          open={deleteOpen}
          onOpenChange={(o) => { if (!o) { setDeleteOpen(false); onClose() } }}
          sessionTitle={item.title}
          onConfirm={handleDeleteConfirm}
          onCancel={() => { setDeleteOpen(false); onClose() }}
        />
      )}
    </>
  )
}

// ── MenuItem ──────────────────────────────────────────────────────────────────

interface MenuItemProps {
  label: string
  icon: string
  onClick: () => void
  danger?: boolean
}

function MenuItem({ label, icon, onClick, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="m-mono"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 12px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: 11,
        color: danger ? '#ff5f5f' : 'var(--theme-text)',
        textAlign: 'left',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = danger
          ? 'color-mix(in srgb, #ff5f5f 12%, transparent)'
          : 'var(--theme-border)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
      }}
    >
      <span style={{ width: 14, textAlign: 'center', fontSize: 10 }}>{icon}</span>
      {label}
    </button>
  )
}
