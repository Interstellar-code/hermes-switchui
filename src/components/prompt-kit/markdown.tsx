import { marked } from 'marked'
import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  FileCode,
  FileText,
  Info,
  Lightbulb,
} from 'lucide-react'
import { CodeBlock } from './code-block'
import type { ReactElement, ReactNode } from 'react'
import type { Components } from 'react-markdown'
import { cn } from '@/lib/utils'
import { writeRichTextToClipboard } from '@/lib/clipboard'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks]

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  components?: Partial<Components>
}

function mediaApiPath(filePath: string): string {
  return `/api/media?path=${encodeURIComponent(filePath)}`
}

export function rewriteLocalMediaSources(content: string): string {
  return content
    .replace(
      /!\[([^\]]*)\]\(MEDIA:([^)]+)\)/gi,
      (_match, alt: string, filePath: string) =>
        `![${alt}](${mediaApiPath(filePath.trim())})`,
    )
    .replace(
      /<img\b([^>]*?)\bsrc=(["'])MEDIA:([^"']+)\2([^>]*)>/gi,
      (
        _match,
        beforeSrc: string,
        quote: string,
        filePath: string,
        afterSrc: string,
      ) =>
        `<img${beforeSrc}src=${quote}${mediaApiPath(filePath.trim())}${quote}${afterSrc}>`,
    )
}

function parseMarkdownIntoBlocks(markdown: string): Array<string> {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
}

function extractLanguage(className?: string): string {
  if (!className) return 'text'
  const match = className.match(/language-(\w+)/)
  return match ? match[1] : 'text'
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map((item: ReactNode) => textFromNode(item)).join('')
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const element = node as { props: { children?: ReactNode } }
    return textFromNode(element.props.children)
  }
  return ''
}

function escapeTableCell(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
}

/** Serialize a rendered HTML table back into GitHub-flavored Markdown. */
function tableElementToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.rows)
  if (rows.length === 0) return ''
  const lines: Array<string> = []
  rows.forEach((row, rowIndex) => {
    const cells = Array.from(row.cells).map((cell) =>
      escapeTableCell(cell.textContent || ''),
    )
    lines.push(`| ${cells.join(' | ')} |`)
    if (rowIndex === 0) {
      lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    }
  })
  return lines.join('\n')
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/**
 * Allowlist-based href sanitizer.
 *
 * Strips control characters and Unicode whitespace that browsers silently
 * ignore before parsing the scheme (e.g. `java\tscript:` or ` data:`),
 * then checks the scheme against a safe allowlist.
 *
 * Allowed: http:, https:, mailto:, and relative links (/, #, ./, ../).
 * Blocked: javascript:, data:, vbscript:, and anything else with a scheme.
 */
export function isSafeHref(href: string | null | undefined): boolean {
  if (href == null) return false
  // Strip C0/C1 control characters and Unicode whitespace that browsers ignore
  // before parsing the URL scheme (prevents java\x09script: bypasses).
  // Control chars in the class are intentional — that's the bypass we defend against.
  // eslint-disable-next-line no-control-regex
  const cleaned = href.replace(/[\x00-\x1f\x7f-\x9f\s]/g, '')
  const lower = cleaned.toLowerCase()
  // Relative links — safe by construction.
  if (
    lower.startsWith('/') ||
    lower.startsWith('#') ||
    lower.startsWith('./') ||
    lower.startsWith('../')
  ) {
    return true
  }
  // Allowlist absolute schemes.
  if (
    lower.startsWith('https:') ||
    lower.startsWith('http:') ||
    lower.startsWith('mailto:')
  ) {
    return true
  }
  // No scheme at all (bare relative path like "page.html") — allow.
  if (!lower.includes(':')) return true
  // Anything else (javascript:, data:, vbscript:, …) — block.
  return false
}

