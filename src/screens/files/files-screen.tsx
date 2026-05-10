import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Markdown } from '@/components/prompt-kit/markdown'
import '@/styles/matrix-files.css'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type FileEntry = {
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  modifiedAt?: string
  children?: Array<FileEntry>
}

type FilesListResponse = {
  root: string
  base: string
  entries: Array<FileEntry>
}

type FileReadResponse = {
  type: 'text' | 'image'
  path: string
  content: string
}

type PromptState = {
  mode: 'rename' | 'new-folder'
  targetPath: string
  defaultValue?: string
}

type ContextMenuState = {
  x: number
  y: number
  entry: FileEntry
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'dist',
])

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])
const CODE_EXTS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'css',
  'html',
  'yml',
  'yaml',
  'sh',
  'py',
  'env',
])

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(getExt(name))
}

function isCodeFile(name: string): boolean {
  return CODE_EXTS.has(getExt(name))
}

function isMarkdownFile(name: string): boolean {
  const ext = getExt(name)
  return ext === 'md' || ext === 'mdx'
}

function isHtmlFile(name: string): boolean {
  const ext = getExt(name)
  return ext === 'html' || ext === 'htm'
}

function isEditableFile(name: string): boolean {
  return !isImageFile(name)
}

function getFileIconClass(entry: FileEntry): string {
  if (entry.type === 'folder') return 'folder'
  const ext = getExt(entry.name)
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (ext === 'json') return 'json'
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx')
    return 'code'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'file'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getParentPath(pathValue: string): string {
  const parts = pathValue.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function getPathParts(pathValue: string): Array<string> {
  return pathValue ? pathValue.split('/').filter(Boolean) : []
}

function getEntryKind(entry: FileEntry | null): string {
  if (!entry) return 'workspace'
  if (entry.type === 'folder') return 'folder'
  const ext = getExt(entry.name)
  if (isMarkdownFile(entry.name)) return 'markdown'
  if (isImageFile(entry.name)) return 'image'
  if (isCodeFile(entry.name)) return ext || 'code'
  return ext || 'text'
}

function countEntries(entries: Array<FileEntry>): {
  files: number
  folders: number
} {
  let files = 0
  let folders = 0
  const walk = (items: Array<FileEntry>) => {
    for (const item of items) {
      if (IGNORED_DIRS.has(item.name)) continue
      if (item.type === 'folder') {
        folders += 1
        if (item.children) walk(item.children)
      } else {
        files += 1
      }
    }
  }
  walk(entries)
  return { files, folders }
}

type MarkdownHeading = {
  id: string
  text: string
  level: 2 | 3
}

function getMarkdownOutline(content: string): Array<MarkdownHeading> {
  return content
    .split('\n')
    .map((line) => {
      const match = /^(#{2,3})\s+(.+)$/.exec(line.trim())
      if (!match) return null
      const text = match[2].replace(/[#*_`]/g, '').trim()
      if (!text) return null
      return {
        id: text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        text,
        level: match[1].length as 2 | 3,
      }
    })
    .filter((heading): heading is MarkdownHeading => Boolean(heading))
    .slice(0, 12)
}

function buildHtmlPreviewDocument(source: string): string {
  const withoutScripts = source.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    '',
  )
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<base target="_blank" />
<style>
  html, body {
    margin: 0;
    min-height: 100%;
    background: transparent;
    color: #d6f8de;
  }
</style>
</head>
<body>
${withoutScripts}
</body>
</html>`
}

// ──────────────────────────────────────────────────────────────────────────────
// Line-by-line diff (no external lib)
// ──────────────────────────────────────────────────────────────────────────────

type DiffLineKind = 'unchanged' | 'added' | 'removed'

type DiffLine = {
  kind: DiffLineKind
  text: string
  leftNum: number | null // original line number
  rightNum: number | null // new line number
}

/**
 * Very simple LCS-based diff. Produces a list of DiffLine entries that can be
 * rendered in a split/unified view.
 */
function computeDiff(original: string, updated: string): Array<DiffLine> {
  const aLines = original.split('\n')
  const bLines = updated.split('\n')
  const m = aLines.length
  const n = bLines.length

  // Build LCS table
  const dp: Array<Array<number>> = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  const result: Array<DiffLine> = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      result.push({
        kind: 'unchanged',
        text: aLines[i - 1],
        leftNum: i,
        rightNum: j,
      })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({
        kind: 'added',
        text: bLines[j - 1],
        leftNum: null,
        rightNum: j,
      })
      j--
    } else {
      result.push({
        kind: 'removed',
        text: aLines[i - 1],
        leftNum: i,
        rightNum: null,
      })
      i--
    }
  }
  return result.reverse()
}

// ──────────────────────────────────────────────────────────────────────────────
// Basic syntax highlighting (CSS-class only, no library)
// ──────────────────────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  'import',
  'export',
  'default',
  'from',
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'class',
  'extends',
  'new',
  'this',
  'type',
  'interface',
  'async',
  'await',
  'try',
  'catch',
  'throw',
  'null',
  'undefined',
  'true',
  'false',
  'typeof',
  'instanceof',
  'void',
  'in',
  'of',
  'break',
  'continue',
  'switch',
  'case',
  'delete',
])

type HighlightKind =
  | 'plain'
  | 'comment'
  | 'jsonKey'
  | 'keyword'
  | 'number'
  | 'string'
  | 'type'

type HighlightToken = {
  text: string
  kind: HighlightKind
}

const HIGHLIGHT_CLASS_BY_KIND: Record<
  Exclude<HighlightKind, 'plain'>,
  string
> = {
  comment: 'hl-comment',
  jsonKey: 'hl-key',
  keyword: 'hl-kw',
  number: 'hl-num',
  string: 'hl-str',
  type: 'hl-type',
}

function pushHighlightToken(
  tokens: Array<HighlightToken>,
  text: string,
  kind: HighlightKind = 'plain',
) {
  if (!text) return
  tokens.push({ text, kind })
}

function tokenizeJson(code: string): Array<HighlightToken> {
  const tokens: Array<HighlightToken> = []
  const pattern =
    /("(?:[^"\\]|\\.)*")(\s*:)?|-?\d+\.?\d*|\b(?:true|false|null)\b/g
  let lastIndex = 0

  for (const match of code.matchAll(pattern)) {
    const index = match.index
    pushHighlightToken(tokens, code.slice(lastIndex, index))

    const [value, stringValue, colon] = match
    if (stringValue) {
      pushHighlightToken(tokens, stringValue, colon ? 'jsonKey' : 'string')
      if (colon) pushHighlightToken(tokens, colon)
    } else if (value === 'true' || value === 'false' || value === 'null') {
      pushHighlightToken(tokens, value, 'keyword')
    } else {
      pushHighlightToken(tokens, value, 'number')
    }

    lastIndex = index + value.length
  }

  pushHighlightToken(tokens, code.slice(lastIndex))
  return tokens
}

function tokenizeCode(code: string): Array<HighlightToken> {
  const tokens: Array<HighlightToken> = []
  const pattern =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(["'`])(?:(?!\1)[^\\]|\\.)*?\1|(?<![a-zA-Z_$])\b\d+\.?\d*\b|\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g
  let lastIndex = 0

  for (const match of code.matchAll(pattern)) {
    const index = match.index
    const value = match[0]
    pushHighlightToken(tokens, code.slice(lastIndex, index))

    if (value.startsWith('//') || value.startsWith('/*')) {
      pushHighlightToken(tokens, value, 'comment')
    } else if (
      value.startsWith('"') ||
      value.startsWith("'") ||
      value.startsWith('`')
    ) {
      pushHighlightToken(tokens, value, 'string')
    } else if (/^-?\d+\.?\d*$/.test(value)) {
      pushHighlightToken(tokens, value, 'number')
    } else if (KEYWORDS.has(value)) {
      pushHighlightToken(tokens, value, 'keyword')
    } else if (/^[A-Z]/.test(value)) {
      pushHighlightToken(tokens, value, 'type')
    } else {
      pushHighlightToken(tokens, value)
    }

    lastIndex = index + value.length
  }

  pushHighlightToken(tokens, code.slice(lastIndex))
  return tokens
}

function highlightCode(code: string, ext: string): Array<ReactNode> {
  const tokens = ext === 'json' ? tokenizeJson(code) : tokenizeCode(code)
  return tokens.map((token, index) => {
    if (token.kind === 'plain') {
      return <Fragment key={index}>{token.text}</Fragment>
    }

    return (
      <span key={index} className={HIGHLIGHT_CLASS_BY_KIND[token.kind]}>
        {token.text}
      </span>
    )
  })
}

function highlightCodeContent(code: string, ext: string): Array<ReactNode> {
  if (ext === 'json') {
    return highlightCode(code, 'json')
  }
  return highlightCode(code, ext)
}

// ──────────────────────────────────────────────────────────────────────────────
// Diff Modal
// ──────────────────────────────────────────────────────────────────────────────

type DiffModalProps = {
  open: boolean
  fileName: string
  original: string
  updated: string
  onSave: () => void
  onCancel: () => void
}

function DiffModal({
  open,
  fileName,
  original,
  updated,
  onSave,
  onCancel,
}: DiffModalProps) {
  const diffLines = useMemo(
    () => (open ? computeDiff(original, updated) : []),
    [open, original, updated],
  )

  const addedCount = diffLines.filter((l) => l.kind === 'added').length
  const removedCount = diffLines.filter((l) => l.kind === 'removed').length

  // Separate left (original) and right (new) columns for split view
  const leftLines = diffLines.filter((l) => l.kind !== 'added')
  const rightLines = diffLines.filter((l) => l.kind !== 'removed')

  if (!open) return null

  return (
    <DialogRoot
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent className="max-w-5xl w-full">
        <div className="flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary-200 dark:border-neutral-800 px-5 py-3">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold text-primary-900 dark:text-neutral-100 truncate">
                Review changes — {fileName}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-primary-500 dark:text-neutral-400">
                <span className="text-emerald-600 font-medium">
                  +{addedCount} added
                </span>
                {' · '}
                <span className="text-red-600 font-medium">
                  −{removedCount} removed
                </span>
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={onSave}>
                Save anyway
              </Button>
            </div>
          </div>

          {/* Split diff view */}
          <div className="flex flex-1 min-h-0 overflow-hidden divide-x divide-primary-200 dark:divide-neutral-800">
            {/* Left — original */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <div className="shrink-0 px-3 py-1.5 text-[11px] font-semibold text-primary-500 dark:text-neutral-400 bg-primary-100/60 dark:bg-neutral-900/60 border-b border-primary-200 dark:border-neutral-800 uppercase tracking-wide">
                Original
              </div>
              <div className="flex-1 overflow-auto">
                <div className="font-mono text-[11px] leading-relaxed">
                  {leftLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex items-start gap-0',
                        line.kind === 'removed'
                          ? 'bg-red-50 dark:bg-red-950/25'
                          : '',
                      )}
                    >
                      <span className="shrink-0 w-10 select-none px-2 text-right text-primary-300 dark:text-neutral-600 text-[10px] leading-relaxed border-r border-primary-200 dark:border-neutral-800">
                        {line.leftNum ?? ''}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 w-5 select-none text-center leading-relaxed',
                          line.kind === 'removed'
                            ? 'text-red-500'
                            : 'text-transparent',
                        )}
                      >
                        {line.kind === 'removed' ? '−' : ' '}
                      </span>
                      <span
                        className={cn(
                          'flex-1 whitespace-pre-wrap break-all px-1',
                          line.kind === 'removed'
                            ? 'text-red-800 dark:text-red-300'
                            : 'text-primary-800 dark:text-neutral-300',
                        )}
                      >
                        {line.text || ' '}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right — new */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <div className="shrink-0 px-3 py-1.5 text-[11px] font-semibold text-primary-500 dark:text-neutral-400 bg-primary-100/60 dark:bg-neutral-900/60 border-b border-primary-200 dark:border-neutral-800 uppercase tracking-wide">
                New
              </div>
              <div className="flex-1 overflow-auto">
                <div className="font-mono text-[11px] leading-relaxed">
                  {rightLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex items-start gap-0',
                        line.kind === 'added'
                          ? 'bg-emerald-50 dark:bg-emerald-950/25'
                          : '',
                      )}
                    >
                      <span className="shrink-0 w-10 select-none px-2 text-right text-primary-300 dark:text-neutral-600 text-[10px] leading-relaxed border-r border-primary-200 dark:border-neutral-800">
                        {line.rightNum ?? ''}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 w-5 select-none text-center leading-relaxed',
                          line.kind === 'added'
                            ? 'text-emerald-600'
                            : 'text-transparent',
                        )}
                      >
                        {line.kind === 'added' ? '+' : ' '}
                      </span>
                      <span
                        className={cn(
                          'flex-1 whitespace-pre-wrap break-all px-1',
                          line.kind === 'added'
                            ? 'text-emerald-800 dark:text-emerald-300'
                            : 'text-primary-800 dark:text-neutral-300',
                        )}
                      >
                        {line.text || ' '}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Directory tree node
