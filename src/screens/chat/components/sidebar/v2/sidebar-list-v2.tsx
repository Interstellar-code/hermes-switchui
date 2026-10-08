'use client'

/**
 * sidebar-list-v2.tsx — grouped (day or project folder) session list for the v2 sidebar.
 * Select mode: click toggles, shift-click ranges, header checkbox selects a
 * group, bulk action bar replaces the UPDATES row.
 *
 * Phase 3c: groups prop passed from shell (no duplicate useSessionsFeed call).
 * Phase 3b: day group labels with count badges, sticky headers, Pinned section,
 * + NEW CHAT footer button.
 * Phase 6: virtualized grouped list via @tanstack/react-virtual.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDownToLine,
  GitBranch,
  Link2,
  Loader2,
  MessageSquarePlus,
  RotateCw,
} from 'lucide-react'
import { SidebarCardV2 } from './sidebar-card-v2'
import { SidebarBulkActionsV2 } from './sidebar-bulk-actions-v2'
import {
  FolderHeaderMenu,
  FolderRenameInput,
  folderColor,
} from './sidebar-folders-v2'
import type { ReactNode } from 'react'
import type { Range } from '@tanstack/react-virtual'
import type { SessionGroup } from '@/screens/chat/apply-filters-and-decorate'
import { isChatSource } from '@/screens/chat/sessions-feed-types'
import { useSessionsSelectionStore } from '@/stores/sessions-selection-store'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import {
  clearPendingFolder,
  startChatInFolder,
} from '@/screens/chat/pending-folder'

const COLLAPSED_KEY = 'hermes.sessions.groups.collapsed'
const HEADER_ESTIMATE = 36
const CARD_ESTIMATE = 74

function readCollapsedMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeCollapsedMap(map: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(map))
  } catch {
    /* noop */
  }
}

const GROUP_LABEL_STYLE: Record<
  SessionGroup['kind'],
  React.CSSProperties | undefined
> = {
  pinned: { color: 'var(--m-green-400, var(--theme-accent))' },
  day: { color: 'var(--theme-muted)' },
  project: { color: 'var(--theme-text)' },
  unfiled: { color: 'var(--theme-muted)' },
}

/**
 * Collapse state is keyed by group `key` (`day:Today`, `project:<id>`, …).
 * Pinned/day groups fall back to the legacy label key so state saved before
 * project folders existed still applies.
 */
export function isGroupCollapsed(
  map: Record<string, boolean>,
  group: Pick<SessionGroup, 'key' | 'label' | 'kind'>,
): boolean {
  const legacy =
    group.kind === 'pinned' || group.kind === 'day'
      ? map[group.label]
      : undefined
  return (map[group.key] ?? legacy) === true
}

type SessionItem = SessionGroup['items'][number]

type RowModel =
  | {
      type: 'header'
      key: string
      group: SessionGroup
      count: number
      collapsed: boolean
    }
  | {
      type: 'card'
      key: string
      item: SessionItem
      isActive: boolean
      /** Project colour stripe (project sections only). */
      stripe?: string
    }

interface SidebarListV2Props {
  groups: Array<SessionGroup>
  updatesOnly?: boolean
  hasPendingUpdates?: boolean
  onToggleUpdatesOnly?: () => void
  onMarkAllRead?: () => void
  /** Present while more sessions exist server-side than are loaded. */
  loadMore?: LoadMoreState
  /** Project mode: per-folder metadata and the per-folder loader. */
  folders?: FolderSupport
  /**
   * Rendered last INSIDE the scroll container, below every group.
   */
  bottomSlot?: ReactNode
}

/** What the sidebar knows about one folder's backing project. */
export type FolderInfo = {
  board: string | null
  paths: number
  /** Set when a folder path is a git checkout. */
  git?: { branch?: string }
}

export type FolderSupport = {
  info: Record<string, FolderInfo | undefined>
  loading: ReadonlySet<string>
  exhausted: ReadonlySet<string>
  /** Folders whose last load request failed (retryable). */
  failed: ReadonlySet<string>
  onLoad: (projectId: string) => void
}

type LoadMoreState = {
  loaded: number
  /** Server total for the visible sources; null when unknown or filtered. */
  total: number | null
  loading: boolean
  onLoadMore: () => void
}