function slugifyHeading(children: ReactNode): string {
  const raw = textFromNode(children)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
  return raw.length > 0 ? raw : 'section'
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GFM Alert Callouts
// ─────────────────────────────────────────────────────────────────────────────

const CALLOUT_TYPES = [
  'NOTE',
  'WARNING',
  'DECISION',
  'RECOMMENDATION',
  'TIP',
  'CAUTION',
] as const
type CalloutType = (typeof CALLOUT_TYPES)[number]

const CALLOUT_REGEX =
  /^\s*\[!(NOTE|WARNING|DECISION|RECOMMENDATION|TIP|CAUTION)\](?:\s*[\r\n]|\s+|$)/i

function extractCallout(children: ReactNode): {
  type: CalloutType | null
  content: ReactNode
} {
  if (!children) return { type: null, content: children }

  // Check full text for callout prefix
  const fullText = textFromNode(children).trim()
  const match = fullText.match(CALLOUT_REGEX)
  if (!match) return { type: null, content: children }

  const type = match[1].toUpperCase() as CalloutType

  // Remove the callout marker from the first child paragraph or string
  function stripCalloutMarker(node: ReactNode): ReactNode {
    if (typeof node === 'string') {
      return node.replace(CALLOUT_REGEX, '')
    }
    if (Array.isArray(node)) {
      if (node.length === 0) return node
      return [stripCalloutMarker(node[0]), ...node.slice(1)]
    }
    if (isValidElement(node)) {
      const element = node as ReactElement<{ children?: ReactNode }>
      return cloneElement(element, {
        children: stripCalloutMarker(element.props.children),
      })
    }
    return node
  }

  const cleanedContent = stripCalloutMarker(children)
  return { type, content: cleanedContent }
}

const CALLOUT_CONFIG: Record<
  CalloutType,
  {
    label: string
    icon: typeof Info
    cardClass: string
    badgeClass: string
    iconClass: string
  }
> = {
  RECOMMENDATION: {
    label: 'RECOMMENDATION',
    icon: CheckCircle2,
    cardClass:
      'border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_15%,transparent)] text-[var(--theme-text)]',
    badgeClass:
      'border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_20%,transparent)] text-[var(--theme-accent)]',
    iconClass: 'text-[var(--theme-accent)]',
  },
  DECISION: {
    label: 'DECISION',
    icon: CheckCircle2,
    cardClass:
      'border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_15%,transparent)] text-[var(--theme-text)]',
    badgeClass:
      'border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_20%,transparent)] text-[var(--theme-accent)]',
    iconClass: 'text-[var(--theme-accent)]',
  },
  WARNING: {
    label: 'WARNING',
    icon: AlertTriangle,
    cardClass:
      'border-[var(--theme-warning,#d97706)] bg-[color-mix(in_srgb,var(--theme-warning,#d97706)_12%,transparent)] text-[var(--theme-text)]',
    badgeClass:
      'border-[var(--theme-warning,#d97706)] bg-[color-mix(in_srgb,var(--theme-warning,#d97706)_18%,transparent)] text-[var(--theme-warning,#d97706)]',
    iconClass: 'text-[var(--theme-warning,#d97706)]',
  },
  CAUTION: {
    label: 'CAUTION',
    icon: AlertOctagon,
    cardClass:
      'border-[var(--theme-danger,#ef4444)] bg-[color-mix(in_srgb,var(--theme-danger,#ef4444)_12%,transparent)] text-[var(--theme-text)]',
    badgeClass:
      'border-[var(--theme-danger,#ef4444)] bg-[color-mix(in_srgb,var(--theme-danger,#ef4444)_18%,transparent)] text-[var(--theme-danger,#ef4444)]',
    iconClass: 'text-[var(--theme-danger,#ef4444)]',
  },
  TIP: {
    label: 'TIP',
    icon: Lightbulb,
    cardClass:
      'border-[color-mix(in_srgb,var(--theme-accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)] text-[var(--theme-text)]',
    badgeClass:
      'border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_18%,transparent)] text-[var(--theme-accent)]',
    iconClass: 'text-[var(--theme-accent)]',
  },
  NOTE: {
    label: 'NOTE',
    icon: Info,
    cardClass:
      'border-[var(--theme-border)] bg-[var(--theme-card2)] text-[var(--theme-text)]',
    badgeClass:
      'border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-muted)]',
    iconClass: 'text-[var(--theme-muted)]',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Clickable File Chips
// ─────────────────────────────────────────────────────────────────────────────

const FILE_EXT_REGEX =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|json|md|markdown|yaml|yml|css|scss|sass|html|htm|sh|bash|zsh|sql|toml|env|svg|png|jpg|jpeg|gif|webp|lock)$/i
const PATH_PREFIX_REGEX = /^(?:\/|~\/|\.\.?\/)/

function isFilePath(text: string): boolean {
  if (!text || /\s/.test(text) || text.length < 2) return false
  if (/[<>"'`|?*]/.test(text)) return false
  if (
    text === '.' ||
    text === '..' ||
    text === '/' ||
    text === './' ||
    text === '~/'
  )
    return false
  return PATH_PREFIX_REGEX.test(text) || FILE_EXT_REGEX.test(text)
}

function isDocFilePath(path: string): boolean {
  return /\.(?:md|markdown|txt|log|doc|docx|pdf|rtf)$/i.test(path)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Zebra Comparison Tables & Verdict Badges
// ─────────────────────────────────────────────────────────────────────────────

function isNumericCell(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /^[+-]?[€$£¥]?\d+(?:,\d+)*(?:\.\d+)?%?(?:ms|s|m|h|d|fps|kb|mb|gb|tb|k|m|b|px|pt|em|rem|x)?$/i.test(
    trimmed,
  )
}

function getVerdictBadge(text: string): {
  label: 'PICK' | 'YES' | 'NO'
  variant: 'accent' | 'success' | 'danger'
} | null {
  const trimmed = text.trim().toUpperCase()
  if (trimmed === 'PICK') {
    return { label: 'PICK', variant: 'accent' }
  }
  if (trimmed === 'YES') {
    return { label: 'YES', variant: 'success' }
  }
  if (trimmed === 'NO') {
    return { label: 'NO', variant: 'danger' }
  }
  return null
}

const INITIAL_COMPONENTS: Partial<Components> = {
  code: function CodeComponent({ className, children }) {
    const isInline = !className?.includes('language-')

    if (isInline) {
      const text = String(children ?? '').trim()
      const looksLikePath = isFilePath(text)

      if (looksLikePath) {
        const expanded = text.replace(/^~\/?/, '')
        const isDoc = isDocFilePath(text)
        const FileIcon = isDoc ? FileText : FileCode

        return (
          <a
            href={`/files?path=${encodeURIComponent(expanded)}`}
            data-testid="file-chip"
            data-path={expanded}
            title={`Open ${text}`}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[0.85em]',
              'bg-[var(--theme-card2)] hover:bg-[color-mix(in_srgb,var(--theme-accent)_15%,var(--theme-card2))]',
              'text-[var(--theme-accent)] border border-[color-mix(in_srgb,var(--theme-accent)_35%,var(--theme-border))]',
              'hover:border-[var(--theme-accent)] transition-colors cursor-pointer text-left align-baseline max-w-full truncate no-underline',
            )}
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
                e.preventDefault()
                try {
                  useSessionsFilterStore.getState().setCollapsed(false)
                  useSessionsFilterStore.getState().setLeftPanel('files')
                  window.dispatchEvent(
                    new CustomEvent('hermes:open-file', {
                      detail: { path: expanded },
                    }),
                  )
                } catch {
                  /* noop */
                }
              }
            }}
          >
            <FileIcon
              className="w-3.5 h-3.5 shrink-0 opacity-80"
              aria-hidden="true"
            />
            <span className="truncate">{children}</span>
          </a>
        )
      }

      return (
        <code className="rounded px-1.5 py-0.5 text-[0.9em] font-mono bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)] text-[var(--theme-accent)] border border-[color-mix(in_srgb,var(--theme-accent)_25%,transparent)]">
          {children}
        </code>
      )
    }

    const language = extractLanguage(className)
    return (
      <CodeBlock
        content={String(children ?? '')}
        language={language}
        className="w-full my-2"
      />
    )
  },
  pre: function PreComponent({ children }) {
    return <>{children}</>
  },
  h1: function H1Component({ children }) {
    return (
      <h1 className="mt-5 mb-2 text-2xl leading-tight font-medium text-[var(--theme-text)] text-balance first:mt-0">
        {children}
      </h1>
    )
  },
  h2: function H2Component({ children }) {
    const id = slugifyHeading(children)
    return (
      <h2
        id={id}
        className="numbered-heading mt-5 mb-2 text-xl leading-tight font-medium text-[var(--theme-text)] text-balance first:mt-0"
      >
        <a
          href={`#${id}`}
          className="group/heading inline-flex items-center gap-1 no-underline text-[var(--theme-text)]"
        >
          <span>{children}</span>
          <span
            aria-hidden="true"
            className="text-[var(--theme-muted)] opacity-0 transition-opacity group-hover/heading:opacity-100 group-hover/heading:text-[var(--theme-accent)]"
          >
            #
          </span>
        </a>
      </h2>
    )
  },
  h3: function H3Component({ children }) {
    const id = slugifyHeading(children)
    return (
      <h3
        id={id}
        className="numbered-heading mt-4 mb-1.5 text-lg leading-tight font-medium text-[var(--theme-text)] text-balance first:mt-0"
      >
        <a
          href={`#${id}`}
          className="group/heading inline-flex items-center gap-1 no-underline text-[var(--theme-text)]"
        >
          <span>{children}</span>
          <span
            aria-hidden="true"
            className="text-[var(--theme-muted)] opacity-0 transition-opacity group-hover/heading:opacity-100 group-hover/heading:text-[var(--theme-accent)]"
          >
            #
          </span>
        </a>
      </h3>
    )
  },
  h4: function H4Component({ children }) {
    return (
      <h4 className="mt-4 mb-1.5 text-base leading-tight font-medium text-[var(--theme-text)] text-balance first:mt-0">
        {children}
      </h4>
    )
  },
  h5: function H5Component({ children }) {
    return (
      <h5 className="mt-3.5 mb-1 text-sm leading-tight font-medium text-[var(--theme-text)] text-balance first:mt-0">
        {children}
      </h5>
    )
  },
  h6: function H6Component({ children }) {
    return (
      <h6 className="mt-3.5 mb-1 text-sm leading-tight font-medium text-[var(--theme-muted)] text-balance first:mt-0">
        {children}
      </h6>
    )
  },
  p: function PComponent({ children }) {
    return (
      <p className="text-[var(--theme-text)] text-pretty leading-relaxed">
        {children}
      </p>
    )
  },
  ul: function UlComponent({ children }) {
    return (
      <ul className="ml-4 list-disc text-[var(--theme-text)] marker:text-[var(--theme-muted)]">
        {children}
      </ul>
    )
  },
  ol: function OlComponent({ children }) {
    return (
      <ol className="ml-4 list-decimal text-[var(--theme-text)] marker:text-[var(--theme-muted)]">
        {children}
      </ol>
    )
  },
  li: function LiComponent({ children }) {
    return <li className="leading-relaxed">{children}</li>
  },
  a: function AComponent({ children, href }) {
    const safeHref = isSafeHref(href) ? href : undefined
    return (
      <a
        href={safeHref}
        className="text-[var(--theme-accent)] underline decoration-[var(--theme-accent)]/40 underline-offset-4 transition-colors hover:text-[var(--theme-accent)] hover:decoration-[var(--theme-accent)]"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  },
  blockquote: function BlockquoteComponent({ children }) {
    const { type, content } = extractCallout(children)

    if (type) {
      const config = CALLOUT_CONFIG[type]
      const Icon = config.icon

      return (
        <div
          role="region"
          aria-label={`${config.label} callout`}
          data-callout-type={config.label}
          className={cn(
            'my-3 rounded-lg border px-4 py-3 shadow-xs',
            config.cardClass,
          )}
        >
          <div className="flex items-center gap-2 mb-2 font-mono text-xs font-semibold tracking-wider uppercase">
            <Icon
              className={cn('h-4 w-4 shrink-0', config.iconClass)}
              aria-hidden="true"
            />
            <span
              className={cn(
                'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono font-semibold tracking-wide',
                config.badgeClass,
              )}
            >
              {config.label}
            </span>
          </div>
          <div className="text-sm leading-relaxed text-[var(--theme-text)] [&>p:last-child]:mb-0 [&>p]:my-1">
            {content}
          </div>
        </div>
      )
    }

    return (
      <blockquote className="my-2 border-l-2 border-[var(--theme-border)] pl-4 italic text-[var(--theme-muted)]">
        {children}
      </blockquote>
    )
  },
  strong: function StrongComponent({ children }) {
    return (
      <strong className="font-semibold text-[var(--theme-text)]">
        {children}
      </strong>
    )
  },
  em: function EmComponent({ children }) {
    return <em className="italic text-[var(--theme-text)]">{children}</em>
  },
  hr: function HrComponent() {
    return <hr className="my-3 border-[var(--theme-border)]" />
  },
  table: function TableComponent({ children }) {
    const tableRef = useRef<HTMLTableElement>(null)
    const [copied, setCopied] = useState(false)
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleCopy = useCallback(async () => {
      const el = tableRef.current
      if (!el) return
      const markdown = tableElementToMarkdown(el)
      try {
        await writeRichTextToClipboard(el.outerHTML, markdown)
        setCopied(true)
        if (resetTimer.current) clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => setCopied(false), 1500)
      } catch {
        // Clipboard unavailable — leave the button state unchanged.
      }
    }, [])

    return (
      <div className="group relative my-3">
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Table copied' : 'Copy table'}
          title={copied ? 'Copied' : 'Copy table'}
          className="absolute right-1.5 top-1.5 z-20 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-card)]/80 text-[var(--theme-muted)] opacity-0 backdrop-blur transition-opacity hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <div className="max-w-full overflow-x-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-xs">
          <table
            ref={tableRef}
            className="w-full min-w-max border-collapse text-sm sm:min-w-full text-[var(--theme-text)]"
          >
            {children}
          </table>
        </div>
      </div>
    )
  },
  thead: function TheadComponent({ children }) {
    return (
      <thead className="sticky top-0 z-10 border-b border-[var(--theme-border)] bg-[var(--theme-card2)] font-mono text-xs text-[var(--theme-muted)] uppercase tracking-wider backdrop-blur-xs max-sm:hidden">
        {children}
      </thead>
    )
  },
  tbody: function TbodyComponent({ children }) {
    return (
      <tbody className="divide-y divide-[var(--theme-border)]/40 max-sm:block max-sm:divide-y-0">
        {children}
      </tbody>
    )
  },
  tr: function TrComponent({ children }) {
    return (
      <tr className="odd:bg-[var(--theme-card)] even:bg-[var(--theme-card2)] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent)_6%,var(--theme-card))] max-sm:mb-3 max-sm:block max-sm:overflow-hidden max-sm:rounded-lg max-sm:border max-sm:border-[var(--theme-border)] max-sm:bg-[var(--theme-card)]">
        {children}
      </tr>
    )
  },
  th: function ThComponent({ children }) {
    return (
      <th className="border-r border-[var(--theme-border)]/60 px-3 py-2 text-left font-mono font-medium text-[var(--theme-text)] text-xs uppercase tracking-wider whitespace-nowrap last:border-r-0 max-sm:border-r-0">
        {children}
      </th>
    )
  },
  td: function TdComponent({ children }) {
    const rawText = textFromNode(children).trim()
    const verdict = getVerdictBadge(rawText)

    if (verdict) {
      const badgeClass =
        verdict.variant === 'accent'
          ? 'border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_15%,transparent)] text-[var(--theme-accent)]'
          : verdict.variant === 'success'
            ? 'border-[color-mix(in_srgb,var(--theme-success,#22c55e)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-success,#22c55e)_15%,transparent)] text-[var(--theme-success,#22c55e)]'
            : 'border-[color-mix(in_srgb,var(--theme-danger,#ef4444)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger,#ef4444)_15%,transparent)] text-[var(--theme-danger,#ef4444)]'

      return (
        <td
          className={cn(
            'border-r border-[var(--theme-border)]/40 px-3 py-2 align-middle last:border-r-0',
            'text-left font-mono text-xs',
            'max-sm:grid max-sm:grid-cols-[minmax(0,9rem)_1fr] max-sm:gap-3 max-sm:border-b max-sm:border-[var(--theme-border)]/40 max-sm:px-3 max-sm:py-2 max-sm:last:border-b-0 max-sm:before:content-[attr(data-label)] max-sm:before:text-xs max-sm:before:font-medium max-sm:before:text-[var(--theme-muted)]',
          )}
        >
          <span
            data-verdict={verdict.label}
            className={cn(
              'inline-flex items-center justify-center rounded px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide border shadow-xs',
              badgeClass,
            )}
          >
            {verdict.label}
          </span>
        </td>
      )
    }

    const isNumeric = isNumericCell(rawText)

    return (
      <td
        className={cn(
          'border-r border-[var(--theme-border)]/40 px-3 py-2 text-[var(--theme-text)] align-top last:border-r-0',
          isNumeric ? 'text-right font-mono tabular-nums' : 'text-left',
          'max-sm:grid max-sm:grid-cols-[minmax(0,9rem)_1fr] max-sm:gap-3 max-sm:border-b max-sm:border-[var(--theme-border)]/40 max-sm:px-3 max-sm:py-2 max-sm:last:border-b-0 max-sm:before:content-[attr(data-label)] max-sm:before:text-xs max-sm:before:font-medium max-sm:before:text-[var(--theme-muted)]',
        )}
      >
        {children}
      </td>
    )
  },
  tfoot: function TfootComponent({ children }) {
    return (
      <tfoot className="border-t border-[var(--theme-border)] bg-[var(--theme-card2)]/50">
        {children}
      </tfoot>
    )
  },
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    components?: Partial<Components>
  }) {
    return (
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        components={components}
      >
        {content}
      </ReactMarkdown>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content
  },
)

MemoizedMarkdownBlock.displayName = 'MemoizedMarkdownBlock'

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const normalizedChildren = useMemo(
    () => rewriteLocalMediaSources(children),
    [children],
  )
  const blocks = useMemo(
    () => parseMarkdownIntoBlocks(normalizedChildren),
    [normalizedChildren],
  )

  return (
    <div
      className={cn(
        'numbered-sections flex flex-col gap-2 break-words overflow-hidden text-[var(--theme-text)]',
        className,
      )}
    >
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = 'Markdown'

export { Markdown }
