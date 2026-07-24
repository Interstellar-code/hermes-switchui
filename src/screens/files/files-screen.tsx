import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useSearch } from '@tanstack/react-router'
import { FileTree, IGNORED_DIRS } from './file-tree'
import { FolderListing } from './folder-listing'
import {
  FIcon,
  KIND_COLOR,
  KIND_LABEL,
  SvgIco,
  fileKindKey,
} from './files-icons'
import { fuzzy } from './files-search'
import { FilesPalette } from './files-palette'
import { FilesTweaks } from './files-tweaks'
import type { FileEntry } from './file-tree'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/hooks/use-page-title'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Markdown } from '@/components/prompt-kit/markdown'
import '@/styles/matrix-files.css'
import { formatBytes, formatDate } from '@/lib/format'
import { getExt, getParentPath } from '@/lib/path-utils'
import { writeTextToClipboard } from '@/lib/clipboard'
import { clampContextMenuPosition } from '@/lib/context-menu'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

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
  mode: 'rename' | 'move' | 'new-file' | 'new-folder'
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

function isPdfFile(name: string): boolean {
  return getExt(name) === 'pdf'
}

// Binary formats with no inline preview — never fetch or render their bytes.
const BINARY_EXTS = new Set([
  'xlsx',
  'xls',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'zip',
  'tar',
  'gz',
  'bin',
  'exe',
  'dmg',
  'wasm',
  'db',
  'sqlite',
  'sqlite3',
])

function isBinaryFile(name: string): boolean {
  return BINARY_EXTS.has(getExt(name))
}

