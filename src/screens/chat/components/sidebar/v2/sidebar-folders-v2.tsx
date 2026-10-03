'use client'

/**
 * sidebar-folders-v2.tsx — project-folder chrome for the sessions sidebar:
 * GROUP DATE|PROJECT toggle row (+ SELECT, + FOLDER), the inline new-folder
 * form, the no-folders empty state, and the shared "Move to" picker list used
 * by the card context menu and the bulk action bar.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import type { SessionProjectMap } from '@/lib/projects-types'
import {
  useArchiveProject,
  useBulkMoveSessions,
  useCreateProject,
  useDeleteProject,
  useProjects,
  useRestoreProject,
  useSessionProjectMap,
  useUpdateProject,
} from '@/lib/projects-api'
import { clampContextMenuPosition } from '@/lib/context-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import { useSessionsSelectionStore } from '@/stores/sessions-selection-store'

type MapProject = SessionProjectMap['projects'][number]

/** Folder colours are data (stored on the project), not theme tokens. */
export const FOLDER_SWATCHES = [
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ec4899',
  '#a855f7',
]

/** project.color, else a deterministic swatch from the id. */
export function folderColor(id: string, color?: string | null): string {
  if (color) return color
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return FOLDER_SWATCHES[h % FOLDER_SWATCHES.length]
}

/**
 * Open state of the inline new-folder form. `moveKeys` = sessions to move
 * into the folder once it is created (from "+ New folder…" in a Move menu).
 */
export const useFolderFormStore = create<{
  open: boolean
  moveKeys: Array<string>
  show: (moveKeys?: Array<string>) => void
  hide: () => void
}>((set) => ({
  open: false,
  moveKeys: [],
  show: (moveKeys = []) => {
    useSessionsFilterStore.getState().setGroupBy('project')
    set({ open: true, moveKeys })
  },
  hide: () => set({ open: false, moveKeys: [] }),
}))

// ── Toggle row ────────────────────────────────────────────────────────────────

