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
        <InlineRenameDialog
          sessionTitle={item.title}
          onSave={handleRenameSave}
          onCancel={() => { setRenameOpen(false); onClose() }}
        />
      )}

      {deleteOpen && (
        <InlineDeleteDialog
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

// ── Inline dialogs (previously imported from deleted v1 files) ────────────────

function InlineRenameDialog({
  sessionTitle,
  onSave,
  onCancel,
}: {
  sessionTitle: string
  onSave: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(sessionTitle)
  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--theme-text)' }}>Rename session</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(value); if (e.key === 'Escape') onCancel() }}
          style={{ width: '100%', padding: '4px 8px', marginBottom: 12, background: 'var(--theme-sidebar)', border: '1px solid var(--theme-border)', borderRadius: 4, color: 'var(--theme-text)', fontSize: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
          <button type="button" onClick={() => onSave(value)} style={confirmBtnStyle}>Save</button>
        </div>
      </div>
    </div>
  )
}

function InlineDeleteDialog({
  sessionTitle,
  onConfirm,
  onCancel,
}: {
  sessionTitle: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--theme-text)' }}>
          Delete <strong>{sessionTitle}</strong>?
        </p>
        <p style={{ marginBottom: 12, fontSize: 11, color: 'var(--theme-text-muted, #888)' }}>This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
          <button type="button" onClick={onConfirm} style={{ ...confirmBtnStyle, background: '#c0392b' }}>Delete</button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 300,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const dialogStyle: React.CSSProperties = {
  background: 'var(--theme-card, #0d1117)',
  border: '1px solid var(--theme-border)',
  borderRadius: 8, padding: 16, minWidth: 260, maxWidth: 360,
}
const cancelBtnStyle: React.CSSProperties = {
  padding: '4px 12px', fontSize: 12, borderRadius: 4,
  background: 'transparent', border: '1px solid var(--theme-border)',
  color: 'var(--theme-text)', cursor: 'pointer',
}
const confirmBtnStyle: React.CSSProperties = {
  padding: '4px 12px', fontSize: 12, borderRadius: 4,
  background: 'var(--theme-accent, #4CAF50)', border: 'none',
  color: '#fff', cursor: 'pointer',
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