export function SidebarListV2({
  groups,
  updatesOnly = false,
  hasPendingUpdates = false,
  onToggleUpdatesOnly,
  onMarkAllRead,
  loadMore,
  folders,
  bottomSlot,
}: SidebarListV2Props) {
  const [collapsedMap, setCollapsedMap] =
    useState<Record<string, boolean>>(readCollapsedMap)
  const toggleGroup = (group: SessionGroup) => {
    setCollapsedMap((prev) => {
      const next = { ...prev, [group.key]: !isGroupCollapsed(prev, group) }
      writeCollapsedMap(next)
      return next
    })
  }

  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeSessionKey = pathname.startsWith('/chat/')
    ? pathname.split('/chat/')[1]
    : null
  const parentRef = useRef<HTMLDivElement | null>(null)
  // Tracks the header index that should be pinned at the top of the
  // viewport for the current scroll offset. Driven by `rangeExtractor`
  // so the active header is always kept in the virtual window (it would
  // otherwise unmount once scrolled past, and `position: sticky` cannot
  // work on the `absolute`+`translateY` rows the virtualizer emits).
  const activeStickyIndexRef = useRef(0)

  const rows = useMemo<Array<RowModel>>(() => {
    const next: Array<RowModel> = []
    for (const group of groups) {
      const groupItems = group.items
      const isCollapsed = isGroupCollapsed(collapsedMap, group)
      const stripe =
        group.kind === 'project'
          ? folderColor(group.key.slice('project:'.length), group.color)
          : undefined
      next.push({
        type: 'header',
        key: `header:${group.key}`,
        group,
        count: groupItems.length,
        collapsed: isCollapsed,
      })
      if (!isCollapsed) {
        for (const item of groupItems) {
          const rawId = item.id.split(':').slice(1).join(':')
          const isActive = isChatSource(item.src) && rawId === activeSessionKey
          next.push({
            type: 'card',
            key: item.id,
            item,
            isActive,
            stripe,
          })
        }
      }
    }
    return next
  }, [groups, collapsedMap, activeSessionKey])

  const selecting = useSessionsSelectionStore((s) => s.active)
  const selected = useSessionsSelectionStore((s) => s.selected)
  const clickSelect = useSessionsSelectionStore((s) => s.click)
  const setMany = useSessionsSelectionStore((s) => s.setMany)
  const setOrder = useSessionsSelectionStore((s) => s.setOrder)
  const exitSelect = useSessionsSelectionStore((s) => s.exit)
  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const projectMode = groups.some(
    (g) => g.kind === 'project' || g.kind === 'unfiled',
  )

  // Visible card order drives shift-click range selection.
  useEffect(() => {
    setOrder(rows.flatMap((r) => (r.type === 'card' ? [r.item.id] : [])))
  }, [rows, setOrder])

  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      // A bulk dialog owns Esc while open (and ignores it mid-delete).
      if (e.key !== 'Escape') return
      if (useSessionsSelectionStore.getState().dialogOpen) return
      exitSelect()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selecting, exitSelect])

  /**
   * Select mode: a click toggles instead of navigating. Outside select mode,
   * shift-click enters select mode with that card; cmd/ctrl-click is left to
   * the browser (open in new tab).
   */
  const onCardClickCapture = (e: React.MouseEvent, id: string) => {
    if (!selecting && !e.shiftKey) return
    // Portaled children (context menu, dialogs) bubble through the React tree
    // but are not DOM descendants — leave their clicks alone.
    if (!e.currentTarget.contains(e.target as Node)) return
    e.preventDefault()
    e.stopPropagation()
    clickSelect(id, e.shiftKey)
  }

  const footer = selecting ? (
    <SidebarBulkActionsV2 items={allItems} />
  ) : (
    <SidebarAttentionActions
      updatesOnly={updatesOnly}
      hasPendingUpdates={hasPendingUpdates}
      onToggleUpdatesOnly={onToggleUpdatesOnly}
      onMarkAllRead={onMarkAllRead}
    />
  )

  const stickyIndexes = useMemo(
    () => rows.flatMap((row, i) => (row.type === 'header' ? [i] : [])),
    [rows],
  )

  const rangeExtractor = useCallback(
    (range: Range) => {
      // Pin the nearest preceding header so it stays mounted and can be
      // rendered as a sticky overlay even after its rows scroll past.
      let active = stickyIndexes[0] ?? 0
      for (const idx of stickyIndexes) {
        if (idx <= range.startIndex) active = idx
        else break
      }
      activeStickyIndexRef.current = active
      const next = new Set([active, ...defaultRangeExtractor(range)])
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      rows[index]?.type === 'header' ? HEADER_ESTIMATE : CARD_ESTIMATE,
    overscan: 8,
    rangeExtractor,
  })

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, rows.length])

  // Auto-scroll the active session into view. With virtualization the
  // active row may not be mounted at all, so the browser can't reach it
  // on its own — drive the virtualizer to the index explicitly.
  useEffect(() => {
    if (!activeSessionKey) return
    const idx = rows.findIndex((row) => row.type === 'card' && row.isActive)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' })
    // Only when the active session changes, not on every rows rebuild.
  }, [activeSessionKey])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <span style={{ fontSize: 24, opacity: 0.3 }}>∅</span>
            <span className="text-xs" style={{ color: 'var(--theme-muted)' }}>
              {updatesOnly ? 'No unseen updates' : 'No sessions'}
            </span>
          </div>
        </div>
        {loadMore && <LoadMoreRow {...loadMore} />}
        {bottomSlot}
        {footer}
        <NewChatFooter />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto"
        data-testid="sessions-list-v2"
      >
        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            const isStickyHeader =
              row.type === 'header' &&
              activeStickyIndexRef.current === virtualRow.index
            return (
              <div
                key={row.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={
                  isStickyHeader
                    ? {
                        // Pinned header: real `position: sticky` works here
                        // because this element is in normal flow relative to
                        // the scroll container (no transform offset).
                        position: 'sticky',
                        top: 0,
                        left: 0,
                        width: '100%',
                        zIndex: 2,
                      }
                    : {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }
                }
              >
                {row.type === 'header' ? (
                  <GroupHeader
                    row={row}
                    projectMode={projectMode}
                    selecting={selecting}
                    selected={selected}
                    onToggle={() => toggleGroup(row.group)}
                    loadMore={loadMore}
                    folders={folders}
                    onSelectAll={(on) =>
                      setMany(
                        row.group.items.map((i) => i.id),
                        on,
                      )
                    }
                  />
                ) : (
                  <div
                    aria-selected={
                      selecting ? selected[row.item.id] === true : undefined
                    }
                    data-testid={`card-row-${row.item.id}`}
                    onClickCapture={(e) => onCardClickCapture(e, row.item.id)}
                    style={{ position: 'relative' }}
                  >
                    {row.stripe && (
                      <span
                        aria-hidden
                        data-testid="folder-stripe"
                        style={{
                          position: 'absolute',
                          left: 2,
                          top: 8,
                          bottom: 8,
                          width: 2,
                          borderRadius: 1,
                          background: row.stripe,
                          zIndex: 1,
                        }}
                      />
                    )}
                    {selecting && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.item.title}`}
                        checked={selected[row.item.id] === true}
                        readOnly
                        tabIndex={-1}
                        style={{
                          position: 'absolute',
                          right: 14,
                          top: 10,
                          zIndex: 1,
                          accentColor: 'var(--theme-accent)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    <SidebarCardV2 item={row.item} isActive={row.isActive} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {loadMore && <LoadMoreRow {...loadMore} />}
        {bottomSlot}
      </div>

      {footer}
      <NewChatFooter />
    </div>
  )
}

function LoadMoreRow({ loaded, total, loading, onLoadMore }: LoadMoreState) {
  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
      data-testid="sessions-load-more"
      style={{ color: 'var(--theme-muted)' }}
    >
      <span className="m-mono" aria-live="polite">
        Loaded {loaded}
        {total != null && ` of ${total}`}
      </span>
      <button
        type="button"
        // aria-disabled, not disabled: keeps focus on the button while a page
        // loads instead of dropping it to <body>.
        aria-disabled={loading}
        aria-busy={loading}
        onClick={() => {
          if (!loading) onLoadMore()
        }}
        className="rounded px-2 py-0.5"
        style={{
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-card)',
          color: 'var(--theme-text)',
          cursor: loading ? 'default' : 'pointer',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  )
}

function GroupHeader({
  row,
  projectMode,
  selecting,
  selected,
  onToggle,
  onSelectAll,
  loadMore,
  folders,
}: {
  row: Extract<RowModel, { type: 'header' }>
  projectMode: boolean
  selecting: boolean
  selected: Partial<Record<string, true>>
  onToggle: () => void
  onSelectAll: (on: boolean) => void
  loadMore?: LoadMoreState
  folders?: FolderSupport
}) {
  const { group } = row
  // The server total shows whenever known; "x of y loaded" only for AT.
  const partial = group.total !== undefined && group.total > row.count
  const isProject = group.kind === 'project'
  const projectId = group.key.slice('project:'.length)
  const info = isProject ? folders?.info[projectId] : undefined
  const linked = Boolean(info && (info.board || info.paths > 0))
  const linkLabel = info
    ? [
        'Linked project',
        info.board && `board: ${info.board}`,
        info.paths > 0 && `${info.paths} path${info.paths === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const gitLabel = info?.git
    ? `Git repo${info.git.branch ? ` · ${info.git.branch}` : ''}`
    : ''
  const folderLoad =
    isProject && partial && folders && !folders.exhausted.has(projectId)
      ? folders
      : undefined
  const folderLoading = folderLoad?.loading.has(projectId) ?? false
  const folderFailed = folderLoad?.failed.has(projectId) ?? false
  const missing = partial ? group.total! - row.count : 0
  const loadLabel = `${folderFailed ? 'Retry: load' : 'Load'} ${missing} more chat${missing === 1 ? '' : 's'} in ${group.label}`
  // Icon meanings for AT: described by, not part of, the toggle's name.
  const describeId = useId()
  const iconText = [linked && linkLabel, gitLabel].filter(Boolean).join('. ')
  const navigate = useNavigate()
  const browsedProfile = useResolvedProfile()
  const toggleLabel = `${group.label}${group.archived ? ', archived' : ''}, ${
    partial
      ? `${row.count} of ${group.total} loaded`
      : `${row.count} chat${row.count === 1 ? '' : 's'}`
  }`
  const newChatHere = () =>
    startChatInFolder(
      {
        projectId,
        projectSlug: group.slug,
        name: group.label,
        profile: browsedProfile,
      },
      navigate,
    )
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const closeMenu = () => {
    setMenuAt(null)
    // The menu item that opened a dialog is gone by now; land focus back on
    // the folder's ⋯ trigger unless the user already moved it elsewhere.
    setTimeout(() => {
      if (document.activeElement === document.body) menuBtnRef.current?.focus()
    }, 0)
  }
  const [renaming, setRenaming] = useState(false)
  const nSelected = selecting
    ? group.items.filter((i) => selected[i.id]).length
    : 0
  const allSelected = nSelected > 0 && nSelected === group.items.length
  return (
    <div
      className="group/hdr flex items-center gap-1 pr-2 select-none"
      data-testid={`group-header-${group.key}`}
      onContextMenu={
        isProject
          ? (e) => {
              e.preventDefault()
              setMenuAt({ x: e.clientX, y: e.clientY })
            }
          : undefined
      }
      style={{
        background: 'var(--theme-sidebar)',
        opacity: group.archived ? 0.55 : 1,
      }}
    >
      {selecting && (
        <input
          type="checkbox"
          aria-label={`Select all in ${group.label}`}
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = nSelected > 0 && !allSelected
          }}
          onChange={() => onSelectAll(!allSelected)}
          className="ml-3 mt-2"
          style={{ accentColor: 'var(--theme-accent)' }}
        />
      )}
      {renaming ? (
        <div className="flex flex-1 min-w-0 items-center px-3 pt-3 pb-1">
          <FolderRenameInput
            projectId={projectId}
            name={group.label}
            onDone={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!row.collapsed}
          aria-label={toggleLabel}
          aria-describedby={iconText ? describeId : undefined}
          className="flex min-w-0 items-center gap-2 pl-3 pt-3 pb-1 z-10"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            paddingLeft: selecting ? 4 : undefined,
          }}
        >
          <span
            aria-hidden
            className="m-mono"
            style={{
              display: 'inline-block',
              fontSize: 8,
              width: 10,
              textAlign: 'center',
              color: 'var(--theme-muted)',
              opacity: 0.7,
              transform: row.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 120ms ease-out',
            }}
          >
            ▼
          </span>
          {isProject && (
            <span
              aria-hidden
              data-testid="folder-dot"
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                flexShrink: 0,
                background: folderColor(projectId, group.color),
              }}
            />
          )}
          {linked && (
            <span
              data-testid="folder-link-icon"
              aria-hidden
              title={linkLabel}
              className="flex flex-shrink-0"
              style={{ color: 'var(--theme-muted)' }}
            >
              <Link2 size={11} aria-hidden />
            </span>
          )}
          {gitLabel && (
            <span
              data-testid="folder-git-icon"
              aria-hidden
              title={gitLabel}
              className="flex flex-shrink-0"
              style={{ color: 'var(--theme-muted)' }}
            >
              <GitBranch size={11} aria-hidden />
            </span>
          )}
          <span
            className="m-label truncate"
            style={{ ...GROUP_LABEL_STYLE[group.kind], opacity: 0.7 }}
          >
            {group.kind === 'pinned' && projectMode ? '★ ' : ''}
            {group.label}
            {group.archived ? ' · ARCHIVED' : ''}
          </span>
          <span
            className="m-mono rounded-full px-1.5 flex-shrink-0"
            style={{
              border: '1px solid var(--m-green-500, var(--theme-accent))',
              color: 'var(--m-green-400, var(--theme-accent))',
              background: 'transparent',
              lineHeight: '14px',
              fontVariantNumeric: 'tabular-nums',
            }}
            data-testid="group-count"
            title={
              partial ? `${row.count} of ${group.total} loaded` : undefined
            }
          >
            {partial ? group.total : row.count}
          </span>
        </button>
      )}
      {iconText && (
        <span
          id={describeId}
          className="sr-only"
          data-testid="folder-icons-desc"
        >
          {iconText}
        </span>
      )}
      {!renaming && folderLoad && (
        <button
          type="button"
          // aria-disabled, not disabled: keeps focus while the folder loads.
          aria-disabled={folderLoading}
          aria-busy={folderLoading}
          aria-label={loadLabel}
          title={folderFailed ? 'Retry' : loadLabel}
          data-testid="folder-load-more"
          onClick={() => {
            if (!folderLoading) folderLoad.onLoad(projectId)
          }}
          className="flex flex-shrink-0 items-center pt-2"
          style={{
            color: 'var(--m-green-400, var(--theme-accent))',
            background: 'transparent',
            border: 'none',
            cursor: folderLoading ? 'default' : 'pointer',
            padding: '8px 0 0 0',
          }}
        >
          {folderLoading ? (
            <Loader2 size={11} className="animate-spin" aria-hidden />
          ) : folderFailed ? (
            <RotateCw size={11} aria-hidden />
          ) : (
            <ArrowDownToLine size={11} aria-hidden />
          )}
        </button>
      )}
      {!renaming && (
        <span
          aria-hidden
          onClick={onToggle}
          className="mt-2 ml-1"
          style={{
            flex: 1,
            alignSelf: 'stretch',
            backgroundImage:
              'linear-gradient(var(--theme-border-subtle, var(--theme-border)), var(--theme-border-subtle, var(--theme-border)))',
            backgroundSize: '100% 1px',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: 0.5,
            cursor: 'pointer',
          }}
        />
      )}
      {row.count === 0 && partial && loadMore && !folderLoad && (
        <button
          type="button"
          // Pages the shared feed, not this folder; stays mounted (aria-busy)
          // while loading so focus is kept.
          aria-disabled={loadMore.loading}
          aria-busy={loadMore.loading}
          onClick={() => {
            if (!loadMore.loading) loadMore.onLoadMore()
          }}
          aria-label="Load older sessions (all folders)"
          className="m-mono pt-2"
          style={{
            color: 'var(--theme-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 10,
            opacity: loadMore.loading ? 0.6 : 1,
          }}
        >
          {loadMore.loading ? 'Loading…' : 'Load older'}
        </button>
      )}
      {isProject && !renaming && !group.archived && (
        <button
          type="button"
          aria-label={`New chat in ${group.label}`}
          title={`New chat in ${group.label}`}
          data-testid="folder-new-chat"
          onClick={newChatHere}
          className="flex flex-shrink-0 items-center opacity-0 group-hover/hdr:opacity-100 focus:opacity-100"
          style={{
            color: 'var(--theme-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '8px 0 0 0',
          }}
        >
          <MessageSquarePlus size={11} aria-hidden />
        </button>
      )}
      {isProject && (
        <button
          ref={menuBtnRef}
          type="button"
          aria-label={`Folder actions for ${group.label}`}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenuAt({ x: r.right - 180, y: r.bottom + 2 })
          }}
          className="m-mono pt-2 opacity-0 group-hover/hdr:opacity-100 focus:opacity-100"
          style={{
            color: 'var(--theme-muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            opacity: menuAt ? 1 : undefined,
          }}
        >
          ⋯
        </button>
      )}
      {isProject && menuAt && (
        <FolderHeaderMenu
          projectId={projectId}
          name={group.label}
          archived={group.archived === true}
          position={menuAt}
          onClose={closeMenu}
          onRename={() => setRenaming(true)}
          onNewChat={group.archived ? undefined : newChatHere}
        />
      )}
    </div>
  )
}