export function SidebarGroupToggleV2({
  profile,
  map,
}: {
  profile?: string
  map?: SessionProjectMap | null
}) {
  const groupBy = useSessionsFilterStore((s) => s.groupBy)
  const setGroupBy = useSessionsFilterStore((s) => s.setGroupBy)
  const selecting = useSessionsSelectionStore((s) => s.active)
  const enterSelect = useSessionsSelectionStore((s) => s.enter)
  const exitSelect = useSessionsSelectionStore((s) => s.exit)
  const formOpen = useFolderFormStore((s) => s.open)
  const showForm = useFolderFormStore((s) => s.show)

  const noFolders =
    groupBy === 'project' && map != null && map.projects.length === 0

  return (
    <div
      className="shrink-0"
      style={{
        borderBottom:
          '1px solid var(--theme-border-subtle, var(--theme-border))',
      }}
    >
      <div
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-1.5"
        data-testid="sidebar-group-toggle"
      >
        <div
          role="radiogroup"
          aria-label="Group sessions by"
          title="Group sessions by"
          className="flex shrink-0 rounded-full overflow-hidden"
          style={{ border: '1px solid var(--theme-border)' }}
        >
          {(['date', 'project'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={groupBy === mode}
              onClick={() => setGroupBy(mode)}
              className="m-chip px-2 py-0.5 whitespace-nowrap"
              style={{
                background:
                  groupBy === mode
                    ? 'var(--theme-accent-subtle)'
                    : 'transparent',
                color:
                  groupBy === mode
                    ? 'var(--theme-accent)'
                    : 'var(--theme-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={selecting ? exitSelect : enterSelect}
          aria-pressed={selecting}
          className="m-chip shrink-0 whitespace-nowrap rounded-full px-2 py-0.5"
          style={{
            border: `1px solid ${selecting ? 'var(--theme-accent-border, var(--theme-accent))' : 'var(--theme-border)'}`,
            background: selecting
              ? 'var(--theme-accent-subtle)'
              : 'transparent',
            color: selecting ? 'var(--theme-accent)' : 'var(--theme-muted)',
            cursor: 'pointer',
          }}
        >
          SELECT
        </button>
        <button
          type="button"
          onClick={() => showForm()}
          aria-label="New folder"
          className="m-chip shrink-0 whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{
            border: '1px dashed var(--theme-border)',
            background: 'transparent',
            color: 'var(--theme-muted)',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden>+</span>FOLDER
        </button>
      </div>
      {formOpen && <NewFolderForm profile={profile} />}
      {noFolders && !formOpen && <NoFoldersEmpty onCreate={() => showForm()} />}
    </div>
  )
}

// ── New folder form ───────────────────────────────────────────────────────────

function NewFolderForm({ profile }: { profile?: string }) {
  const moveKeys = useFolderFormStore((s) => s.moveKeys)
  const hide = useFolderFormStore((s) => s.hide)
  const createProject = useCreateProject(profile)
  const move = useBulkMoveSessions(profile)
  const [name, setName] = useState('')
  const [color, setColor] = useState(FOLDER_SWATCHES[0])
  const busy = createProject.isPending
  const canCreate = name.trim().length > 0 && !busy

  async function submit() {
    if (!canCreate) return
    let res: unknown
    try {
      res = await createProject.mutateAsync({ name: name.trim(), color })
    } catch {
      return // surfaced via createProject.error
    }
    hide()
    if (
      !moveKeys.length ||
      !res ||
      typeof res !== 'object' ||
      !('project' in res)
    )
      return
    const slug = (res as { project: { slug: string } }).project.slug
    try {
      const failed = await move.mutateAsync({
        sessionKeys: moveKeys,
        projectSlug: slug,
      })
      const ok = moveKeys.length - failed.length
      toast(
        failed.length
          ? `Moved ${ok} of ${moveKeys.length}; ${failed.length} failed`
          : `Moved ${ok} session${ok === 1 ? '' : 's'}`,
        { type: failed.length ? 'warning' : 'success' },
      )
      if (!failed.length) useSessionsSelectionStore.getState().exit()
    } catch (err) {
      toast(
        `Folder created, but moving failed: ${err instanceof Error ? err.message : String(err)}`,
        { type: 'error' },
      )
    }
  }

  return (
    <div
      className="flex flex-col gap-1.5 px-3 pb-2"
      data-testid="new-folder-form"
    >
      <input
        autoFocus
        aria-label="Folder name"
        placeholder="Folder name"
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            e.stopPropagation()
            hide()
          }
        }}
        className="m-mono"
        style={{
          width: '100%',
          padding: '4px 8px',
          fontSize: 11,
          borderRadius: 4,
          background: 'var(--theme-card)',
          border: '1px solid var(--theme-accent-border, var(--theme-border))',
          color: 'var(--theme-text)',
          outline: 'none',
        }}
      />
      <div className="flex items-center gap-1.5">
        {FOLDER_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: c,
              border: 'none',
              cursor: 'pointer',
              outline: color === c ? '1.5px solid var(--theme-text)' : 'none',
              outlineOffset: 1,
            }}
          />
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canCreate}
          className="m-chip rounded px-2 py-0.5"
          style={{
            background: 'var(--theme-accent-subtle)',
            border: '1px solid var(--theme-accent-border, var(--theme-accent))',
            color: 'var(--theme-accent)',
            opacity: canCreate ? 1 : 0.5,
            cursor: canCreate ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'CREATING…' : 'CREATE'}
        </button>
        <button
          type="button"
          onClick={hide}
          className="m-chip rounded px-2 py-0.5"
          style={{
            background: 'transparent',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-muted)',
            cursor: 'pointer',
          }}
        >
          ESC
        </button>
      </div>
      {createProject.error && (
        <span
          className="m-mono"
          style={{ fontSize: 10, color: 'var(--theme-danger)' }}
        >
          {createProject.error.message}
        </span>
      )}
      <span
        className="m-mono"
        style={{ fontSize: 10, color: 'var(--theme-muted)' }}
      >
        Creates a project with just a name. Link a kanban board later on the
        Projects page.
      </span>
    </div>
  )
}

function NoFoldersEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 px-4 py-4 text-center"
      data-testid="no-folders-empty"
    >
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z"
          stroke="var(--theme-muted)"
          strokeWidth="1.2"
        />
      </svg>
      <span className="m-chip" style={{ color: 'var(--theme-text)' }}>
        NO FOLDERS YET
      </span>
      <span
        className="m-mono"
        style={{ fontSize: 10, color: 'var(--theme-muted)' }}
      >
        Folders are this profile's projects. Create one, then right-click a chat
        → Move to project.
      </span>
      <button
        type="button"
        onClick={onCreate}
        className="m-chip rounded-full px-2.5 py-0.5"
        style={{
          border: '1px dashed var(--theme-accent-border, var(--theme-accent))',
          background: 'transparent',
          color: 'var(--theme-accent)',
          cursor: 'pointer',
        }}
      >
        + NEW FOLDER
      </button>
    </div>
  )
}

