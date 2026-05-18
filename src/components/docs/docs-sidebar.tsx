import { useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

type DocNavItem = { slug: string; title: string }
type DocFolder = { name: string; pages: Array<DocNavItem> }
export type DocsTree = { rootPages: Array<DocNavItem>; folders: Array<DocFolder> }

const selectPathname = (s: { location: { pathname: string } }) =>
  s.location.pathname

function matches(item: DocNavItem, q: string): boolean {
  const lower = q.toLowerCase()
  return (
    item.title.toLowerCase().includes(lower) ||
    item.slug.toLowerCase().includes(lower)
  )
}

export function DocsSidebar({ tree }: { tree: DocsTree }) {
  const pathname = useRouterState({ select: selectPathname })
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Cmd/Ctrl+K focuses the search input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function isActive(slug: string) {
    return pathname === `/docs/${slug}` || pathname === `/docs/${slug}/`
  }

  // Compute stable original indices and apply filter
  const q = query.trim()

  // Total published page count for header chip
  const totalPages = tree.rootPages.length + tree.folders.reduce((acc, f) => acc + f.pages.length, 0)

  // Build a flat numbering index: rootPages get 1,2,3... then folders continue
  // Numbers are stable (based on original order, not filtered order)
  const rootPageNumbers = tree.rootPages.map((_, i) => i + 1)
  const folderStartIndex = tree.rootPages.length + 1

  // Filtered root pages — keep stable number
  const filteredRootPages = tree.rootPages
    .map((page, i) => ({ page, num: rootPageNumbers[i] }))
    .filter(({ page }) => !q || matches(page, q))

  // Filtered folders — folder number = folderStartIndex + folder original index
  const filteredFolders = tree.folders
    .map((folder, fi) => {
      const folderNum = folderStartIndex + fi
      const filteredPages = folder.pages
        .map((page, pi) => ({ page, num: pi + 1 }))
        .filter(({ page }) => !q || matches(page, q))
      return { folder, folderNum, filteredPages }
    })
    .filter(({ filteredPages }) => !q || filteredPages.length > 0)

  const isEmpty = q && filteredRootPages.length === 0 && filteredFolders.length === 0

  return (
    <aside className={cn('docs-sidebar sk-filter', collapsed && 'collapsed')}>
      {/* Header */}
      <div className="sk-filter-hdr">
        <h2>Docs</h2>
        <span className="ct">{totalPages}</span>
        <button
          type="button"
          className="collapse-btn"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Collapsed rail — vertical label shown when sidebar is collapsed */}
      <div className="sk-rail">
        <span className="rail-label">Docs</span>
        <span className="rail-badge">{totalPages}</span>
      </div>

      {/* Search */}
      <div className="sk-filter-search">
        <div style={{ position: 'relative' }}>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs… ⌘K"
          />
        </div>
      </div>

      {/* Nav tree */}
      <div className="sk-filter-body">
        {isEmpty ? (
          <div className="sk-filter-section">
            <p style={{ fontSize: '11px', color: 'var(--m-text-faint, var(--theme-muted))', margin: 0 }}>
              No results for &ldquo;{q}&rdquo;
            </p>
          </div>
        ) : (
          <>
            {/* Root pages section */}
            {filteredRootPages.length > 0 && (
              <div className="sk-filter-section">
                <div className="sec-label">Pages</div>
                <div className="sk-filter-list">
                  {filteredRootPages.map(({ page, num }) => (
                    <Link
                      key={page.slug}
                      to="/docs/$"
                      params={{ _splat: page.slug }}
                      className={cn('sk-filter-item', isActive(page.slug) && 'active')}
                    >
                      <span className="docs-item-num">{num}.</span>
                      <span className="docs-item-title">{page.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Folders — one section per folder */}
            {filteredFolders.map(({ folder, folderNum, filteredPages }) => {
              const open = q ? true : expanded.has(folder.name)
              const folderLabel = folder.name.split('/').pop()?.replace(/-/g, ' ') ?? folder.name
              return (
                <div key={folder.name} className="sk-filter-section">
                  <button
                    type="button"
                    onClick={() => !q && toggle(folder.name)}
                    className={cn('sk-filter-item docs-folder-hdr', q && 'docs-folder-hdr--search')}
                  >
                    <span className="docs-item-num">{folderNum}.</span>
                    <span className="docs-item-title">{folderLabel}</span>
                    <span className="item-ct">{filteredPages.length}</span>
                    {!q && (
                      <span
                        className="docs-folder-chevron"
                        aria-hidden
                        style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        ›
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="sk-filter-list docs-folder-children">
                      {filteredPages.map(({ page, num }) => (
                        <Link
                          key={page.slug}
                          to="/docs/$"
                          params={{ _splat: page.slug }}
                          className={cn('sk-filter-item', isActive(page.slug) && 'active')}
                        >
                          <span className="docs-item-num">{folderNum}.{num}</span>
                          <span className="docs-item-title">{page.title}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </aside>
  )
}
