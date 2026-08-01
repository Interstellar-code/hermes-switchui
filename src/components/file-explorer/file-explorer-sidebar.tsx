import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Attachment01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete01Icon,
  Download01Icon,
  File01Icon,
  Folder01Icon,
  Image01Icon,
  Pen01Icon,
  PlusSignIcon,
  RefreshIcon,
  Upload01Icon,
} from '@hugeicons/core-free-icons'
import FilePreviewDialog from './file-preview-dialog'
import { FilesPalette } from '@/screens/files/files-palette'
import '@/styles/matrix-files.css'
import { cn } from '@/lib/utils'
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Button } from '@/components/ui/button'
import { writeTextToClipboard } from '@/lib/clipboard'
import { clampContextMenuPosition } from '@/lib/context-menu'

export type FileEntry = {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: Array<FileEntry>
}

type FileExplorerSidebarProps = {
  collapsed: boolean
  onToggle: () => void
  onInsertReference: (reference: string) => void
  onAttachImage: (path: string) => Promise<void>
  onAttachFile: (path: string) => Promise<void>
  hidden?: boolean
  className?: string
}

type ContextMenuState = {
  x: number
  y: number
  entry: FileEntry
}

type PromptState = {
  mode: 'rename' | 'new-file' | 'new-folder'
  targetPath: string
  defaultValue?: string
}

const ROOT_LABEL = 'Workspace'

function isImageFile(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
}

// Extensions the composer can embed directly (text + multimodal formats).
function isAttachableFile(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return ['txt', 'md', 'json', 'jpg', 'jpeg', 'png', 'pdf'].includes(ext)
}

function getFileIcon(entry: FileEntry) {
  if (entry.type === 'folder') return Folder01Icon
  if (isImageFile(entry.name)) return Image01Icon
  return File01Icon
}

function normalizePath(pathValue: string) {
  return pathValue.replace(/\\/g, '/')
}

