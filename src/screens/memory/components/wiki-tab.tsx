/**
 * WikiTab — Wiki tab body for the Memory screen (MEM-05).
 *
 * Left rail: wiki list (grouped by directory) with type/tag/meta filters;
 *   typing in search switches to full-text hits from /api/knowledge/search.
 * Right pane: react-markdown body with clickable [[wikilinks]] + backlinks.
 * Edits send the loaded mtime; a 409 offers overwrite / reload.
 * + New page CTA → modal with title + body fields.
 * Edit existing page → same modal pre-populated.
 * Delete via ConfirmDialog.
 */

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import { MemoryDetailDrawer } from './memory-detail-drawer'
import { useWikiFocusStore } from './wiki-focus-store'
import {
  lookupWikilink,
  resolveRelativeWikiHref,
  wikilinkKeyFromHref,
  wikilinksToMarkdown,
} from './wiki-links'
import type {
  KnowledgeSearchHit,
  WikiPageMeta,
} from '@/server/knowledge-browser'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { toast as showToast } from '@/components/ui/toast'
import { useMemoryScreenStore } from '@/stores/memory-screen-store'
import '@/styles/memory-wiki.css'

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

class ConflictError extends Error {}

async function apiPost(
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409) throw new ConflictError(payload.error)
  if (!res.ok || payload.error)
    throw new Error(payload.error ?? `Request failed (${res.status})`)
}

async function apiDelete(
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || payload.error)
    throw new Error(payload.error ?? `Request failed (${res.status})`)
}

// Root-level wiki bookkeeping pages (matrix-memory convention), hidden by default.
const META_PAGE = /^(index|log|schema)\.md$/i
// rehype-slug heading ids, prefixed so page content can't clobber app DOM ids.
const HEADING_ID_PREFIX = 'wiki-h-'

/** Append the memory profile to a knowledge API URL. */
function withProfile(url: string, profile: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
}

// ── Page modal ────────────────────────────────────────────────────────────────

type PageModalProps = {
  initialPath?: string
  initialContent?: string
  /** `modified` of the loaded page; sent so the server can 409 on a stale save. */
  initialModified?: string
  profile: string
  onClose: () => void
  onSaved: () => void
}