// ──────────────────────────────────────────────────────────────────────────────

type TreeNodeProps = {
  entry: FileEntry
  depth: number
  expanded: Set<string>
  forceExpanded?: boolean
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (entry: FileEntry) => void
  onDeleteRequest: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}

function TreeNode({
  entry,
  depth,
  expanded,
  forceExpanded = false,
  selectedPath,
  onToggle,
  onSelect,
  onDeleteRequest,
  onContextMenu,
}: TreeNodeProps) {
  const isExpanded = forceExpanded || expanded.has(entry.path)
  const isSelected = selectedPath === entry.path
  const iconClass = getFileIconClass(entry)
  const paddingLeft = 12 + depth * 16

  const handleClick = () => {
    onSelect(entry)
    if (entry.type === 'folder') {
      onToggle(entry.path)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry)}
        className={cn(
          'files-tree-row',
          entry.type === 'file' ? 'is-leaf' : '',
          isExpanded ? 'is-expanded' : '',
          isSelected ? 'is-active' : '',
        )}
        style={{ paddingLeft }}
      >
        <span className="chev">▶</span>
        <span className={cn('icon', `is-${iconClass}`)} aria-hidden="true" />
        <span className="name">{entry.name}</span>
        {entry.type === 'file' && entry.size !== undefined ? (
          <span className="badge">{formatBytes(entry.size)}</span>
        ) : null}
        <span
          role="button"
          tabIndex={0}
          className="row-delete"
          title={`Delete ${entry.type}`}
          aria-label={`Delete ${entry.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onDeleteRequest(entry)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onDeleteRequest(entry)
          }}
        >
          🗑
        </span>
      </button>

      {entry.type === 'folder' && isExpanded && entry.children ? (
        <div>
          {entry.children
            .filter((c) => !IGNORED_DIRS.has(c.name))
            .map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                expanded={expanded}
                forceExpanded={forceExpanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                onDeleteRequest={onDeleteRequest}
                onContextMenu={onContextMenu}
              />
            ))}
        </div>
      ) : null}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Breadcrumb
// ──────────────────────────────────────────────────────────────────────────────

function Breadcrumb({ path, className }: { path: string; className?: string }) {
  const parts = getPathParts(path)
  return (
    <div className={cn('files-preview-crumbs', className)}>
      <span className="files-seg">workspace</span>
      {parts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          <span className="files-sep">/</span>
          <span
            className={cn('files-seg', i === parts.length - 1 ? 'current' : '')}
          >
            {part}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// File panel — viewer / editor
// All hooks are called unconditionally at the top.
// ──────────────────────────────────────────────────────────────────────────────

type FilePanelProps = {
  selectedEntry: FileEntry | null
  onDeleteRequest: (entry: FileEntry) => void
  onUploadRequest: (targetPath: string) => void
}

function FilePanel({
  selectedEntry,
  onDeleteRequest,
  onUploadRequest,
}: FilePanelProps) {
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [editValue, setEditValue] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [copiedOk, setCopiedOk] = useState(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'raw' | 'metadata'>(
    'preview',
  )
  const [showDiff, setShowDiff] = useState(false)
  const prevPathRef = useRef<string | null>(null)

  const fileName = selectedEntry?.name ?? ''
  const ext = getExt(fileName)
  const isImage = isImageFile(fileName)
  const isMd = isMarkdownFile(fileName)
  const isHtml = isHtmlFile(fileName)
  const isCode = isCodeFile(fileName)
  const isEditable = isEditableFile(fileName)
  const kind = getEntryKind(selectedEntry)

  const highlighted = useMemo<Array<ReactNode>>(
    () => (content ? highlightCodeContent(content, isMd ? 'md' : ext) : []),
    [content, ext, isMd],
  )
  const outline = useMemo(
    () => (isMd && content ? getMarkdownOutline(content) : []),
    [isMd, content],
  )

  const loadFile = useCallback(async (path: string) => {
    setLoadingFile(true)
    setFileError(null)
    setContent('')
    setDataUrl('')
    setDirty(false)
    setActiveTab('preview')
    try {
      const res = await fetch(
        `/api/files?action=read&path=${encodeURIComponent(path)}`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as FileReadResponse
      if (data.type === 'image') {
        setDataUrl(data.content)
      } else {
        setContent(data.content)
        setEditValue(data.content)
      }
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingFile(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedEntry || selectedEntry.type === 'folder') return
    if (prevPathRef.current === selectedEntry.path) return
    prevPathRef.current = selectedEntry.path
    void loadFile(selectedEntry.path)
  }, [selectedEntry, loadFile])

  const commitSave = useCallback(async (path: string, value: string) => {
    setSaving(true)
    setShowDiff(false)
    try {
      // Verify the file hasn't changed on disk since it was loaded
      const liveRes = await fetch(
        `/api/files?action=read&path=${encodeURIComponent(path)}`,
      )
      if (liveRes.ok) {
        const liveData = (await liveRes.json()) as { content?: string }
        if (liveData.content !== undefined && liveData.content !== content) {
          setFileError(
            'File changed on disk since you opened it. Reload to see the latest, then re-apply your edits.',
          )
          setSaving(false)
          return
        }
      }
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'write', path, content: value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setContent(value)
      setDirty(false)
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2000)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [content])

  const handleSave = useCallback(() => {
    if (!selectedEntry || !dirty) return
    if (editValue !== content) {
      setShowDiff(true)
    } else {
      void commitSave(selectedEntry.path, editValue)
    }
  }, [selectedEntry, dirty, editValue, content, commitSave])

  const handleCopyPath = useCallback(async () => {
    if (!selectedEntry) return
    const value = `workspace/${selectedEntry.path}`
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopiedOk(true)
    setTimeout(() => setCopiedOk(false), 1400)
  }, [selectedEntry])

  const handleOpenPreview = useCallback(() => {
    if (!selectedEntry || selectedEntry.type !== 'file') return

    let blob: Blob
    if (isImage && dataUrl) {
      window.open(dataUrl, '_blank', 'noopener,noreferrer')
      return
    }
    if (isHtml) {
      blob = new Blob([buildHtmlPreviewDocument(content)], {
        type: 'text/html',
      })
    } else {
      blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    }

    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }, [content, dataUrl, isHtml, isImage, selectedEntry])

  const diffModal = (
    <DiffModal
      open={showDiff}
      fileName={selectedEntry?.name ?? ''}
      original={content}
      updated={editValue}
      onSave={() => {
        if (selectedEntry) void commitSave(selectedEntry.path, editValue)
      }}
      onCancel={() => setShowDiff(false)}
    />
  )

  const renderEmpty = (glyph: string, copy: string, subcopy?: string) => (
    <div className="files-empty-state">
      <div>
        <div className="files-empty-glyph">{glyph}</div>
        <div className="files-empty-copy">{copy}</div>
        {subcopy ? <div className="files-empty-subcopy">{subcopy}</div> : null}
      </div>
    </div>
  )

  const renderCode = (nodes: Array<ReactNode> | string) => {
    const source = typeof nodes === 'string' ? nodes : content
    const lines = source.split('\n')
    if (typeof nodes === 'string') {
      return (
        <div className="files-code-shell">
          <div className="files-code-grid">
            {lines.map((line, index) => (
              <Fragment key={index}>
                <span className="files-code-line-num">{index + 1}</span>
                <span className="files-code-line">{line || ' '}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="files-code-shell">
        <div className="files-code-grid">
          <span className="files-code-line-num">
            {lines.map((_, index) => (
              <Fragment key={index}>{index + 1}\n</Fragment>
            ))}
          </span>
          <pre className="files-code-line">
            <code>{nodes}</code>
          </pre>
        </div>
      </div>
    )
  }

  const renderMetadata = () => {
    const metaRows = [
      ['Path', selectedEntry?.path || 'workspace'],
      ['Kind', kind],
      [
        'Size',
        selectedEntry?.size !== undefined
          ? formatBytes(selectedEntry.size)
          : 'unknown',
      ],
      [
        'Modified',
        selectedEntry?.modifiedAt
          ? formatDate(selectedEntry.modifiedAt)
          : 'unknown',
      ],
      [
        'Editable',
        selectedEntry && selectedEntry.type === 'file'
          ? isEditable
            ? 'yes'
            : 'no'
          : 'n/a',
      ],
      [
        'Encoding',
        selectedEntry && selectedEntry.type === 'file' && !isImage
          ? 'text / utf-8 assumed'
          : 'unknown',
      ],
    ]
    return (
      <div className="files-meta-shell">
        <table>
          <tbody>
            {metaRows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderEditor = () => (
    <textarea
      className="files-textarea"
      value={editValue}
      onChange={(e) => {
        setEditValue(e.target.value)
        setDirty(e.target.value !== content)
      }}
      spellCheck={false}
    />
  )

  const renderCanvas = () => {
    if (!selectedEntry) {
      return renderEmpty(
        '📂',
        'Select a file to preview or edit',
        'Tree actions remain available on the left.',
      )
    }
    if (selectedEntry.type === 'folder') {
      return renderEmpty(
        '📁',
        selectedEntry.name,
        'Select a file inside this folder to preview it.',
      )
    }
    if (loadingFile) return renderEmpty('…', 'Loading file…')
    if (fileError) return renderEmpty('⚠', fileError)
    if (activeTab === 'metadata') return renderMetadata()
    if (activeTab === 'raw') {
      if (isImage)
        return renderEmpty(
          '🖼',
          'Raw binary preview is not available',
          'Use the Preview tab for images.',
        )
      return isEditable ? renderEditor() : renderCode(content)
    }
    if (isImage) {
      return dataUrl ? (
        <div className="files-image-shell">
          <img src={dataUrl} alt={selectedEntry.name} />
        </div>
      ) : (
        renderEmpty('🖼', 'No preview')
      )
    }
    if (isMd) {
      return (
        <div
          className={cn(
            'files-canvas-scroll',
            outline.length > 0 ? 'has-outline' : '',
          )}
        >
          <div className="files-render-wrap">
            <div className="files-doc-shell markdown-preview">
              <Markdown className="gap-3">{content}</Markdown>
            </div>
          </div>
          {outline.length > 0 ? (
            <aside className="files-outline" aria-label="Markdown outline">
              <h5>Outline</h5>
              {outline.map((heading) => (
                <a
                  key={heading.id}
                  className={heading.level === 3 ? 'is-h3' : ''}
                  href={`#${heading.id}`}
                >
                  {heading.text}
                </a>
              ))}
            </aside>
          ) : null}
        </div>
      )
    }
    if (isHtml) {
      return (
        <div className="files-html-shell">
          <iframe
            title={`${selectedEntry.name} preview`}
            sandbox=""
            srcDoc={buildHtmlPreviewDocument(content)}
          />
        </div>
      )
    }
    if (isCode) return renderCode(highlighted)
    return isEditable
      ? renderEditor()
      : renderEmpty(
          '⌧',
          'Preview not available',
          'Switch to metadata for file details.',
        )
  }

  return (
    <>
      {diffModal}
      <section className="files-preview" aria-label="File preview">
        <div className="files-preview-top">
          <Breadcrumb path={selectedEntry?.path ?? ''} />
          <span className="files-preview-kind">{kind}</span>
          <div className="files-preview-actions">
            {selectedEntry?.type === 'file' ? (
              <button
                type="button"
                className="files-icon-btn"
                onClick={() => void handleCopyPath()}
                title="Copy path"
              >
                {copiedOk ? '✓' : '⧉'}
              </button>
            ) : null}
            {isEditable && selectedEntry?.type === 'file' ? (
              <button
                type="button"
                className={cn(
                  'files-icon-btn',
                  activeTab === 'raw' ? 'is-active' : '',
                )}
                onClick={() => setActiveTab('raw')}
                title="Edit source"
              >
                ✎
              </button>
            ) : null}
            {selectedEntry?.type === 'file' ? (
              <button
                type="button"
                className="files-icon-btn"
                onClick={handleOpenPreview}
                title="Open preview in new tab"
              >
                ↗
              </button>
            ) : null}
            {selectedEntry?.type === 'file' ? (
              <a
                className="files-icon-btn"
                href={`/api/files?action=download&path=${encodeURIComponent(selectedEntry.path)}`}
                title="Download"
              >
                ⇩
              </a>
            ) : null}
            {selectedEntry ? (
              <button
                type="button"
                className="files-icon-btn danger"
                onClick={() => onDeleteRequest(selectedEntry)}
                title={`Delete ${selectedEntry.type}`}
              >
                🗑
              </button>
            ) : null}
            {isEditable && selectedEntry?.type === 'file' ? (
              <button
                type="button"
                className="files-icon-btn"
                disabled={!dirty || saving}
                onClick={handleSave}
                title="Save changes"
              >
                {saving ? '…' : savedOk ? '✓' : '💾'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="files-preview-meta">
          <span className="kv">
            size{' '}
            <b>
              {selectedEntry?.size !== undefined
                ? formatBytes(selectedEntry.size)
                : 'unknown'}
            </b>
          </span>
          <span className="dot" />
          <span className="kv">
            modified{' '}
            <b>
              {selectedEntry?.modifiedAt
                ? formatDate(selectedEntry.modifiedAt)
                : 'unknown'}
            </b>
          </span>
          <span className="dot" />
          <span className="kv">
            mode <b>{dirty ? 'dirty' : loadingFile ? 'loading' : 'ready'}</b>
          </span>
          {dirty ? (
            <span className="kv">
              <b>unsaved changes</b>
            </span>
          ) : null}
        </div>

        <div className="files-preview-tabs">
          {(['preview', 'raw', 'metadata'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={cn('files-tab', activeTab === tab ? 'is-active' : '')}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
          <div className="files-tab-actions">
            <button
              type="button"
              className="files-tab"
              onClick={() =>
                onUploadRequest(
                  selectedEntry?.type === 'folder'
                    ? selectedEntry.path
                    : selectedEntry?.path
                      ? getParentPath(selectedEntry.path)
                      : '',
                )
              }
            >
              upload
            </button>
          </div>
        </div>

        <div className="files-preview-canvas">{renderCanvas()}</div>

        <div className="files-preview-foot">
          <span>
            tab <b>{activeTab}</b>
          </span>
          <span className="files-divider" />
          <span>{selectedEntry?.path ?? 'workspace root'}</span>
          {dirty ? (
            <>
              <span className="files-divider" />
              <span>save opens diff confirm</span>
            </>
          ) : null}
        </div>
      </section>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main FilesScreen
// ──────────────────────────────────────────────────────────────────────────────

export function FilesScreen() {
  usePageTitle('Files')

  const [entries, setEntries] = useState<Array<FileEntry>>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [treeQuery, setTreeQuery] = useState('')
  const uploadTargetRef = useRef('')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  // CRUD state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<FileEntry | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    setTreeError(null)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch('/api/files?action=list&maxDepth=3', {
        signal: controller.signal,
      })
      if (!res.ok)
        throw new Error(
          `HTTP ${res.status} — check that HERMES_WORKSPACE_DIR is set`,
        )
      const data = (await res.json()) as FilesListResponse
      setEntries(Array.isArray(data.entries) ? data.entries : [])
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setTreeError(
          'Could not load files — request timed out. Check that HERMES_WORKSPACE_DIR is set.',
        )
      } else {
        setTreeError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      clearTimeout(timeoutId)
      setTreeLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  // Close context menu on outside click / escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu', handleClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleSelect = useCallback((entry: FileEntry) => {
    setSelectedEntry(entry)
  }, [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, entry })
    },
    [],
  )

  // ── CRUD actions ────────────────────────────────────────────────────────────

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteConfirm) return
    setDeleteError(null)
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path: deleteConfirm.path }),
      })
      if (!res.ok) {
        const err = await res.text().catch(() => '')
        setDeleteError(err || `HTTP ${res.status}`)
        return
      }
      if (selectedEntry?.path === deleteConfirm.path) {
        setSelectedEntry(null)
      }
      setDeleteConfirm(null)
      await loadTree()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    }
  }, [deleteConfirm, selectedEntry, loadTree])

  const handleDownload = useCallback(async (entry: FileEntry) => {
    const res = await fetch(
      `/api/files?action=download&path=${encodeURIComponent(entry.path)}`,
    )
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = entry.name
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])

  const openRenamePrompt = useCallback((entry: FileEntry) => {
    setPromptState({
      mode: 'rename',
      targetPath: entry.path,
      defaultValue: entry.name,
    })
    setPromptValue(entry.name)
  }, [])

  const openNewFolderPrompt = useCallback(() => {
    setPromptState({ mode: 'new-folder', targetPath: '' })
    setPromptValue('')
  }, [])

  const openUploadPicker = useCallback((targetPath: string) => {
    uploadTargetRef.current = targetPath
    uploadInputRef.current?.click()
  }, [])

  const handleUploadChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      if (files.length === 0) return

      for (const file of files) {
        const form = new FormData()
        form.append('action', 'upload')
        form.append('path', uploadTargetRef.current)
        form.append('file', file)
        const res = await fetch('/api/files', { method: 'POST', body: form })
        if (!res.ok) {
          throw new Error(`Upload failed: HTTP ${res.status}`)
        }
      }

      event.target.value = ''
      await loadTree()
    },
    [loadTree],
  )

  const handlePromptSubmit = useCallback(async () => {
    if (!promptState) return
    const value = promptValue.trim()
    if (!value) return

    if (promptState.mode === 'rename') {
      const parent = getParentPath(promptState.targetPath)
      const nextPath = parent ? `${parent}/${value}` : value
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'rename',
          from: promptState.targetPath,
          to: nextPath,
        }),
      })
    } else {
      // new-folder
      const nextPath = promptState.targetPath
        ? `${promptState.targetPath}/${value}`
        : value
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'mkdir', path: nextPath }),
      })
    }

    setPromptState(null)
    setPromptValue('')
    await loadTree()
  }, [promptState, promptValue, loadTree])

  const selectedPath = selectedEntry?.path ?? null
  const visibleEntries = useMemo(() => {
    const query = treeQuery.trim().toLowerCase()

    const filterItems = (items: Array<FileEntry>): Array<FileEntry> =>
      items
        .filter((entry) => !IGNORED_DIRS.has(entry.name))
        .map((entry) => {
          if (!query) return entry

          const children = entry.children
            ? filterItems(entry.children)
            : undefined
          if (
            entry.name.toLowerCase().includes(query) ||
            (children && children.length > 0)
          ) {
            return { ...entry, children }
          }

          return null
        })
        .filter((entry): entry is FileEntry => Boolean(entry))

    return filterItems(entries)
  }, [entries, treeQuery])
  const entryCounts = useMemo(() => countEntries(entries), [entries])

  return (
    <div
      data-screen="files"
      className={cn('files-shell', treeCollapsed ? 'tree-collapsed' : '')}
    >
      <aside className={cn('files-tree', treeCollapsed ? 'is-collapsed' : '')}>
        {treeCollapsed ? (
          <>
            <div className="files-tree-head">
              <button
                type="button"
                className="files-icon-btn"
                onClick={() => setTreeCollapsed(false)}
                title="Expand tree"
              >
                ⇥
              </button>
            </div>
            <div className="files-tree-rail">
              <span className="count">{entryCounts.files}</span>
              <span className="label">files</span>
            </div>
            <div className="files-tree-foot">{entryCounts.folders} dirs</div>
          </>
        ) : (
          <>
            <div className="files-tree-head">
              <div className="min-w-0">
                <h3>Files</h3>
                <div className="files-tree-count">
                  {entryCounts.files} files · {entryCounts.folders} dirs
                </div>
              </div>
              <div className="files-tree-actions">
                <button
                  type="button"
                  className="files-icon-btn"
                  onClick={() => openUploadPicker('')}
                  title="Upload to workspace"
                >
                  ⤴
                </button>
                <button
                  type="button"
                  className="files-icon-btn"
                  onClick={openNewFolderPrompt}
                  title="New folder"
                >
                  ＋
                </button>
                <button
                  type="button"
                  className="files-icon-btn"
                  onClick={() => void loadTree()}
                  title="Refresh"
                >
                  ↺
                </button>
                <button
                  type="button"
                  className="files-icon-btn"
                  onClick={() => setTreeCollapsed(true)}
                  title="Collapse tree"
                >
                  ⇤
                </button>
              </div>
            </div>

            <div className="files-tree-search">
              <label className="files-search-shell">
                <span aria-hidden="true">⌕</span>
                <input
                  value={treeQuery}
                  onChange={(e) => setTreeQuery(e.target.value)}
                  placeholder="Search workspace"
                />
              </label>
            </div>

            <Breadcrumb
              path={selectedEntry?.path ?? ''}
              className="files-tree-breadcrumb"
            />

            <div className="files-tree-body">
              {treeLoading ? (
                <div className="files-tree-loading">Loading…</div>
              ) : treeError ? (
                <div className="files-tree-error">{treeError}</div>
              ) : visibleEntries.length === 0 ? (
                <div className="files-tree-empty">
                  {treeQuery ? 'No matches' : 'Workspace is empty'}
                </div>
              ) : (
                visibleEntries.map((entry) => (
                  <TreeNode
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    expanded={expanded}
                    forceExpanded={Boolean(treeQuery.trim())}
                    selectedPath={selectedPath}
                    onToggle={handleToggle}
                    onSelect={handleSelect}
                    onDeleteRequest={setDeleteConfirm}
                    onContextMenu={handleContextMenu}
                  />
                ))
              )}
            </div>

            <div className="files-tree-foot">
              <span>
                <b>{entryCounts.files}</b> files
              </span>
              <span>
                <b>{entryCounts.folders}</b> folders
              </span>
              {treeQuery ? <span>filter active</span> : null}
            </div>
          </>
        )}
      </aside>

      <main className="files-preview-host">
        <FilePanel
          selectedEntry={selectedEntry}
          onDeleteRequest={setDeleteConfirm}
          onUploadRequest={openUploadPicker}
        />
      </main>

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleUploadChange(event)
        }}
      />

      {/* ── Context menu ──────────────────────────────────────────────────── */}
      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg bg-primary-50 dark:bg-neutral-900 p-1 text-sm text-primary-900 dark:text-neutral-100 shadow-lg outline outline-primary-900/10 dark:outline-neutral-700"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-primary-100 dark:hover:bg-neutral-800"
            onClick={() => {
              openRenamePrompt(contextMenu.entry)
              setContextMenu(null)
            }}
          >
            ✏️ Rename
          </button>
          {contextMenu.entry.type === 'folder' ? (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-primary-100 dark:hover:bg-neutral-800"
              onClick={() => {
                setPromptState({
                  mode: 'new-folder',
                  targetPath: contextMenu.entry.path,
                })
                setPromptValue('')
                setContextMenu(null)
              }}
            >
              📁 New folder inside
            </button>
          ) : (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-primary-100 dark:hover:bg-neutral-800"
              onClick={() => {
                void handleDownload(contextMenu.entry)
                setContextMenu(null)
              }}
            >
              ⬇️ Download
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => {
              setDeleteConfirm(contextMenu.entry)
              setContextMenu(null)
            }}
          >
            🗑️ Delete
          </button>
        </div>
      ) : null}

      {/* ── Rename / New-folder prompt dialog ─────────────────────────────── */}
      <DialogRoot
        open={Boolean(promptState)}
        onOpenChange={(open) => {
          if (!open) setPromptState(null)
        }}
      >
        <DialogContent>
          <div className="p-5 space-y-3">
            <DialogTitle>
              {promptState?.mode === 'rename' ? 'Rename' : 'New Folder'}
            </DialogTitle>
            <DialogDescription>
              {promptState?.mode === 'rename'
                ? 'Enter a new name.'
                : 'Enter a folder name to create.'}
            </DialogDescription>
            <input
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing)
                  void handlePromptSubmit()
              }}
              className="w-full rounded-md border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-300"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button onClick={() => void handlePromptSubmit()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>

      {/* ── Delete confirm dialog ──────────────────────────────────────────── */}
      <DialogRoot
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => {
          if (!open) { setDeleteConfirm(null); setDeleteError(null) }
        }}
      >
        <DialogContent>
          <div className="p-5 space-y-3">
            <DialogTitle>
              Delete {deleteConfirm?.type === 'folder' ? 'Folder' : 'File'}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <strong>{deleteConfirm?.name}</strong>?
              {deleteConfirm?.type === 'folder' &&
                ' This will delete all contents inside.'}{' '}
              This action cannot be undone.
            </DialogDescription>
            {deleteError && (
              <p className="text-sm text-destructive">{deleteError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button
                variant="destructive"
                onClick={() => void handleDeleteConfirmed()}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  )
}