function getParentPath(pathValue: string) {
  const normalized = normalizePath(pathValue)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function buildReference(pathValue: string) {
  const normalized = normalizePath(pathValue)
  return `See file: workspace/${normalized}`
}

function buildFilePath(workspaceRoot: string, pathValue: string) {
  const normalizedPath = normalizePath(pathValue).replace(/^\/+/, '')
  const normalizedRoot = normalizePath(workspaceRoot).replace(/\/+$/, '')
  return normalizedRoot ? `${normalizedRoot}/${normalizedPath}` : normalizedPath
}

async function fetchFileTree(): Promise<{
  entries: Array<FileEntry>
  workspaceRoot: string
}> {
  const res = await fetch('/api/files?action=list')
  if (!res.ok) throw new Error('Failed to load files')
  const data = (await res.json()) as { entries?: Array<FileEntry>; base?: string }
  return {
    entries: Array.isArray(data.entries) ? data.entries : [],
    workspaceRoot: typeof data.base === 'string' ? data.base : '',
  }
}

function filterTree(entries: Array<FileEntry>, term: string): Array<FileEntry> {
  if (!term.trim()) return entries
  const lower = term.toLowerCase()
  const filterEntry = (entry: FileEntry): FileEntry | null => {
    if (entry.type === 'file') {
      return entry.name.toLowerCase().includes(lower) ? entry : null
    }
    const children = (entry.children || [])
      .map(filterEntry)
      .filter((child): child is FileEntry => child !== null)
    if (entry.name.toLowerCase().includes(lower) || children.length > 0) {
      return { ...entry, children }
    }
    return null
  }

  return entries
    .map(filterEntry)
    .filter((entry): entry is FileEntry => entry !== null)
}

export function FileExplorerSidebar({
  collapsed,
  onToggle,
  onInsertReference,
  onAttachImage,
  onAttachFile,
  hidden = false,
  className,
}: FileExplorerSidebarProps) {
  const [entries, setEntries] = useState<Array<FileEntry>>([])
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const uploadTargetRef = useRef<string>('')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { entries: nextEntries, workspaceRoot: nextWorkspaceRoot } =
        await fetchFileTree()
      setEntries(nextEntries)
      setWorkspaceRoot(nextWorkspaceRoot)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  const filteredEntries = useMemo(
    () => filterTree(entries, search),
    [entries, search],
  )

  const isSearchActive = search.trim().length > 0

  const paletteFiles = useMemo(() => {
    const files: Array<FileEntry> = []
    const walk = (items: Array<FileEntry>) => {
      for (const entry of items) {
        if (entry.type === 'folder') walk(entry.children ?? [])
        else files.push(entry)
      }
    }
    walk(entries)
    return files
  }, [entries])

  const toggleFolder = useCallback((pathValue: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(pathValue)) next.delete(pathValue)
      else next.add(pathValue)
      return next
    })
  }, [])

  // Listen for cross-app "open this path" events from inline-code links
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ path?: string }>).detail
      const target = (detail.path ?? '').trim()
      if (!target) return
      const parts = target.split('/').filter(Boolean)
      const parents: Array<string> = []
      for (let i = 0; i < parts.length; i++) {
        parents.push('/' + parts.slice(0, i + 1).join('/'))
      }
      setExpanded((prev) => {
        if (parents.every((p) => prev.has(p))) return prev
        const next = new Set(prev)
        for (const p of parents) next.add(p)
        return next
      })
      // Best-effort preview if it looks like a file (has extension)
      if (/\.[A-Za-z0-9]+$/.test(target)) setPreviewPath(target)
    }
    window.addEventListener('hermes:open-file', onOpen)
    return () => window.removeEventListener('hermes:open-file', onOpen)
  }, [])

  const openPrompt = useCallback((state: PromptState) => {
    setPromptState(state)
    setPromptValue(state.defaultValue || '')
  }, [])

  const handleRename = useCallback(
    (entry: FileEntry) => {
      openPrompt({
        mode: 'rename',
        targetPath: entry.path,
        defaultValue: entry.name,
      })
    },
    [openPrompt],
  )

  const handleNewFile = useCallback(
    (entry: FileEntry) => {
      openPrompt({ mode: 'new-file', targetPath: entry.path })
    },
    [openPrompt],
  )

  const handleNewFolder = useCallback(
    (entry: FileEntry) => {
      openPrompt({ mode: 'new-folder', targetPath: entry.path })
    },
    [openPrompt],
  )

  const handleDelete = useCallback(
    async (entry: FileEntry) => {
      if (!window.confirm(`Delete ${entry.name}? This cannot be undone.`))
        return
      setActionError(null)
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'delete', path: entry.path }),
        })
        if (!res.ok) throw new Error(await res.text())
        await refresh()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      }
    },
    [refresh],
  )

  const handleDownload = useCallback(async (entry: FileEntry) => {
    setActionError(null)
    try {
      const res = await fetch(
        `/api/files?action=download&path=${encodeURIComponent(entry.path)}`,
      )
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = entry.name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not download the file.',
      )
    }
  }, [])

  const handleUploadClick = useCallback((targetPath: string) => {
    uploadTargetRef.current = targetPath
    uploadInputRef.current?.click()
  }, [])

  const handleUploadChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      if (files.length === 0) return
      setActionError(null)
      try {
        for (const file of files) {
          const form = new FormData()
          form.append('action', 'upload')
          form.append('path', uploadTargetRef.current || '')
          form.append('file', file)
          const res = await fetch('/api/files', { method: 'POST', body: form })
          if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
        }
        await refresh()
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Could not upload the file.',
        )
      } finally {
        event.target.value = ''
      }
    },
    [refresh],
  )

  const handlePromptSubmit = useCallback(async () => {
    if (!promptState) return
    const value = promptValue.trim()
    if (!value) return

    setActionError(null)
    try {
      let res: Response
      if (promptState.mode === 'rename') {
        const parent = getParentPath(promptState.targetPath)
        const nextPath = parent ? `${parent}/${value}` : value
        res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'rename',
            from: promptState.targetPath,
            to: nextPath,
          }),
        })
      } else if (promptState.mode === 'new-folder') {
        const nextPath = promptState.targetPath
          ? `${promptState.targetPath}/${value}`
          : value
        res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'mkdir', path: nextPath }),
        })
      } else {
        const nextPath = promptState.targetPath
          ? `${promptState.targetPath}/${value}`
          : value
        res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'write',
            path: nextPath,
            content: '',
          }),
        })
      }
      if (!res.ok) throw new Error(await res.text())
      setPromptState(null)
      setPromptValue('')
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }, [promptState, promptValue, refresh])

  const handleFileClick = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'folder') {
        toggleFolder(entry.path)
        return
      }
      setPreviewPath(entry.path)
    },
    [toggleFolder],
  )

  const handlePalettePick = useCallback((entry: FileEntry) => {
    setPreviewPath(entry.path)
    const parts = entry.path.split('/').filter(Boolean)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let i = 1; i < parts.length; i += 1) {
        next.add(parts.slice(0, i).join('/'))
      }
      return next
    })
  }, [])

  const handleCopyPath = useCallback(async (entry: FileEntry) => {
    setActionError(null)
    try {
      await writeTextToClipboard(buildFilePath(workspaceRoot, entry.path))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not copy path')
    }
  }, [workspaceRoot])

  const handleAttachImage = useCallback(
    async (entry: FileEntry) => {
      setActionError(null)
      try {
        await onAttachImage(entry.path)
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Could not attach image',
        )
      }
    },
    [onAttachImage],
  )

  const handleAttachFile = useCallback(
    async (entry: FileEntry) => {
      setActionError(null)
      try {
        await onAttachFile(entry.path)
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Could not attach file',
        )
      }
    },
    [onAttachFile],
  )

  const resolvedContextPosition = useMemo(() => {
    if (!contextMenu || typeof window === 'undefined') return contextMenu
    const { entry } = contextMenu
    const itemCount =
      entry.type === 'folder'
        ? 8
        : 6 +
          (isAttachableFile(entry.name) ? 1 : 0) +
          (isImageFile(entry.name) ? 1 : 0)
    return {
      ...contextMenu,
      ...clampContextMenuPosition(
        contextMenu,
        { width: 220, height: itemCount * 36 + 16 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    }
  }, [contextMenu])

  const renderEntry = useCallback(
    (entry: FileEntry, depth: number) => {
      const isExpanded = isSearchActive ? true : expanded.has(entry.path)
      const padding = 12 + depth * 16

      return (
        <div key={entry.path}>
          <button
            type="button"
            onClick={() => handleFileClick(entry)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                entry,
              })
            }}
            className={cn(
              'files-tree-row',
              entry.type === 'folder' && isExpanded ? 'is-expanded' : '',
              entry.type === 'file' ? 'is-leaf' : '',
            )}
            style={{ paddingLeft: padding }}
          >
            {entry.type === 'folder' ? (
              <span className="chev">▶</span>
            ) : (
              <span className="chev">▶</span>
            )}
            <span
              className={cn('icon', entry.type === 'folder' ? 'is-folder' : '')}
              aria-hidden="true"
            />
            <span className="name">{entry.name}</span>
            {entry.type === 'folder' && entry.children?.length ? (
              <span className="badge">{entry.children.length}</span>
            ) : null}
          </button>
          {entry.type === 'folder' && isExpanded && entry.children?.length ? (
            <div>
              {entry.children.map((child) => renderEntry(child, depth + 1))}
            </div>
          ) : null}
        </div>
      )
    },
    [expanded, handleFileClick, isSearchActive],
  )

  if (hidden) return null

  return (
    <div data-screen="files" className="h-full w-full">
      <aside
        className={cn(
          'files-tree h-full transition-all duration-200 ease-out',
          collapsed && 'is-collapsed pointer-events-none opacity-0',
          className,
        )}
      >
        <div className="files-tree-head">
          <h3>{ROOT_LABEL}</h3>
          <div className="files-tree-actions">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={refresh}
              title="Refresh"
            >
              <HugeiconsIcon icon={RefreshIcon} size={18} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => handleUploadClick('')}
              title="Upload"
            >
              <HugeiconsIcon icon={Upload01Icon} size={18} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => openPrompt({ mode: 'new-file', targetPath: '' })}
              title="New file"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={18} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onToggle}
              title="Close file explorer"
              aria-label="Close file explorer"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} />
            </Button>
          </div>
        </div>

        <button
          type="button"
          className="files-quickjump"
          onClick={() => setPaletteOpen(true)}
          aria-label="Quick jump to any file"
        >
          <span aria-hidden="true">⌘K</span>
          <span className="qj-text">Quick jump to any file…</span>
          <kbd aria-hidden="true">⌘K</kbd>
        </button>

        <div className="files-tree-search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search workspace…"
            aria-label="Search files"
          />
        </div>

        {actionError ? (
          <p className="px-3 pb-2 text-xs text-destructive" role="status">
            {actionError}
          </p>
        ) : null}

        <ScrollAreaRoot className="files-tree-body">
          <ScrollAreaViewport>
            {loading ? (
              <div className="files-tree-loading">Loading…</div>
            ) : error ? (
              <div className="files-tree-error">
                No workspace selected.{' '}
                <button type="button" onClick={refresh}>
                  Retry
                </button>
              </div>
            ) : entries.length === 0 ? (
              <div className="files-tree-empty">
                Workspace is empty.{' '}
                <button
                  type="button"
                  onClick={() =>
                    openPrompt({ mode: 'new-file', targetPath: '' })
                  }
                >
                  New file
                </button>
              </div>
            ) : (
              <div>{filteredEntries.map((entry) => renderEntry(entry, 0))}</div>
            )}
          </ScrollAreaViewport>
          <ScrollAreaScrollbar orientation="vertical">
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaCorner />
        </ScrollAreaRoot>

        <div className="files-tree-foot">
          <span>
            <b>{paletteFiles.length}</b> files
          </span>
        </div>

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleUploadChange}
        />

        {resolvedContextPosition && typeof document !== 'undefined'
          ? createPortal(
              <div
                role="menu"
                aria-label="File actions"
                className="fixed z-50 min-w-[160px] rounded-lg p-1 text-sm text-[var(--m-text,var(--theme-text))] shadow-lg"
                style={{
                  background: 'var(--theme-card,#0a0a0a)',
                  border: '1px solid var(--theme-border)',
                  top: resolvedContextPosition.y,
                  left: resolvedContextPosition.x,
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                  onClick={() => {
                    if (resolvedContextPosition.entry.type === 'folder') {
                      toggleFolder(resolvedContextPosition.entry.path)
                    } else {
                      setPreviewPath(resolvedContextPosition.entry.path)
                    }
                    setContextMenu(null)
                  }}
                >
                  <HugeiconsIcon
                    icon={
                      resolvedContextPosition.entry.type === 'folder'
                        ? Folder01Icon
                        : File01Icon
                    }
                    size={16}
                  />{' '}
                  Open
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                  onClick={() => {
                    void handleCopyPath(resolvedContextPosition.entry)
                    setContextMenu(null)
                  }}
                >
                  <HugeiconsIcon icon={Copy01Icon} size={16} /> Copy path
                </button>
                {resolvedContextPosition.entry.type === 'file' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                    onClick={() => {
                      onInsertReference(
                        buildReference(resolvedContextPosition.entry.path),
                      )
                      setContextMenu(null)
                    }}
                  >
                    <HugeiconsIcon icon={File01Icon} size={16} /> Add reference
                    to chat
                  </button>
                ) : null}
                {resolvedContextPosition.entry.type === 'file' &&
                isAttachableFile(resolvedContextPosition.entry.name) ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                    onClick={() => {
                      void handleAttachFile(resolvedContextPosition.entry)
                      setContextMenu(null)
                    }}
                  >
                    <HugeiconsIcon icon={Attachment01Icon} size={16} /> Attach
                    to chat
                  </button>
                ) : null}
                {resolvedContextPosition.entry.type === 'file' &&
                isImageFile(resolvedContextPosition.entry.name) ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                    onClick={() => {
                      void handleAttachImage(resolvedContextPosition.entry)
                      setContextMenu(null)
                    }}
                  >
                    <HugeiconsIcon icon={Image01Icon} size={16} /> Attach image
                    to chat
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                  onClick={() => {
                    handleRename(resolvedContextPosition.entry)
                    setContextMenu(null)
                  }}
                >
                  <HugeiconsIcon icon={Pen01Icon} size={16} /> Rename
                </button>
                {resolvedContextPosition.entry.type === 'folder' ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                      onClick={() => {
                        handleNewFile(resolvedContextPosition.entry)
                        setContextMenu(null)
                      }}
                    >
                      <HugeiconsIcon icon={PlusSignIcon} size={16} /> New file
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                      onClick={() => {
                        handleNewFolder(resolvedContextPosition.entry)
                        setContextMenu(null)
                      }}
                    >
                      <HugeiconsIcon icon={Folder01Icon} size={16} /> New folder
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                      onClick={() => {
                        handleUploadClick(resolvedContextPosition.entry.path)
                        setContextMenu(null)
                      }}
                    >
                      <HugeiconsIcon icon={Upload01Icon} size={16} /> Upload
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]"
                    onClick={() => {
                      void handleDownload(resolvedContextPosition.entry)
                      setContextMenu(null)
                    }}
                  >
                    <HugeiconsIcon icon={Download01Icon} size={16} /> Download
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-red-700 hover:bg-red-50/80"
                  onClick={() => {
                    void handleDelete(resolvedContextPosition.entry)
                    setContextMenu(null)
                  }}
                >
                  <HugeiconsIcon icon={Delete01Icon} size={16} /> Delete
                </button>
              </div>,
              document.body,
            )
          : null}

        <Dialog
          open={Boolean(promptState)}
          onOpenChange={(open) => {
            if (!open) setPromptState(null)
          }}
        >
          <DialogContent>
            <div className="p-5 space-y-3">
              <DialogTitle>
                {promptState?.mode === 'rename'
                  ? 'Rename'
                  : promptState?.mode === 'new-folder'
                    ? 'New Folder'
                    : 'New File'}
              </DialogTitle>
              <DialogDescription>
                {promptState?.mode === 'rename'
                  ? 'Enter a new name.'
                  : 'Enter a name to create.'}
              </DialogDescription>
              <input
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                className="w-full rounded-md px-3 py-2 text-sm text-[var(--m-text,var(--theme-text))] focus:outline-none"
                style={{
                  background: 'var(--theme-card,rgba(0,0,0,0.3))',
                  border: '1px solid var(--theme-border)',
                }}
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handlePromptSubmit}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <FilePreviewDialog
          path={previewPath}
          onClose={() => setPreviewPath(null)}
          onSaved={refresh}
        />
        {paletteOpen ? (
          <FilesPalette
            files={paletteFiles}
            recents={[]}
            onClose={() => setPaletteOpen(false)}
            onPick={handlePalettePick}
          />
        ) : null}
      </aside>
    </div>
  )
}