function PageModal({
  initialPath,
  initialContent,
  initialModified,
  profile,
  onClose,
  onSaved,
}: PageModalProps) {
  const [pagePath, setPagePath] = useState(initialPath ?? '')
  const [content, setContent] = useState(initialContent ?? '')
  const [modified, setModified] = useState(initialModified)
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isEdit = !!initialPath

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleReload() {
    if (!initialPath) return
    try {
      const latest = await apiFetch<ReadResponse>(
        withProfile(
          `/api/knowledge/read?path=${encodeURIComponent(initialPath)}`,
          profile,
        ),
      )
      setContent(latest.raw)
      setModified(latest.page.modified)
      setConflict(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reload page')
    }
  }

  async function handleSave(overwrite = false) {
    const p = pagePath.trim().endsWith('.md')
      ? pagePath.trim()
      : `${pagePath.trim()}.md`
    if (!p || p === '.md') {
      showToast('Page path is required')
      return
    }
    setSaving(true)
    try {
      await apiPost('/api/knowledge/write', {
        path: p,
        content,
        profile,
        ...(isEdit
          ? overwrite
            ? {}
            : { expectedModified: modified }
          : { createOnly: true }),
      })
      showToast(isEdit ? `Updated ${p}` : `Created ${p}`)
      onSaved()
      onClose()
    } catch (err) {
      if (err instanceof ConflictError && isEdit) setConflict(true)
      else showToast(err instanceof Error ? err.message : 'Failed to save page')
    } finally {
      setSaving(false)
    }
  }

  // Portaled outside the screen: re-enter the [data-screen='memory'] CSS scope.
  return createPortal(
    <div data-screen="memory">
      <div className="mem-modal-backdrop" onClick={onClose}>
        <div
          className="mem-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <h3>{isEdit ? 'Edit Page' : 'New Matrix Wiki Page'}</h3>
          <div className="mem-modal-field">
            <label className="mem-modal-label" htmlFor="wiki-page-path">
              Path
            </label>
            <input
              id="wiki-page-path"
              ref={inputRef}
              className="mem-modal-input"
              placeholder="e.g. engineering/react-patterns.md"
              value={pagePath}
              onChange={(e) => setPagePath(e.target.value)}
              disabled={isEdit}
            />
          </div>
          <div className="mem-modal-field">
            <label className="mem-modal-label" htmlFor="wiki-page-content">
              Content (Markdown)
            </label>
            <textarea
              id="wiki-page-content"
              className="mem-modal-textarea"
              placeholder="# Page Title&#10;&#10;Content here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          {conflict && (
            <div className="wiki-conflict" role="alert">
              <span>
                This page changed on disk after you opened it. Overwrite those
                changes, or reload the latest version (discards your edits)?
              </span>
              <button
                type="button"
                className="mem-btn mem-btn-danger"
                onClick={() => void handleSave(true)}
                disabled={saving}
              >
                Overwrite
              </button>
              <button
                type="button"
                className="mem-btn"
                onClick={() => void handleReload()}
                disabled={saving}
              >
                Reload
              </button>
            </div>
          )}
          <div className="mem-modal-actions">
            <button
              type="button"
              className="mem-btn"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mem-btn is-primary"
              onClick={() => void handleSave()}
              disabled={saving || conflict}
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Page'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── WikiTab ───────────────────────────────────────────────────────────────────

type ListResponse = {
  pages: Array<WikiPageMeta>
  exists: boolean
  source: unknown
}
type ReadResponse = {
  page: WikiPageMeta
  content: string
  raw: string
  backlinks: Array<string>
  links?: Record<string, string | null>
}

export function WikiTab() {
  const qc = useQueryClient()
  const profile = useMemoryScreenStore((s) => s.profile)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const [typeFilter, setTypeFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showMeta, setShowMeta] = useState(false)
  // Map "Open in Wiki" / header search hand off a page path; apply whenever
  // set (mounted or not), then clear so it never re-applies stale.
  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => useWikiFocusStore.getState().path,
  )
  const focusPath = useWikiFocusStore((st) => st.path)
  useEffect(() => {
    if (!focusPath) return
    setSelectedPath(focusPath)
    useWikiFocusStore.getState().setPath(null)
  }, [focusPath])
  // Switching profile switches wiki roots; the open page belongs to the old one.
  const profileRef = useRef(profile)
  useEffect(() => {
    if (profileRef.current === profile) return
    profileRef.current = profile
    setSelectedPath(null)
  }, [profile])
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<{
    path: string
    content: string
    modified: string
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const listQuery = useQuery<ListResponse>({
    queryKey: ['knowledge', 'list', profile],
    queryFn: () => apiFetch(withProfile('/api/knowledge/list', profile)),
    staleTime: 30_000,
  })

  const pageQuery = useQuery<ReadResponse>({
    queryKey: ['knowledge', 'read', selectedPath, profile],
    queryFn: () =>
      apiFetch(
        withProfile(
          `/api/knowledge/read?path=${encodeURIComponent(selectedPath!)}`,
          profile,
        ),
      ),
    enabled: !!selectedPath,
    staleTime: 15_000,
  })

  const searchQuery = useQuery<{ results: Array<KnowledgeSearchHit> }>({
    queryKey: ['knowledge', 'search', debouncedSearch, profile],
    queryFn: () =>
      apiFetch(
        withProfile(
          `/api/knowledge/search?q=${encodeURIComponent(debouncedSearch)}`,
          profile,
        ),
      ),
    enabled: debouncedSearch.length > 0,
    staleTime: 15_000,
  })
  const searching = search.trim().length > 0

  const pages = listQuery.data?.pages ?? []
  const pageByPath = new Map(pages.map((p) => [p.path, p]))
  const types = [...new Set(pages.flatMap((p) => (p.type ? [p.type] : [])))]
  const tags = [...new Set(pages.flatMap((p) => p.tags))].sort()
  const passesFilters = (p: WikiPageMeta) =>
    (showMeta || !META_PAGE.test(p.path)) &&
    (!typeFilter || p.type === typeFilter) &&
    (!tagFilter || p.tags.includes(tagFilter))
  const filtered = pages.filter(passesFilters)
  const hits = (searchQuery.data?.results ?? []).filter((h) => {
    const meta = pageByPath.get(h.path)
    return !meta || passesFilters(meta)
  })

  // Auto-select first page
  useEffect(() => {
    if (!selectedPath && filtered.length > 0 && filtered[0]) {
      setSelectedPath(filtered[0].path)
    }
  }, [filtered, selectedPath])

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await apiDelete('/api/knowledge/write', { path: deleteTarget, profile })
      showToast(`Deleted ${deleteTarget}`)
      if (selectedPath === deleteTarget) setSelectedPath(null)
      void qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete page')
    } finally {
      setDeleteTarget(null)
    }
  }

  function handleEdit() {
    if (!pageQuery.data) return
    setEditTarget({
      path: pageQuery.data.page.path,
      // raw keeps the frontmatter (title/type/tags) so saving doesn't drop it.
      content: pageQuery.data.raw,
      modified: pageQuery.data.page.modified,
    })
  }

  const page = pageQuery.data?.page
  const content = pageQuery.data?.content ?? ''
  const backlinks = pageQuery.data?.backlinks ?? []
  const links = pageQuery.data?.links ?? {}

  // group pages by directory
  type Group = { dir: string; pages: Array<WikiPageMeta> }
  const groups: Array<Group> = []
  const dirMap = new Map<string, Group>()
  for (const p of filtered) {
    const slash = p.path.indexOf('/')
    const dir = slash >= 0 ? p.path.slice(0, slash) : '.'
    let grp = dirMap.get(dir)
    if (!grp) {
      grp = { dir, pages: [] }
      dirMap.set(dir, grp)
      groups.push(grp)
    }
    grp.pages.push(p)
  }

  function isGroupOpen(dir: string): boolean {
    return groupOpen[dir] ?? true
  }

  function toggleGroup(dir: string) {
    setGroupOpen((prev) => ({ ...prev, [dir]: !(prev[dir] ?? true) }))
  }

  return (
    <div className="wiki-grid">
      {/* Left rail */}
      <aside className="wiki-tree">
        <div className="wiki-tree-search">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5l3 3" strokeLinecap="round" />
          </svg>
          <input
            placeholder="search matrix wiki…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search matrix wiki pages"
          />
        </div>

        <div className="wiki-filters">
          {types.length > 0 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by type"
            >
              <option value="">all types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          {tags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Filter by tag"
            >
              <option value="">all tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <label className="wiki-meta-toggle">
            <input
              type="checkbox"
              checked={showMeta}
              onChange={(e) => setShowMeta(e.target.checked)}
            />
            meta pages
          </label>
        </div>

        <div className="wiki-tree-actions">
          <button
            type="button"
            className="mem-btn is-primary wiki-new-btn"
            onClick={() => setShowAdd(true)}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            New Page
          </button>
        </div>

        {listQuery.isLoading && <div className="mem-loading">Loading…</div>}
        {listQuery.isError && (
          <div className="wiki-tree-error">Failed to load matrix wiki</div>
        )}
        {!listQuery.isLoading &&
          !listQuery.isError &&
          !searching &&
          filtered.length === 0 && (
            <div className="wiki-tree-empty">
              {pages.length > 0
                ? 'No pages match these filters'
                : 'No matrix wiki pages yet'}
            </div>
          )}

        {searching && (
          <div className="wiki-search-results">
            {searchQuery.isFetching && hits.length === 0 && (
              <div className="mem-loading">Searching…</div>
            )}
            {searchQuery.isError && (
              <div className="wiki-tree-error">Search failed</div>
            )}
            {!searchQuery.isFetching &&
              !searchQuery.isError &&
              debouncedSearch &&
              hits.length === 0 && (
                <div className="wiki-tree-empty">No results</div>
              )}
            {hits.map((h) => (
              <button
                key={h.path}
                type="button"
                className={`wiki-search-hit ${h.path === selectedPath ? 'is-active' : ''}`}
                onClick={() => setSelectedPath(h.path)}
              >
                <span className="wiki-page-name">{h.title}</span>
                <span className="wiki-search-path">{h.path}</span>
                {h.text && (
                  <span className="wiki-search-snippet">{h.text}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {!searching &&
          groups.map((grp) => (
            <div key={grp.dir} className="wiki-group">
              {grp.dir !== '.' && (
                <button
                  type="button"
                  className={`wiki-group-label ${isGroupOpen(grp.dir) ? '' : 'is-collapsed'}`}
                  onClick={() => toggleGroup(grp.dir)}
                  aria-expanded={isGroupOpen(grp.dir)}
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                    className="wiki-group-chevron"
                  >
                    <path
                      d="M6 3l4 5-4 5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M2 4h4l2 2h6v7H2V4z" />
                  </svg>
                  <span>{grp.dir}</span>
                  <span className="wiki-group-ct">{grp.pages.length}</span>
                </button>
              )}
              {(grp.dir === '.' || isGroupOpen(grp.dir)) &&
                grp.pages.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    className={`wiki-page-item ${p.path === selectedPath ? 'is-active' : ''} ${grp.dir !== '.' ? 'indent' : ''}`}
                    onClick={() => setSelectedPath(p.path)}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 2h6l4 4v9H3V2z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M9 2v4h4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="wiki-page-name">{p.title}</span>
                    {backlinks.length > 0 && p.path === selectedPath && (
                      <span className="wiki-page-ct">{backlinks.length}↗</span>
                    )}
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="mem-file-detail-icon"
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDrawerPath(p.path)
                        setDrawerOpen(true)
                      }}
                    >
                      <path
                        d="M6 3H3v10h10V9M9 2h5v5M14 2l-7 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
            </div>
          ))}
      </aside>

      {/* Right pane */}
      <section className="wiki-reader">
        {pageQuery.isLoading && (
          <div className="mem-loading">Loading page…</div>
        )}
        {pageQuery.isError && (
          <div className="wiki-reader-error">Failed to load page</div>
        )}
        {!selectedPath && !pageQuery.isLoading && (
          <div className="wiki-reader-empty">Select a page to read</div>
        )}

        {page && !pageQuery.isLoading && !pageQuery.isError && (
          <>
            <div className="crumbs">
              Matrix Wiki <span>/ {page.path}</span>
            </div>
            <h1>{page.title}</h1>
            <div className="meta">
              {page.type && (
                <span>
                  type <b>{page.type}</b>
                </span>
              )}
              {page.updated && (
                <span>
                  updated <b>{page.updated.slice(0, 10)}</b>
                </span>
              )}
              {page.size > 0 && (
                <span>
                  size <b>{page.size}B</b>
                </span>
              )}
              {page.tags.length > 0 && (
                <span>
                  tags <b>{page.tags.join(', ')}</b>
                </span>
              )}
            </div>

            <div className="wiki-reader-actions">
              <button type="button" className="mem-btn" onClick={handleEdit}>
                Edit
              </button>
              <button
                type="button"
                className="mem-btn mem-btn-danger"
                onClick={() => setDeleteTarget(page.path)}
              >
                Delete
              </button>
            </div>

            <div className="wiki-md">
              {/* No rehype-raw: raw HTML in pages renders as text, and
                  react-markdown's default urlTransform drops javascript: URLs. */}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeSlug, { prefix: HEADING_ID_PREFIX }]]}
                components={{
                  a: ({ href, children }) => {
                    if (href?.startsWith('#') && !href.startsWith('#wiki/')) {
                      // In-page anchor: scroll, don't touch the router URL.
                      return (
                        <a
                          href={href}
                          onClick={(e) => {
                            e.preventDefault()
                            let id = href.slice(1)
                            try {
                              id = decodeURIComponent(id)
                            } catch {
                              // keep the raw fragment
                            }
                            document
                              .getElementById(HEADING_ID_PREFIX + id)
                              ?.scrollIntoView({ block: 'start' })
                          }}
                        >
                          {children}
                        </a>
                      )
                    }
                    const relative = resolveRelativeWikiHref(href, page.path)
                    const key = wikilinkKeyFromHref(href)
                    if (key === null && !relative) {
                      return (
                        <a href={href} target="_blank" rel="noreferrer">
                          {children}
                        </a>
                      )
                    }
                    const missingName = relative ? relative.path : key
                    const target = relative
                      ? pageByPath.has(relative.path)
                        ? relative.path
                        : null
                      : key !== null
                        ? lookupWikilink(links, key)
                        : null
                    if (!target) {
                      return (
                        <span
                          className="wiki-link is-missing"
                          title={`No page named "${missingName}"`}
                        >
                          {children}
                        </span>
                      )
                    }
                    return (
                      <button
                        type="button"
                        className="wiki-link"
                        title={target}
                        onClick={() => setSelectedPath(target)}
                      >
                        {children}
                      </button>
                    )
                  },
                }}
              >
                {wikilinksToMarkdown(content)}
              </ReactMarkdown>
            </div>

            {backlinks.length > 0 && (
              <div className="backlinks">
                <h3>Backlinks · {backlinks.length}</h3>
                {backlinks.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="wiki-backlink-btn"
                    onClick={() => setSelectedPath(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Modals */}
      {showAdd && (
        <PageModal
          profile={profile}
          onClose={() => setShowAdd(false)}
          onSaved={() =>
            void qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
          }
        />
      )}
      {editTarget && (
        <PageModal
          initialPath={editTarget.path}
          initialContent={editTarget.content}
          initialModified={editTarget.modified}
          profile={profile}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
            void qc.invalidateQueries({
              queryKey: ['knowledge', 'read', editTarget.path],
            })
            setEditTarget(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Matrix Wiki Page"
        message={`Delete "${deleteTarget}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <MemoryDetailDrawer
        item={drawerPath ? { kind: 'wiki-page', path: drawerPath } : null}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onDeleted={() => {
          void qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
          if (selectedPath === drawerPath) setSelectedPath(null)
          setDrawerPath(null)
        }}
      />
    </div>
  )
}