function SidebarAttentionActions({
  updatesOnly,
  hasPendingUpdates,
  onToggleUpdatesOnly,
  onMarkAllRead,
}: Omit<SidebarListV2Props, 'groups'>) {
  return (
    <div
      className="flex gap-1.5 shrink-0 px-3 py-2"
      style={{ borderTop: '1px solid var(--theme-border)' }}
    >
      <button
        type="button"
        className={`m-chip flex-1 rounded py-1 transition-all${hasPendingUpdates ? ' attention-pulse' : ''}`}
        aria-label="Show unread updates"
        aria-pressed={updatesOnly}
        onClick={onToggleUpdatesOnly}
        style={{
          background: updatesOnly
            ? 'color-mix(in srgb, var(--m-green-400, var(--theme-accent)) 18%, transparent)'
            : 'var(--theme-card)',
          border: `1px solid ${updatesOnly ? 'var(--m-green-400, var(--theme-accent))' : 'var(--theme-border)'}`,
          color: updatesOnly
            ? 'var(--m-green-400, var(--theme-accent))'
            : 'var(--theme-muted)',
          cursor: 'pointer',
        }}
      >
        UPDATES
      </button>
      <button
        type="button"
        className="m-chip flex-1 rounded py-1 transition-all"
        aria-label="Mark all updates as read"
        disabled={!hasPendingUpdates}
        onClick={onMarkAllRead}
        title={
          hasPendingUpdates
            ? 'Mark all unread updates as read'
            : 'No unread updates'
        }
        style={{
          background: hasPendingUpdates
            ? 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 10%, transparent)'
            : 'var(--theme-card)',
          border: `1px solid ${hasPendingUpdates ? 'var(--m-green-500, var(--theme-accent))' : 'var(--theme-border)'}`,
          color: hasPendingUpdates
            ? 'var(--m-green-400, var(--theme-accent))'
            : 'var(--theme-muted)',
          cursor: hasPendingUpdates ? 'pointer' : 'default',
          opacity: hasPendingUpdates ? 1 : 0.45,
        }}
      >
        MARK READ
      </button>
    </div>
  )
}

function NewChatFooter() {
  return (
    <div
      className="shrink-0 px-3 py-2"
      style={{ borderTop: '1px solid var(--theme-border)' }}
    >
      <Link
        to="/chat/$sessionKey"
        params={{ sessionKey: 'new' }}
        // A plain new chat is not filed anywhere.
        onClick={clearPendingFolder}
        style={{ textDecoration: 'none', display: 'block' }}
      >
        <button
          type="button"
          className="m-label w-full rounded py-1.5 font-bold transition-all"
          style={{
            background:
              'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 20%, transparent)',
            color: 'var(--m-green-400, var(--theme-accent))',
            border: '1px solid var(--m-green-500, var(--theme-accent))',
            boxShadow: '0 0 8px var(--m-green-500, var(--theme-accent))44',
            cursor: 'pointer',
          }}
        >
          + NEW CHAT
        </button>
      </Link>
    </div>
  )
}
