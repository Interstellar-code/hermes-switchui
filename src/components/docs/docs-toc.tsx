import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

type TocItem = { id: string; text: string; level: number }
type NumberedTocItem = TocItem & { number: string }

function parseHeadings(content: string): Array<TocItem> {
  const items: Array<TocItem> = []
  const lines = content.split('\n')
  let inFence = false
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = line.match(/^(#{2,3})\s+(.+)/)
    if (match) {
      const level = match[1].length
      const text = match[2].trim().replace(/[#*_`]/g, '')
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      items.push({ id, text, level })
    }
  }
  return items
}

function numberHeadings(items: Array<TocItem>): Array<NumberedTocItem> {
  let h2 = 0
  let h3 = 0
  return items.map((item) => {
    if (item.level === 2) {
      h2++
      h3 = 0
      return { ...item, number: `${h2}.` }
    }
    h3++
    return { ...item, number: `${h2}.${h3}` }
  })
}

const COLLAPSE_KEY = 'docs-toc-collapsed'

export function DocsToc({ content }: { content: string }) {
  const headings = useMemo(
    () => numberHeadings(parseHeadings(content)),
    [content],
  )
  const [activeId, setActiveId] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(COLLAPSE_KEY)
    if (stored === '1') setCollapsed(true)
  }, [])

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      }
      return next
    })
  }

  useEffect(() => {
    if (headings.length === 0) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '-80px 0px -80% 0px' },
    )
    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  if (collapsed) {
    return (
      <nav className="docs-toc sticky top-6 hidden w-8 shrink-0 self-start xl:block">
        <button
          type="button"
          onClick={toggle}
          aria-label="Expand table of contents"
          className="flex h-8 w-8 items-center justify-center rounded border border-[var(--theme-border)] text-[var(--theme-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)] hover:text-[var(--theme-accent)]"
        >
          ‹
        </button>
      </nav>
    )
  }

  return (
    <nav className="docs-toc sticky top-6 hidden max-h-[calc(100vh-3rem)] w-56 shrink-0 self-start overflow-y-auto xl:block">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
          On this page
        </p>
        <button
          type="button"
          onClick={toggle}
          aria-label="Collapse table of contents"
          className="rounded px-1.5 text-xs text-[var(--theme-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--theme-accent)_10%,transparent)] hover:text-[var(--theme-accent)]"
        >
          ›
        </button>
      </div>
      <ul className="space-y-1">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                'flex gap-2 text-sm leading-6 text-[var(--theme-muted)] transition-colors hover:text-[var(--theme-text)]',
                h.level === 3 && 'pl-4',
                activeId === h.id &&
                  'font-medium text-[var(--theme-accent)]',
              )}
            >
              <span className="shrink-0 opacity-60 tabular-nums">
                {h.number}
              </span>
              <span className="truncate">{h.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