// ── Shared "Move to" picker ───────────────────────────────────────────────────

/** Show a name filter above the folder list past this many live folders. */
const PICKER_FILTER_THRESHOLD = 8

/**
 * MOVE TO list: live projects (✓ on `currentId`), Remove, + New folder….
 * Archived projects are never move targets.
 */
export function FolderPickerList({
  projects,
  currentId,
  onPick,
  onRemove,
  onNewFolder,
}: {
  projects: Array<MapProject>
  currentId?: string | null
  onPick: (project: MapProject) => void
  onRemove: () => void
  onNewFolder: () => void
}) {
  const [filter, setFilter] = useState('')
  const live = projects.filter((p) => !p.archived)
  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? live.filter((p) => p.name.toLowerCase().includes(needle))
    : live
  return (
    <div className="flex flex-col" role="menu" aria-label="Move to project">
      <span
        className="m-chip px-3 pt-1.5 pb-1"
        style={{ color: 'var(--theme-muted)' }}
      >
        MOVE TO
      </span>
      {live.length > PICKER_FILTER_THRESHOLD && (
        <input
          autoFocus
          aria-label="Filter folders"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="m-mono mx-2 mb-1"
          style={{
            padding: '3px 6px',
            fontSize: 11,
            borderRadius: 4,
            background: 'var(--theme-sidebar)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
            outline: 'none',
          }}
        />
      )}
      {shown.length === 0 && (
        <span
          className="m-mono px-3 py-1"
          style={{ fontSize: 10, color: 'var(--theme-muted)' }}
        >
          {live.length === 0 ? 'No folders yet' : 'No match'}
        </span>
      )}
      <div
        data-testid="folder-picker-scroll"
        style={{
          maxHeight: 'min(280px, 50vh)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--theme-border) transparent',
        }}
      >
        {shown.map((p) => (
          <PickerItem key={p.id} onClick={() => onPick(p)}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: folderColor(p.id, p.color),
                flexShrink: 0,
              }}
            />
            <span className="truncate flex-1">{p.name}</span>
            {p.id === currentId && (
              <span style={{ color: 'var(--theme-accent)' }}>✓</span>
            )}
          </PickerItem>
        ))}
      </div>
      <div
        style={{
          height: 1,
          background: 'var(--theme-border)',
          margin: '4px 0',
        }}
      />
      <PickerItem onClick={onRemove} disabled={currentId === null}>
        Remove from project
      </PickerItem>
      <PickerItem onClick={onNewFolder}>+ New folder…</PickerItem>
      <span
        className="m-mono px-3 pt-1 pb-1.5"
        style={{ fontSize: 9, color: 'var(--theme-muted)' }}
      >
        Archived projects hidden
      </span>
    </div>
  )
}

function PickerItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="m-mono flex items-center gap-2 w-full text-left"
      style={{
        padding: '6px 12px',
        fontSize: 11,
        background: 'transparent',
        border: 'none',
        color: danger ? 'var(--theme-danger)' : 'var(--theme-text)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--theme-border)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

/** Close a popover on outside mousedown / Esc. */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [ref, open, onClose])
}

// ── Folder header menu (project sections only) ────────────────────────────────

/** Inline rename for a folder header. Enter saves, Esc / blur cancels. */
export function FolderRenameInput({
  projectId,
  name,
  onDone,
}: {
  projectId: string
  name: string
  onDone: () => void
}) {
  const profile = useResolvedProfile() ?? undefined
  const update = useUpdateProject(profile)
  const [value, setValue] = useState(name)
  return (
    <input
      autoFocus
      aria-label="Folder name"
      value={value}
      disabled={update.isPending}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onDone()
        if (e.key !== 'Enter') return
        const next = value.trim()
        if (!next || next === name) return onDone()
        update.mutate(
          { idOrSlug: projectId, input: { name: next } },
          { onSettled: onDone },
        )
      }}
      className="m-label flex-1 min-w-0"
      style={{
        padding: '1px 4px',
        borderRadius: 3,
        background: 'var(--theme-card)',
        border: '1px solid var(--theme-accent-border, var(--theme-accent))',
        color: 'var(--theme-text)',
        outline: 'none',
      }}
    />
  )
}

const MENU_W = 180