function isEditableFile(name: string): boolean {
  return !isImageFile(name) && !isPdfFile(name) && !isBinaryFile(name)
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

// SECURITY: The PRIMARY XSS control for HTML previews is the sandboxed iframe
// rendered below (sandbox="" with NO allow-scripts and NO allow-same-origin).
// That combination makes the iframe a fully isolated origin with no script
// execution, no storage access, and no parent-frame communication — regardless
// of what HTML content ends up inside it.
//
// The regex strip below is COSMETIC defense-in-depth only. It removes obvious
// <script> blocks so they do not clutter the visual preview, but it MUST NOT
// be treated as a security boundary:
//   - It does not remove inline event handlers (onerror=, onload=, etc.)
//   - It does not remove javascript: URIs in href/src attributes
//   - It can be bypassed with malformed/nested tag patterns
//
// DO NOT ADD allow-scripts or allow-same-origin to the sandbox attribute.
// Those two tokens together would defeat the isolation and enable stored XSS.
// If interactive preview (e.g. running scripts) is ever needed, that is a
// design decision requiring a full sanitizer or a separate sandboxed origin —
// do not relax the sandbox attribute as a quick fix.
//
// Residual: <base target="_blank"> is inert here because allow-popups is not
// granted; opened links are silently blocked by the sandbox.
function buildHtmlPreviewDocument(source: string): string {
  // Cosmetic only — strips obvious <script> blocks from the rendered view.
  // The sandbox="" iframe attribute is the actual security control (see above).
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
    <Dialog
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
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Breadcrumb
// ──────────────────────────────────────────────────────────────────────────────

function Breadcrumb({
  path,
  className,
  onNavigate,
}: {
  path: string
  className?: string
  onNavigate: (path: string) => void
}) {
  const parts = getPathParts(path)
  return (
    <nav
      className={cn('files-preview-crumbs', className)}
      aria-label="Breadcrumb"
    >
      <button
        type="button"
        className={cn('files-seg', parts.length === 0 ? 'current' : '')}
        aria-current={parts.length === 0 ? 'location' : undefined}
        onClick={() => onNavigate('')}
      >
        workspace
      </button>
      {parts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          <span className="files-sep">/</span>
          <button
            type="button"
            className={cn('files-seg', i === parts.length - 1 ? 'current' : '')}
            aria-current={i === parts.length - 1 ? 'location' : undefined}
            onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}
          >
            {part}
          </button>
        </Fragment>
      ))}
    </nav>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// File panel — viewer / editor
// All hooks are called unconditionally at the top.
// ──────────────────────────────────────────────────────────────────────────────

type FilePanelProps = {
  workspacePath?: string
  selectedEntry: FileEntry | null
  onNavigate: (path: string) => void
  isPinned: boolean
  onTogglePin: (path: string) => void
  onDeleteRequest: (entry: FileEntry) => void
  onUploadRequest: (targetPath: string) => void
}

function FilePanel({
  workspacePath,
  selectedEntry,
  onNavigate,
  isPinned,
  onTogglePin,
  onDeleteRequest,
  onUploadRequest,
}: FilePanelProps) {
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [editValue, setEditValue] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [copiedOk, setCopiedOk] = useState(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'raw' | 'metadata'>(
    'preview',
  )
  const [showDiff, setShowDiff] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [activeHeading, setActiveHeading] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const prevPathRef = useRef<string | null>(null)

  const fileName = selectedEntry?.name ?? ''
  const ext = getExt(fileName)
  const isImage = isImageFile(fileName)
  const isMd = isMarkdownFile(fileName)
  const isHtml = isHtmlFile(fileName)
  const isPdf = isPdfFile(fileName)
  const isBinary = isBinaryFile(fileName)
  const isCode = isCodeFile(fileName)
  const isEditable = isEditableFile(fileName)
  const kind = getEntryKind(selectedEntry)
  const kindKey = selectedEntry?.type === 'file' ? fileKindKey(fileName) : null

  // Overflow (⋮) actions menu — closes on outside click / Esc, mirroring the
  // tree sort menu pattern.
  useEffect(() => {
    if (!actionsMenuOpen) return
    const handleClick = () => setActionsMenuOpen(false)
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActionsMenuOpen(false)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [actionsMenuOpen])

  const highlighted = useMemo<Array<ReactNode>>(
    () => (content ? highlightCodeContent(content, isMd ? 'md' : ext) : []),
    [content, ext, isMd],
  )
  const outline = useMemo(
    () => (isMd && content ? getMarkdownOutline(content) : []),
    [isMd, content],
  )

  // Scrollspy: ensure rendered headings carry slug ids matching the outline
  // (so anchor jumps work), then highlight whichever heading sits under the
  // top of the viewport as the user scrolls.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || activeTab !== 'preview' || !isMd || outline.length === 0) {
      setActiveHeading(null)
      return
    }
    for (const h of el.querySelectorAll('h2, h3')) {
      if (!h.id) {
        h.id = (h.textContent || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      }
    }
    const onScroll = () => {
      let current = outline[0]?.id ?? null
      for (const heading of outline) {
        const node = el.querySelector(`#${CSS.escape(heading.id)}`)
        if (node && node.getBoundingClientRect().top < 130) current = heading.id
      }
      setActiveHeading(current)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [activeTab, isMd, outline, content])

  const loadFile = useCallback(async (path: string) => {
    setLoadingFile(true)
    setFileError(null)
    setContent('')
    setDataUrl('')
    setPdfUrl('')
    setDirty(false)
    setActiveTab('preview')
    try {
      if (isBinaryFile(path)) {
        // No inline preview for these formats — don't pull the bytes at all.
        return
      }
      if (isPdfFile(path)) {
        // The text `read` endpoint mangles PDF bytes; fetch the raw bytes and
        // let the browser's native PDF viewer render a blob: URL instead.
        const res = await fetch(
          `/api/files?action=download&path=${encodeURIComponent(path)}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        setPdfUrl(URL.createObjectURL(blob))
        return
      }
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

  // Revoke stale PDF object URLs on change/unmount so blobs don't leak.
  useEffect(() => {
    if (!pdfUrl) return
    return () => URL.revokeObjectURL(pdfUrl)
  }, [pdfUrl])

  const commitSave = useCallback(
    async (path: string, value: string) => {
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
    },
    [content],
  )

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
    try {
      await writeTextToClipboard(`workspace/${selectedEntry.path}`)
      setCopiedOk(true)
      setTimeout(() => setCopiedOk(false), 1400)
    } catch (err) {
      setFileError(
        err instanceof Error ? err.message : 'Could not copy the file path.',
      )
    }
  }, [selectedEntry])

  const handleOpenPreview = useCallback(() => {
    if (!selectedEntry || selectedEntry.type !== 'file') return

    let blob: Blob
    if (isImage && dataUrl) {
      window.open(dataUrl, '_blank', 'noopener,noreferrer')
      return
    }
    if (isPdf) {
      if (pdfUrl) window.open(pdfUrl, '_blank', 'noopener,noreferrer')
      return
    }
    // Binary formats have no fetched content — nothing sensible to open.
    if (isBinary) return
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
  }, [
    content,
    dataUrl,
    isBinary,
    isHtml,
    isImage,
    isPdf,
    pdfUrl,
    selectedEntry,
  ])

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
        selectedEntry &&
        selectedEntry.type === 'file' &&
        !isImage &&
        !isPdf &&
        !isBinary
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
      if (isPdf)
        return renderEmpty(
          '📄',
          'Raw binary preview is not available',
          'Use the Preview tab for PDFs.',
        )
      if (isBinary)
        return renderEmpty(
          '📦',
          'Raw binary preview is not available',
          'Use Download to open it in its app.',
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
    if (isPdf) {
      return pdfUrl ? (
        <div className="files-html-shell">
          {/* blob: URL of same-origin bytes rendered by the browser's native
              PDF viewer — no sandbox tokens needed or added. */}
          <iframe
            title={`${selectedEntry.name} preview`}
            className="files-pdf-frame"
            src={pdfUrl}
          />
        </div>
      ) : (
        renderEmpty('📄', 'No preview')
      )
    }
    if (isBinary) {
      return renderEmpty(
        '📦',
        'No preview for this file type',
        'Download to open it in its app.',
      )
    }
    if (isMd) {
      return (
        <div
          ref={scrollerRef}
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
              <h5>On this page</h5>
              {outline.map((heading) => (
                <a
                  key={heading.id}
                  className={cn(
                    heading.level === 3 ? 'is-h3' : '',
                    activeHeading === heading.id ? 'is-active' : '',
                  )}
                  aria-current={
                    activeHeading === heading.id ? 'location' : undefined
                  }
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
          {/* sandbox="" (no tokens) = fully isolated origin: no scripts, no
              storage, no parent-frame access. NEVER add allow-scripts or
              allow-same-origin here — see buildHtmlPreviewDocument for detail. */}
          <iframe
            title={`${selectedEntry.name} preview`}
            sandbox=""
            referrerPolicy="no-referrer"
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
          <Breadcrumb
            path={selectedEntry?.path ?? ''}
            onNavigate={onNavigate}
          />
          <div className="files-preview-actions">
            {kindKey ? (
              <span
                className="files-kind-badge"
                style={{ color: KIND_COLOR[kindKey] }}
                title={kind}
              >
                {KIND_LABEL[kindKey] ?? kind}
              </span>
            ) : null}
            {selectedEntry?.type === 'file' ? (
              <button
                type="button"
                className={cn('files-icon-btn', isPinned ? 'is-pinned' : '')}
                onClick={() => onTogglePin(selectedEntry.path)}
                title={isPinned ? 'Unpin file' : 'Pin file'}
                aria-pressed={isPinned}
              >
                <SvgIco name="star" size={14} />
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
            {selectedEntry?.type === 'file' ? (
              <button
                type="button"
                className="files-open-btn"
                onClick={handleOpenPreview}
                title="Open preview in new tab"
              >
                <SvgIco name="ext" size={13} />
                Open
              </button>
            ) : null}
            {selectedEntry?.type === 'file' ? (
              <a
                className="files-open-btn is-ghost"
                href={`/api/files?action=download&path=${encodeURIComponent(selectedEntry.path)}`}
                title="Download"
              >
                <SvgIco name="dl" size={13} />
                Download
              </a>
            ) : null}
            {selectedEntry ? (
              <div className="files-sort-wrap">
                <button
                  type="button"
                  className={cn(
                    'files-icon-btn',
                    actionsMenuOpen ? 'is-open' : '',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    setActionsMenuOpen((v) => !v)
                  }}
                  title="More actions"
                  aria-haspopup="menu"
                  aria-expanded={actionsMenuOpen}
                >
                  <SvgIco name="dots" size={14} />
                </button>
                {actionsMenuOpen ? (
                  <div
                    className="files-preview-menu"
                    role="menu"
                    aria-label="File actions"
                  >
                    {isEditable && selectedEntry.type === 'file' ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setActiveTab('raw')}
                      >
                        <SvgIco name="edit" size={13} />
                        Edit source
                      </button>
                    ) : null}
                    {selectedEntry.type === 'file' ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          // Keep the menu open so the ✓ feedback is visible.
                          e.stopPropagation()
                          void handleCopyPath()
                        }}
                      >
                        <SvgIco name="copy" size={13} />
                        {copiedOk ? 'Copied ✓' : 'Copy path'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => onDeleteRequest(selectedEntry)}
                    >
                      <SvgIco name="trash" size={13} />
                      {`Delete ${selectedEntry.type}`}
                    </button>
                  </div>
                ) : null}
              </div>
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
            kind <b>{kind}</b>
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
          <span>
            viewing <b>{selectedEntry?.path ?? 'workspace root'}</b>
          </span>
          {workspacePath ? (
            <>
              <span className="files-divider" />
              <span>
                workspace{' '}
                <b>{workspacePath.replace(/^\/(?:Users|home)\/[^/]+/, '~')}</b>
              </span>
            </>
          ) : null}
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

// ──────────────────────────────────────────────────────────────────────────────
// Workspace catalog type (mirrors WorkspaceDetectionResponse from api/workspace)
// ──────────────────────────────────────────────────────────────────────────────

type WorkspaceCatalog = {
  path: string
  folderName: string
  source: string
  isValid: boolean
  workspaces: Array<{ path: string; name?: string }>
  last: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Quick Access — Pinned / Recents collapsible groups in the tree sidebar
// ──────────────────────────────────────────────────────────────────────────────

type QuickAccessGroupProps = {
  variant: 'pinned' | 'recent'
  files: Array<FileEntry>
  open: boolean
  onToggleOpen: () => void
  activePath: string | null
  onPick: (file: FileEntry) => void
  onTogglePin: (path: string) => void
}

function QuickAccessGroup({
  variant,
  files,
  open,
  onToggleOpen,
  activePath,
  onPick,
  onTogglePin,
}: QuickAccessGroupProps) {
  if (files.length === 0) return null
  const isPinnedGroup = variant === 'pinned'
  return (
    <div className="qa">
      <button
        type="button"
        className={cn('qa-h', open ? '' : 'closed')}
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <span className="chev2">
          <SvgIco name="chevDown" size={13} />
        </span>
        <SvgIco name={isPinnedGroup ? 'star' : 'clock'} size={13} />
        <span className="qa-label">{isPinnedGroup ? 'Pinned' : 'Recent'}</span>
        <span className="cnt">{files.length}</span>
      </button>
      {open
        ? files.map((file) => {
            const kind = fileKindKey(file.name)
            return (
              <div
                key={file.path}
                className={cn('qa-row', file.path === activePath ? 'on' : '')}
                onClick={() => onPick(file)}
              >
                <span className="ic" style={{ color: KIND_COLOR[kind] }}>
                  <FIcon file={file} size={14} />
                </span>
                <span className="nm">{file.name}</span>
                <span className="pk" style={{ color: KIND_COLOR[kind] }}>
                  {KIND_LABEL[kind]}
                </span>
                <button
                  type="button"
                  className={cn(
                    'files-icon-btn qa-star',
                    isPinnedGroup ? 'is-pinned' : '',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePin(file.path)
                  }}
                  title={isPinnedGroup ? 'Unpin file' : 'Pin file'}
                >
                  <SvgIco name="star" size={12} />
                </button>
              </div>
            )
          })
        : null}
    </div>
  )
}

type FilesTweaksState = {
  accent: string
  density: string
  labels: string
  showQA: boolean
}

const FILES_TWEAKS_DEFAULTS: FilesTweaksState = {
  accent: '#00ff41',
  density: '7px',
  labels: 'on',
  showQA: true,
}

function loadFilesTweaks(): FilesTweaksState {
  if (typeof window === 'undefined') return FILES_TWEAKS_DEFAULTS
  try {
    const raw = window.localStorage.getItem('files.tweaks')
    return raw
      ? {
          ...FILES_TWEAKS_DEFAULTS,
          ...(JSON.parse(raw) as Partial<FilesTweaksState>),
        }
      : FILES_TWEAKS_DEFAULTS
  } catch {
    return FILES_TWEAKS_DEFAULTS
  }
}

export function FilesScreen() {
  usePageTitle('Files')
  const search = useSearch({ from: '/files' })

  const [entries, setEntries] = useState<Array<FileEntry>>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)

  // Workspace catalog — used to detect fresh-install / no-valid-workspace state
  const [workspaceCatalog, setWorkspaceCatalog] =
    useState<WorkspaceCatalog | null>(null)
  const [pickerPath, setPickerPath] = useState('')
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerSaving, setPickerSaving] = useState(false)

  const loadWorkspaceCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace')
      if (!res.ok) return
      const data = (await res.json()) as WorkspaceCatalog
      setWorkspaceCatalog(data)
    } catch {
      // non-fatal — picker just won't show
    }
  }, [])

  useEffect(() => {
    void loadWorkspaceCatalog()
  }, [loadWorkspaceCatalog])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null)
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const [treeQuery, setTreeQuery] = useState('')
  const [debouncedTreeQuery, setDebouncedTreeQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [treeSort, setTreeSort] = useState<'name' | 'modified' | 'type'>('name')
  const uploadTargetRef = useRef('')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  // ── Quick Access + command palette (Files v2 Phase 3/4) ─────────────────────
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [pinned, setPinned] = useState<Set<string>>(() => new Set())
  const [recentPaths, setRecentPaths] = useState<Array<string>>([])
  const [qaPinnedOpen, setQaPinnedOpen] = useState(true)
  const [qaRecentOpen, setQaRecentOpen] = useState(true)

  // ── Tweaks panel (Files v2 Phase 6) ──────────────────────────────────────
  const [tweaksOpen, setTweaksOpen] = useState(false)
  const [accent, setAccent] = useState(() => loadFilesTweaks().accent)
  const [density, setDensity] = useState(() => loadFilesTweaks().density)
  const [labels, setLabels] = useState(() => loadFilesTweaks().labels)
  const [showQA, setShowQA] = useState(() => loadFilesTweaks().showQA)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        'files.tweaks',
        JSON.stringify({ accent, density, labels, showQA }),
      )
    } catch {
      // ponytail: best-effort persistence, ignore quota/private-mode failures
    }
  }, [accent, density, labels, showQA])

  const workspacePath = workspaceCatalog?.path ?? ''
  const pinsKey = workspacePath ? `files.pins.${workspacePath}` : ''
  const recentsKey = workspacePath ? `files.recents.${workspacePath}` : ''

  // Load persisted pins/recents when the workspace root is known/changes.
  useEffect(() => {
    if (typeof window === 'undefined' || !workspacePath) return
    try {
      const rawPins = window.localStorage.getItem(`files.pins.${workspacePath}`)
      setPinned(new Set(rawPins ? (JSON.parse(rawPins) as Array<string>) : []))
      const rawRecents = window.localStorage.getItem(
        `files.recents.${workspacePath}`,
      )
      setRecentPaths(
        rawRecents ? (JSON.parse(rawRecents) as Array<string>) : [],
      )
    } catch {
      // corrupt/blocked storage — start empty
      setPinned(new Set())
      setRecentPaths([])
    }
  }, [workspacePath])

  const togglePin = useCallback(
    (path: string) => {
      setPinned((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        if (typeof window !== 'undefined' && pinsKey) {
          try {
            window.localStorage.setItem(pinsKey, JSON.stringify([...next]))
          } catch {
            // ignore write failure
          }
        }
        return next
      })
    },
    [pinsKey],
  )

  const pushRecent = useCallback(
    (path: string) => {
      setRecentPaths((prev) => {
        const next = [path, ...prev.filter((p) => p !== path)].slice(0, 8)
        if (typeof window !== 'undefined' && recentsKey) {
          try {
            window.localStorage.setItem(recentsKey, JSON.stringify(next))
          } catch {
            // ignore write failure
          }
        }
        return next
      })
    },
    [recentsKey],
  )

  // CRUD state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [promptState, setPromptState] = useState<PromptState | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [promptError, setPromptError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<FileEntry | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    setTreeError(null)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    try {
      // Let the server enforce its MAX_DIRECTORY_DEPTH default; passing
      // maxDepth=3 here used to defeat the server-side raise from #48.
      const res = await fetch('/api/files?action=list', {
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

  // Detect fresh-install / no-valid-workspace state:
  // show picker when the workspace is invalid OR is the throwaway auto-created
  // ~/workspace that the server creates as a last resort.
  const needsWorkspacePicker =
    workspaceCatalog !== null &&
    (!workspaceCatalog.isValid ||
      workspaceCatalog.source === 'home.workspace.created')

  const handlePickerSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = pickerPath.trim()
      if (!trimmed) {
        setPickerError('Please enter a folder path.')
        return
      }
      setPickerError(null)
      setPickerSaving(true)
      try {
        const res = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: trimmed }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const catalog = (await res.json()) as WorkspaceCatalog
        setWorkspaceCatalog(catalog)
        // Reload the file tree with the new workspace
        await loadTree()
      } catch (err) {
        setPickerError(err instanceof Error ? err.message : String(err))
      } finally {
        setPickerSaving(false)
      }
    },
    [pickerPath, loadTree],
  )

  // Close context menu on outside click / escape.
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  // Close the header sort menu on outside click / escape.
  useEffect(() => {
    if (!sortMenuOpen) return
    const handleClick = () => setSortMenuOpen(false)
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSortMenuOpen(false)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [sortMenuOpen])

  // ⌘K / Ctrl+K toggles the file-jump palette. Registered in capture phase and
  // preventDefault()'d so the global CommandPalette (workspace-shell) bails via
  // its own `if (event.defaultPrevented) return` guard — no double-open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'k'
      ) {
        e.preventDefault()
        e.stopPropagation()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

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

  const handleListingSelect = useCallback((entry: FileEntry) => {
    setSelectedEntry(entry)
    if (entry.type === 'folder') {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.add(entry.path)
        return next
      })
    }
  }, [])

  const handleSelectRoot = useCallback(() => {
    setSelectedEntry(null)
  }, [])

  // Select a file and expand the tree down to it (palette pick / quick access).
  const handleRevealFile = useCallback((file: FileEntry) => {
    setSelectedEntry(file)
    const parentParts = getPathParts(getParentPath(file.path))
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let index = 1; index <= parentParts.length; index += 1) {
        next.add(parentParts.slice(0, index).join('/'))
      }
      return next
    })
  }, [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY, entry })
    },
    [],
  )

  // ── CRUD actions ────────────────────────────────────────────────────────────

  const handleOpen = useCallback((entry: FileEntry) => {
    setSelectedEntry(entry)
    if (entry.type === 'folder') {
      setExpanded((prev) => new Set(prev).add(entry.path))
    }
  }, [])

  const handleCopyPath = useCallback(async (entry: FileEntry) => {
    setActionError(null)
    try {
      await writeTextToClipboard(`workspace/${entry.path}`)
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not copy the file path.',
      )
    }
  }, [])

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

  const openRenamePrompt = useCallback((entry: FileEntry) => {
    setPromptState({
      mode: 'rename',
      targetPath: entry.path,
      defaultValue: entry.name,
    })
    setPromptValue(entry.name)
  }, [])

  const openMovePrompt = useCallback((entry: FileEntry) => {
    setPromptState({
      mode: 'move',
      targetPath: entry.path,
      defaultValue: entry.path,
    })
    setPromptValue(entry.path)
  }, [])

  const openNewFilePrompt = useCallback((targetPath = '') => {
    setPromptState({ mode: 'new-file', targetPath })
    setPromptValue('')
  }, [])

  const openNewFolderPrompt = useCallback((targetPath = '') => {
    setPromptState({ mode: 'new-folder', targetPath })
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

      setActionError(null)
      try {
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
        await loadTree()
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Could not upload the file.',
        )
      } finally {
        event.target.value = ''
      }
    },
    [loadTree],
  )

  const handlePromptSubmit = useCallback(async () => {
    if (!promptState) return
    const value = promptValue.trim()
    if (!value) return

    setPromptError(null)
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
      } else if (promptState.mode === 'move') {
        res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'rename',
            from: promptState.targetPath,
            to: value,
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
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        setPromptError(body || `HTTP ${res.status}`)
        return
      }
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : String(err))
      return
    }

    setPromptState(null)
    setPromptValue('')
    await loadTree()
  }, [promptState, promptValue, loadTree])

  // Debounce search input so the recursive tree walk doesn't re-run per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedTreeQuery(treeQuery), 150)
    return () => window.clearTimeout(id)
  }, [treeQuery])

  const selectedPath = selectedEntry?.path ?? null

  const findEntryByPath = useCallback(
    (items: Array<FileEntry>, path: string): FileEntry | null => {
      for (const item of items) {
        if (item.path === path) return item
        if (item.children) {
          const hit = findEntryByPath(item.children, path)
          if (hit) return hit
        }
      }
      return null
    },
    [],
  )

  const liveSelected = useMemo(() => {
    if (!selectedPath) return null
    return findEntryByPath(entries, selectedPath)
  }, [entries, selectedPath, findEntryByPath])

  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      if (!path) return handleSelectRoot()
      const target = findEntryByPath(entries, path)
      if (target) handleRevealFile(target)
    },
    [entries, findEntryByPath, handleRevealFile, handleSelectRoot],
  )

  useEffect(() => {
    if (!search.open) return
    const target = findEntryByPath(entries, search.open)
    if (!target) return

    setSelectedEntry((current) =>
      current?.path === target.path ? current : target,
    )
    const parentParts = getPathParts(getParentPath(target.path))
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let index = 1; index <= parentParts.length; index += 1) {
        next.add(parentParts.slice(0, index).join('/'))
      }
      return next
    })
  }, [entries, findEntryByPath, search.open])

  useEffect(() => {
    if (selectedPath && !liveSelected) {
      setSelectedEntry(null)
    }
  }, [selectedPath, liveSelected])

  const listingFolderEntries: Array<FileEntry> = useMemo(() => {
    const source = !liveSelected
      ? entries
      : liveSelected.type === 'folder'
        ? (liveSelected.children ?? [])
        : []
    return source.filter((e) => !IGNORED_DIRS.has(e.name))
  }, [liveSelected, entries])

  const visibleEntries = useMemo(() => {
    const query = debouncedTreeQuery.trim()

    const compareEntries = (a: FileEntry, b: FileEntry): number => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      if (treeSort === 'modified') {
        const am = a.modifiedAt ? Date.parse(a.modifiedAt) : 0
        const bm = b.modifiedAt ? Date.parse(b.modifiedAt) : 0
        if (bm !== am) return bm - am
      } else if (treeSort === 'type' && a.type === 'file') {
        const cmp = fileKindKey(a.name).localeCompare(fileKindKey(b.name))
        if (cmp !== 0) return cmp
      }
      // 'type' degenerates to name for the folders-only tree rows.
      return a.name.localeCompare(b.name)
    }

    const filterItems = (items: Array<FileEntry>): Array<FileEntry> =>
      items
        .filter((entry) => !IGNORED_DIRS.has(entry.name))
        .map((entry): FileEntry | null => {
          const children = entry.children
            ? filterItems(entry.children)
            : undefined
          if (!query) return { ...entry, children }
          if (
            fuzzy(query, entry.name) !== null ||
            (children && children.length > 0)
          ) {
            return { ...entry, children }
          }

          return null
        })
        .filter((entry): entry is FileEntry => Boolean(entry))
        .sort(compareEntries)

    return filterItems(entries)
  }, [entries, debouncedTreeQuery, treeSort])

  // Kinds present anywhere in the workspace — drives the type filter options.
  const availableKinds = useMemo(() => {
    const kinds = new Set<string>()
    const walk = (items: Array<FileEntry>) => {
      for (const item of items) {
        if (IGNORED_DIRS.has(item.name)) continue
        if (item.type === 'file') kinds.add(fileKindKey(item.name))
        else if (item.children) walk(item.children)
      }
    }
    walk(entries)
    return Object.keys(KIND_LABEL).filter((k) => kinds.has(k))
  }, [entries])

  // Tree rows in render order (folders only), for ↑/↓ keyboard navigation.
  const flatTreeRows = useMemo(() => {
    const force = Boolean(debouncedTreeQuery.trim())
    const out: Array<FileEntry> = []
    const walk = (items: Array<FileEntry>) => {
      for (const item of items) {
        if (item.type !== 'folder' || IGNORED_DIRS.has(item.name)) continue
        out.push(item)
        if ((force || expanded.has(item.path)) && item.children) {
          walk(item.children)
        }
      }
    }
    walk(visibleEntries)
    return out
  }, [visibleEntries, expanded, debouncedTreeQuery])

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (flatTreeRows.length === 0) return
        const idx = flatTreeRows.findIndex((r) => r.path === selectedPath)
        const next =
          e.key === 'ArrowDown'
            ? Math.min(idx + 1, flatTreeRows.length - 1)
            : Math.max(idx - 1, 0)
        setSelectedEntry(flatTreeRows[next])
      } else if (e.key === 'Enter') {
        const current = flatTreeRows.find((r) => r.path === selectedPath)
        if (!current) return
        e.preventDefault()
        handleSelect(current)
        handleToggle(current.path)
      } else if (e.key === 'Escape') {
        setTreeQuery('')
        if (e.target instanceof HTMLElement) e.target.blur()
      }
    },
    [flatTreeRows, selectedPath, handleSelect, handleToggle],
  )
  const entryCounts = useMemo(() => countEntries(entries), [entries])

  // Flat file list (files only, ignored dirs skipped) — feeds the palette + QA.
  const flatFiles = useMemo(() => {
    const out: Array<FileEntry> = []
    const walk = (items: Array<FileEntry>) => {
      for (const item of items) {
        if (IGNORED_DIRS.has(item.name)) continue
        if (item.type === 'folder') {
          if (item.children) walk(item.children)
        } else {
          out.push(item)
        }
      }
    }
    walk(entries)
    return out
  }, [entries])

  // Per-kind file counts for the type-filter chip row.
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const file of flatFiles) {
      const kind = fileKindKey(file.name)
      counts[kind] = (counts[kind] ?? 0) + 1
    }
    return counts
  }, [flatFiles])

  const fileByPath = useMemo(() => {
    const map = new Map<string, FileEntry>()
    for (const file of flatFiles) map.set(file.path, file)
    return map
  }, [flatFiles])

  const pinnedFiles = useMemo(
    () =>
      [...pinned]
        .map((path) => fileByPath.get(path))
        .filter((file): file is FileEntry => Boolean(file)),
    [pinned, fileByPath],
  )

  const recentFiles = useMemo(
    () =>
      recentPaths
        .map((path) => fileByPath.get(path))
        .filter((file): file is FileEntry => Boolean(file)),
    [recentPaths, fileByPath],
  )

  // Record every file selection (tree / grid / palette / context-open / search)
  // into recents — one central hook covers all selection paths.
  useEffect(() => {
    if (selectedEntry?.type === 'file') pushRecent(selectedEntry.path)
  }, [selectedEntry?.path, selectedEntry?.type, pushRecent])

  const resolvedContextMenu = useMemo(() => {
    if (!contextMenu || typeof window === 'undefined') return contextMenu
    const itemCount = contextMenu.entry.type === 'folder' ? 8 : 6
    return {
      ...contextMenu,
      ...clampContextMenuPosition(
        contextMenu,
        { width: 220, height: itemCount * 36 + 16 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    }
  }, [contextMenu])

  // ── First-run workspace picker ──────────────────────────────────────────────
  if (needsWorkspacePicker) {
    const knownWorkspaces = workspaceCatalog.workspaces
    return (
      <div
        data-screen="files"
        className="files-shell"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          className="files-workspace-picker"
          style={{
            maxWidth: 480,
            width: '100%',
            padding: '2rem',
            borderRadius: 10,
            background: 'var(--theme-card, #111)',
            border: '1.5px solid var(--theme-border, #333)',
          }}
        >
          <h2
            style={{
              margin: '0 0 0.5rem',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--theme-text)',
            }}
          >
            Choose your workspace folder
          </h2>
          <p
            style={{
              margin: '0 0 1.25rem',
              fontSize: 13,
              color: 'var(--theme-muted)',
              lineHeight: 1.5,
            }}
          >
            Pick the project folder you want to browse and work in. Enter an
            absolute path below or select from previously used workspaces.
          </p>

          {knownWorkspaces.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--theme-muted)',
                  marginBottom: '0.4rem',
                }}
              >
                Recent workspaces
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {knownWorkspaces.map((ws) => (
                  <button
                    key={ws.path}
                    type="button"
                    onClick={() => setPickerPath(ws.path)}
                    style={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--theme-border, #333)',
                      background:
                        pickerPath === ws.path
                          ? 'var(--theme-accent-subtle, #1a2a1a)'
                          : 'transparent',
                      cursor: 'pointer',
                      color: 'var(--theme-text)',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {ws.name ?? ws.path.split('/').at(-1)}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 10,
                        color: 'var(--theme-muted)',
                        marginTop: 1,
                      }}
                    >
                      {ws.path}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              void handlePickerSubmit(e)
            }}
          >
            <label
              htmlFor="workspace-path-input"
              style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: '0.35rem',
                color: 'var(--theme-muted)',
              }}
            >
              Folder path
            </label>
            <input
              id="workspace-path-input"
              type="text"
              value={pickerPath}
              onChange={(e) => {
                setPickerPath(e.target.value)
                setPickerError(null)
              }}
              placeholder="/home/user/my-project"
              autoFocus
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1.5px solid ${pickerError ? 'var(--theme-error, #e55)' : 'var(--theme-border, #333)'}`,
                background: 'var(--theme-bg, #0a0a0a)',
                color: 'var(--theme-text)',
                fontSize: 13,
                fontFamily: 'var(--font-mono, monospace)',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            {pickerError && (
              <div
                style={{
                  marginTop: '0.35rem',
                  fontSize: 12,
                  color: 'var(--theme-error, #e55)',
                }}
              >
                {pickerError}
              </div>
            )}
            <Button
              type="submit"
              disabled={pickerSaving || !pickerPath.trim()}
              style={{ marginTop: '0.85rem', width: '100%' }}
            >
              {pickerSaving ? 'Saving…' : 'Use this folder'}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div
      data-screen="files"
      data-labels={labels}
      className={cn('files-shell', treeCollapsed ? 'tree-collapsed' : '')}
      style={{ '--f-accent': accent, '--rowpad': density } as CSSProperties}
    >
      <aside className={cn('files-tree', treeCollapsed ? 'is-collapsed' : '')}>
        {/* header */}
        <div className="files-tree-head">
          <h3>Files</h3>
          <span className="ct">{entryCounts.files + entryCounts.folders}</span>
          <div className="files-tree-actions">
            <button
              type="button"
              className="files-icon-btn"
              onClick={() => openNewFolderPrompt()}
              title="New folder"
            >
              <SvgIco name="plus" size={14} />
            </button>
            <button
              type="button"
              className="files-icon-btn"
              onClick={() => {
                // Issue #34 — honor the currently-selected tree node so files
                // land in the navigated folder. Folder selected → upload there;
                // file selected → upload to its parent; nothing selected →
                // workspace root (empty string).
                let target = ''
                if (selectedEntry) {
                  target =
                    selectedEntry.type === 'folder'
                      ? selectedEntry.path
                      : getParentPath(selectedEntry.path) || ''
                }
                openUploadPicker(target)
              }}
              title={
                selectedEntry?.type === 'folder'
                  ? `Upload to ${selectedEntry.path}`
                  : selectedEntry
                    ? `Upload to ${getParentPath(selectedEntry.path) || 'workspace root'}`
                    : 'Upload to workspace root'
              }
            >
              <SvgIco name="upload" size={14} />
            </button>
            <span className="files-sort-wrap">
              <button
                type="button"
                className={cn('files-icon-btn', sortMenuOpen ? 'is-open' : '')}
                onClick={(e) => {
                  e.stopPropagation()
                  setSortMenuOpen((v) => !v)
                }}
                title="Sort"
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
              >
                <SvgIco name="sort" size={14} />
              </button>
              {sortMenuOpen ? (
                <div
                  className="files-sort-menu"
                  role="menu"
                  aria-label="Sort files"
                >
                  {(
                    [
                      ['name', 'Name'],
                      ['modified', 'Modified'],
                      ['type', 'Type'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={treeSort === value}
                      className={cn(treeSort === value ? 'is-active' : '')}
                      onClick={() => {
                        setTreeSort(value)
                        setSortMenuOpen(false)
                      }}
                    >
                      <span className="mark" aria-hidden="true">
                        {treeSort === value ? '✓' : ''}
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
            <button
              type="button"
              className="files-icon-btn"
              onClick={() => void loadTree()}
              title="Refresh"
            >
              <SvgIco name="refresh" size={14} />
            </button>
          </div>
          <button
            type="button"
            className="files-icon-btn collapse-btn"
            onClick={() => setTreeCollapsed((v) => !v)}
            title={treeCollapsed ? 'Expand tree' : 'Collapse tree'}
            aria-label={treeCollapsed ? 'Expand tree' : 'Collapse tree'}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="14"
              height="14"
            >
              {treeCollapsed ? (
                <path d="M9 18l6-6-6-6" />
              ) : (
                <path d="M15 18l-6-6 6-6" />
              )}
            </svg>
          </button>
        </div>

        {/* quick jump — trigger for the ⌘K palette, styled as an input */}
        <button
          type="button"
          className="files-quickjump"
          onClick={() => setPaletteOpen(true)}
          aria-label="Quick jump to any file"
        >
          <SvgIco name="cmd" size={13} />
          <span className="qj-text">Quick jump to any file…</span>
          <kbd aria-hidden="true">⌘K</kbd>
        </button>

        {/* search */}
        <div className="files-tree-search">
          <input
            type="text"
            value={treeQuery}
            onChange={(e) => setTreeQuery(e.target.value)}
            onKeyDown={handleTreeKeyDown}
            placeholder="Search workspace…"
            aria-label="Search files"
          />
        </div>

        {/* type filter chips */}
        <div
          className="files-kind-chips"
          role="group"
          aria-label="Filter by file type"
        >
          <button
            type="button"
            className={cn(
              'files-kind-chip',
              typeFilter === 'all' ? 'is-active' : '',
            )}
            aria-pressed={typeFilter === 'all'}
            onClick={() => setTypeFilter('all')}
          >
            ALL <span className="ct">{flatFiles.length}</span>
          </button>
          {availableKinds.map((k) => (
            <button
              key={k}
              type="button"
              className={cn(
                'files-kind-chip',
                typeFilter === k ? 'is-active' : '',
              )}
              aria-pressed={typeFilter === k}
              style={{ '--chip-c': KIND_COLOR[k] } as CSSProperties}
              onClick={() => setTypeFilter(k)}
            >
              <span className="dot" aria-hidden="true" />
              {KIND_LABEL[k] ?? k}{' '}
              <span className="ct">{kindCounts[k] ?? 0}</span>
            </button>
          ))}
        </div>

        {actionError ? (
          <p className="px-3 pb-2 text-xs text-destructive" role="status">
            {actionError}
          </p>
        ) : null}

        {/* breadcrumb */}
        <Breadcrumb
          path={selectedEntry?.path ?? ''}
          className="files-tree-breadcrumb"
          onNavigate={handleBreadcrumbNavigate}
        />

        {/* body — keyboard nav delegates from the focusable tree row buttons */}
        <div className="files-tree-body" onKeyDown={handleTreeKeyDown}>
          {showQA && !treeQuery.trim() && typeFilter === 'all' ? (
            <>
              <QuickAccessGroup
                variant="pinned"
                files={pinnedFiles}
                open={qaPinnedOpen}
                onToggleOpen={() => setQaPinnedOpen((o) => !o)}
                activePath={selectedPath}
                onPick={handleRevealFile}
                onTogglePin={togglePin}
              />
              <QuickAccessGroup
                variant="recent"
                files={recentFiles}
                open={qaRecentOpen}
                onToggleOpen={() => setQaRecentOpen((o) => !o)}
                activePath={selectedPath}
                onPick={handleRevealFile}
                onTogglePin={togglePin}
              />
            </>
          ) : null}
          {treeLoading ? (
            <div className="files-tree-loading">Loading…</div>
          ) : treeError ? (
            <div className="files-tree-error">{treeError}</div>
          ) : visibleEntries.length === 0 ? (
            <div className="files-tree-empty">
              {treeQuery ? 'No matches' : 'Workspace is empty'}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSelectRoot}
                className={cn(
                  'files-tree-row',
                  selectedPath === null ? 'is-active' : '',
                )}
                style={{ paddingLeft: 12 }}
              >
                <span className="chev">▼</span>
                <span className="icon is-folder" aria-hidden="true" />
                <span className="name">workspace</span>
              </button>
              <FileTree
                entries={visibleEntries}
                expanded={expanded}
                forceExpanded={Boolean(treeQuery.trim())}
                selectedPath={selectedPath}
                query={debouncedTreeQuery.trim() || undefined}
                onToggle={handleToggle}
                onSelect={handleSelect}
                onDeleteRequest={setDeleteConfirm}
                onContextMenu={handleContextMenu}
              />
            </>
          )}
        </div>

        {/* foot */}
        <div className="files-tree-foot">
          <span>
            <b>{entryCounts.files}</b> files
          </span>
          <span>
            <b>{entryCounts.folders}</b> folders
          </span>
          {treeQuery ? <span>filter active</span> : null}
        </div>

        {/* collapsed rail */}
        <div className="files-rail">
          <span className="rail-label">Files</span>
          <span className="rail-badge">{entryCounts.files}</span>
        </div>
      </aside>

      <main className="files-preview-host">
        {liveSelected && liveSelected.type === 'file' ? (
          <FilePanel
            workspacePath={workspacePath}
            selectedEntry={liveSelected}
            onNavigate={handleBreadcrumbNavigate}
            isPinned={pinned.has(liveSelected.path)}
            onTogglePin={togglePin}
            onDeleteRequest={setDeleteConfirm}
            onUploadRequest={openUploadPicker}
          />
        ) : (
          <section className="files-preview" aria-label="Folder listing">
            <div className="files-preview-top">
              <Breadcrumb
                path={liveSelected?.path ?? ''}
                onNavigate={handleBreadcrumbNavigate}
              />
              <div className="files-preview-actions">
                <span
                  className="files-kind-badge"
                  style={{ color: 'var(--f-accent)' }}
                  title="Folder"
                >
                  <SvgIco name="folder" size={11} />
                  Folder
                </span>
                <button
                  type="button"
                  className="files-preview-act"
                  onClick={() => openNewFilePrompt(liveSelected?.path ?? '')}
                  title="New file here"
                >
                  <SvgIco name="plus" size={13} />
                  New
                </button>
                <button
                  type="button"
                  className="files-preview-act"
                  onClick={() => openUploadPicker(liveSelected?.path ?? '')}
                  title="Upload here"
                >
                  <SvgIco name="upload" size={13} />
                  Upload
                </button>
                {liveSelected ? (
                  <button
                    type="button"
                    className="files-icon-btn danger"
                    onClick={() => setDeleteConfirm(liveSelected)}
                    title="Delete folder"
                  >
                    <SvgIco name="trash" size={14} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="files-preview-canvas">
              <FolderListing
                entries={listingFolderEntries}
                folderPath={liveSelected?.path ?? ''}
                query={debouncedTreeQuery.trim() || undefined}
                typeFilter={typeFilter}
                externalSort={treeSort}
                onSelect={handleListingSelect}
                onContextMenu={handleContextMenu}
              />
            </div>
            <div className="files-preview-foot">
              <span>
                folder{' '}
                {liveSelected?.path
                  ? (liveSelected.path.split('/').pop() ?? liveSelected.path)
                  : 'workspace'}
              </span>
              <span className="files-divider" />
              <span>{listingFolderEntries.length} items</span>
              <span className="files-foot-right">
                {listingFolderEntries.filter((e) => e.type === 'folder').length}{' '}
                folders ·{' '}
                {listingFolderEntries.filter((e) => e.type === 'file').length}{' '}
                files
              </span>
            </div>
          </section>
        )}
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

      {/* ── Command palette (⌘K) ──────────────────────────────────────────── */}
      {paletteOpen ? (
        <FilesPalette
          files={flatFiles}
          recents={recentFiles}
          onClose={() => setPaletteOpen(false)}
          onPick={handleRevealFile}
        />
      ) : null}

      <FilesTweaks
        open={tweaksOpen}
        setOpen={setTweaksOpen}
        accent={accent}
        setAccent={setAccent}
        density={density}
        setDensity={setDensity}
        labels={labels}
        setLabels={setLabels}
        showQA={showQA}
        setShowQA={setShowQA}
      />

      {/* ── Context menu ──────────────────────────────────────────────────── */}
      {resolvedContextMenu && typeof document !== 'undefined'
        ? createPortal(
            // Wrapper carries data-screen="files" so the scoped .files-ctx-menu
            // CSS + --f-* tokens resolve even though the menu is portaled to <body>.
            <div data-screen="files">
              <div
                role="menu"
                aria-label="File actions"
                className="files-ctx-menu"
                style={{
                  top: resolvedContextMenu.y,
                  left: resolvedContextMenu.x,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="files-ctx-item"
                  onClick={() => {
                    handleOpen(resolvedContextMenu.entry)
                    setContextMenu(null)
                  }}
                >
                  <SvgIco name="open" size={14} /> Open
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="files-ctx-item"
                  onClick={() => {
                    void handleCopyPath(resolvedContextMenu.entry)
                    setContextMenu(null)
                  }}
                >
                  <SvgIco name="copy" size={14} /> Copy path
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="files-ctx-item"
                  onClick={() => {
                    openRenamePrompt(resolvedContextMenu.entry)
                    setContextMenu(null)
                  }}
                >
                  <SvgIco name="rename" size={14} /> Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="files-ctx-item"
                  onClick={() => {
                    openMovePrompt(resolvedContextMenu.entry)
                    setContextMenu(null)
                  }}
                >
                  <SvgIco name="move" size={14} /> Move to…
                </button>
                {resolvedContextMenu.entry.type === 'folder' ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="files-ctx-item"
                      onClick={() => {
                        openNewFilePrompt(resolvedContextMenu.entry.path)
                        setContextMenu(null)
                      }}
                    >
                      <SvgIco name="plus" size={14} /> New file
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="files-ctx-item"
                      onClick={() => {
                        openNewFolderPrompt(resolvedContextMenu.entry.path)
                        setContextMenu(null)
                      }}
                    >
                      <SvgIco name="folder" size={14} /> New folder
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="files-ctx-item"
                      onClick={() => {
                        openUploadPicker(resolvedContextMenu.entry.path)
                        setContextMenu(null)
                      }}
                    >
                      <SvgIco name="upload" size={14} /> Upload here
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="files-ctx-item"
                    onClick={() => {
                      void handleDownload(resolvedContextMenu.entry)
                      setContextMenu(null)
                    }}
                  >
                    <SvgIco name="dl" size={14} /> Download
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="files-ctx-item is-danger"
                  onClick={() => {
                    setDeleteConfirm(resolvedContextMenu.entry)
                    setContextMenu(null)
                  }}
                >
                  <SvgIco name="trash" size={14} /> Delete
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* ── Rename / New-folder prompt dialog ─────────────────────────────── */}
      <Dialog
        open={Boolean(promptState)}
        onOpenChange={(open) => {
          if (!open) {
            setPromptState(null)
            setPromptError(null)
          }
        }}
      >
        <DialogContent>
          <div className="p-5 space-y-3">
            <DialogTitle>
              {promptState?.mode === 'rename'
                ? 'Rename'
                : promptState?.mode === 'move'
                  ? 'Move to'
                  : promptState?.mode === 'new-file'
                    ? 'New File'
                    : 'New Folder'}
            </DialogTitle>
            <DialogDescription>
              {promptState?.mode === 'rename'
                ? 'Enter a new name.'
                : promptState?.mode === 'move'
                  ? 'Enter the destination path, including the new name.'
                  : `Enter a ${promptState?.mode === 'new-file' ? 'file' : 'folder'} name to create.`}
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
            {promptError && (
              <p className="text-sm text-destructive">{promptError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={() => void handlePromptSubmit()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ──────────────────────────────────────────── */}
      <Dialog
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirm(null)
            setDeleteError(null)
          }
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
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => void handleDeleteConfirmed()}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