/**
 * ⋯ / right-click menu on a folder header: Rename…, Colour ▸, Archive /
 * Restore, Delete folder…. Deleting a project only drops its bindings
 * (project_sessions cascades) — sessions fall back to Unfiled.
 */
export function FolderHeaderMenu({
  projectId,
  name,
  archived,
  position,
  onClose,
  onRename,
}: {
  projectId: string
  name: string
  archived: boolean
  position: { x: number; y: number }
  onClose: () => void
  onRename: () => void
}) {
  const profile = useResolvedProfile() ?? undefined
  const { data: map } = useSessionProjectMap(profile)
  const update = useUpdateProject(profile)
  const archive = useArchiveProject(profile)
  const restore = useRestoreProject(profile)
  const del = useDeleteProject(profile)
  const [colourOpen, setColourOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Paths/board details only matter for the delete warning — fetch lazily.
  const { data: list } = useProjects(true, confirmOpen, profile)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, !confirmOpen, onClose)

  const mapProject = map?.projects.find((p) => p.id === projectId)
  const full = list?.projects.find((p) => p.id === projectId)
  const sessionCount = map
    ? Object.values(map.sessions).filter((id) => id === projectId).length
    : 0
  const isRealProject = Boolean(
    mapProject?.board_slug ||
    full?.board_slug ||
    (full?.folder_count ?? 0) > 0 ||
    full?.primary_path,
  )
  const pos =
    typeof window === 'undefined'
      ? position
      : clampContextMenuPosition(
          position,
          { width: MENU_W, height: 170 },
          { width: window.innerWidth, height: window.innerHeight },
        )

  const run = (fn: () => void) => {
    fn()
    onClose()
  }

  if (typeof document === 'undefined') return null
  const pending = del.isPending || archive.isPending
  // Backend only deletes archived projects (409 otherwise): archive first.
  async function confirmDelete() {
    if (pending) return
    try {
      if (!archived && !mapProject?.archived)
        await archive.mutateAsync(projectId)
      await del.mutateAsync(projectId)
      onClose()
    } catch (err) {
      toast(
        `Couldn't delete folder: ${err instanceof Error ? err.message : String(err)}`,
        { type: 'error' },
      )
    }
  }

  if (confirmOpen)
    return (
      <ConfirmDialog
        open
        destructive
        busy={pending}
        title={`Delete folder ‘${name}’?`}
        message={
          <>
            Its {sessionCount} session{sessionCount === 1 ? '' : 's'} move to
            Unfiled — no sessions are deleted.
            {isRealProject && (
              <span
                data-testid="folder-delete-warning"
                className="block mt-1"
                style={{ color: 'var(--theme-warning)' }}
              >
                This is also a project with a linked board/paths — deleting
                removes it from the Projects page too.
              </span>
            )}
          </>
        }
        confirmLabel={pending ? 'Deleting…' : 'Delete folder'}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!pending) onClose()
        }}
      />
    )

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Folder ${name}`}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 1200,
        minWidth: MENU_W,
        padding: '4px 0',
        background: 'var(--theme-card)',
        border: '1px solid var(--theme-border)',
        borderRadius: 6,
        boxShadow: 'var(--theme-shadow-2)',
      }}
    >
      <PickerItem onClick={() => run(onRename)}>✎ Rename…</PickerItem>
      <PickerItem onClick={() => setColourOpen((v) => !v)}>
        <span className="flex-1">◐ Colour</span>
        <span style={{ color: 'var(--theme-muted)' }}>
          {colourOpen ? '▾' : '▸'}
        </span>
      </PickerItem>
      {colourOpen && (
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          {FOLDER_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={mapProject?.color === c}
              onClick={() =>
                run(() =>
                  update.mutate({ idOrSlug: projectId, input: { color: c } }),
                )
              }
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: c,
                border: 'none',
                cursor: 'pointer',
                outline:
                  mapProject?.color === c
                    ? '1.5px solid var(--theme-text)'
                    : 'none',
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
      )}
      <PickerItem
        onClick={() =>
          run(() =>
            archived ? restore.mutate(projectId) : archive.mutate(projectId),
          )
        }
      >
        {archived ? '↺ Restore' : '⊞ Archive'}
      </PickerItem>
      <div
        style={{
          height: 1,
          background: 'var(--theme-border)',
          margin: '4px 0',
        }}
      />
      <PickerItem danger onClick={() => setConfirmOpen(true)}>
        ✕ Delete folder…
      </PickerItem>
    </div>,
    document.body,
  )
}
