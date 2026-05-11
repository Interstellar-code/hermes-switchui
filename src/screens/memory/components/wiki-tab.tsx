/**
 * WikiTab — Wiki tab body for the Memory screen (MEM-05).
 *
 * Left rail: paginated + search-filtered wiki list (grouped by directory).
 * Right pane: markdown body viewer with backlinks.
 * + New page CTA → modal with title + body fields.
 * Edit existing page → same modal pre-populated.
 * Delete via ConfirmDialog.
 */

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { toast as showToast } from '@/components/ui/toast'
import type { WikiPageMeta } from '@/server/knowledge-browser'

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

async function apiPost(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || payload.error) throw new Error(payload.error ?? `Request failed (${res.status})`)
}

async function apiDelete(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || payload.error) throw new Error(payload.error ?? `Request failed (${res.status})`)
}

// ── Markdown mini-renderer ────────────────────────────────────────────────────

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  for (const ln of lines) {
    const esc = ln.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (/^# /.test(ln)) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h1>${esc.slice(2)}</h1>`)
    } else if (/^## /.test(ln)) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h2>${esc.slice(3)}</h2>`)
    } else if (/^### /.test(ln)) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h3>${esc.slice(4)}</h3>`)
    } else if (/^[-*] /.test(ln)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${esc.slice(2)}</li>`)
    } else if (ln.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('<br/>')
    } else {
      if (inList) { out.push('</ul>'); inList = false }
      // inline code
      const withCode = esc.replace(/`([^`]+)`/g, '<code>$1</code>')
      out.push(`<p>${withCode}</p>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

// ── Page modal ────────────────────────────────────────────────────────────────

type PageModalProps = {
  initialPath?: string
  initialContent?: string
  onClose: () => void
  onSaved: () => void
}

function PageModal({ initialPath, initialContent, onClose, onSaved }: PageModalProps) {
  const [pagePath, setPagePath] = useState(initialPath ?? '')
  const [content, setContent] = useState(initialContent ?? '')
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

  async function handleSave() {
    const p = pagePath.trim().endsWith('.md') ? pagePath.trim() : `${pagePath.trim()}.md`
    if (!p || p === '.md') {
      showToast('Page path is required')
      return
    }
    setSaving(true)
    try {
      await apiPost('/api/knowledge/write', { path: p, content })
      showToast(isEdit ? `Updated ${p}` : `Created ${p}`)
      onSaved()
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save page')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="mem-modal-backdrop" onClick={onClose}>
      <div className="mem-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{isEdit ? 'Edit Page' : 'New Wiki Page'}</h3>
        <div className="mem-modal-field">
          <label className="mem-modal-label" htmlFor="wiki-page-path">Path</label>
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
          <label className="mem-modal-label" htmlFor="wiki-page-content">Content (Markdown)</label>
          <textarea
            id="wiki-page-content"
            className="mem-modal-textarea"
            placeholder="# Page Title&#10;&#10;Content here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="mem-modal-actions">
          <button type="button" className="mem-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="mem-btn is-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Page'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── WikiTab ───────────────────────────────────────────────────────────────────

type ListResponse = { pages: WikiPageMeta[]; exists: boolean; source: unknown }
type ReadResponse = { page: WikiPageMeta; content: string; backlinks: string[] }

export function WikiTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<{ path: string; content: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const listQuery = useQuery<ListResponse>({
    queryKey: ['knowledge', 'list'],
    queryFn: () => apiFetch('/api/knowledge/list'),
    staleTime: 30_000,
  })

  const pageQuery = useQuery<ReadResponse>({
    queryKey: ['knowledge', 'read', selectedPath],
    queryFn: () => apiFetch(`/api/knowledge/read?path=${encodeURIComponent(selectedPath!)}`),
    enabled: !!selectedPath,
    staleTime: 15_000,
  })

  const pages = listQuery.data?.pages ?? []
  const filtered = search
    ? pages.filter((p) =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase()),
      )
    : pages

  // Auto-select first page
  useEffect(() => {
    if (!selectedPath && filtered.length > 0 && filtered[0]) {
      setSelectedPath(filtered[0].path)
    }
  }, [filtered, selectedPath])

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await apiDelete('/api/knowledge/write', { path: deleteTarget })
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
    setEditTarget({ path: pageQuery.data.page.path, content: pageQuery.data.content })
  }

  const page = pageQuery.data?.page
  const content = pageQuery.data?.content ?? ''
  const backlinks = pageQuery.data?.backlinks ?? []

  // group pages by directory
  type Group = { dir: string; pages: WikiPageMeta[]; open: boolean }
  const groups: Group[] = []
  const dirMap = new Map<string, Group>()
  for (const p of filtered) {
    const slash = p.path.indexOf('/')
    const dir = slash >= 0 ? p.path.slice(0, slash) : '.'
    let grp = dirMap.get(dir)
    if (!grp) {
      grp = { dir, pages: [], open: true }
      dirMap.set(dir, grp)
      groups.push(grp)
    }
    grp.pages.push(p)
  }

  return (
    <div className="wiki-grid">
      {/* Left rail */}
      <aside className="wiki-tree">
        <div className="wiki-tree-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5"/>
            <path d="M10.5 10.5l3 3" strokeLinecap="round"/>
          </svg>
          <input
            placeholder="search wiki…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search wiki pages"
          />
        </div>

        <div className="wiki-tree-actions">
          <button type="button" className="mem-btn is-primary wiki-new-btn" onClick={() => setShowAdd(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" strokeLinecap="round"/>
            </svg>
            New Page
          </button>
        </div>

        {listQuery.isLoading && <div className="mem-loading">Loading…</div>}
        {listQuery.isError && (
          <div className="wiki-tree-error">Failed to load wiki</div>
        )}
        {!listQuery.isLoading && !listQuery.isError && filtered.length === 0 && (
          <div className="wiki-tree-empty">
            {search ? 'No results' : 'No wiki pages yet'}
          </div>
        )}

        {groups.map((grp) => (
          <div key={grp.dir} className="wiki-group">
            {grp.dir !== '.' && (
              <div className="wiki-group-label">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M2 4h4l2 2h6v7H2V4z"/>
                </svg>
                {grp.dir}
                <span className="wiki-group-ct">{grp.pages.length}</span>
              </div>
            )}
            {grp.pages.map((p) => (
              <button
                key={p.path}
                type="button"
                className={`wiki-page-item ${p.path === selectedPath ? 'is-active' : ''} ${grp.dir !== '.' ? 'indent' : ''}`}
                onClick={() => setSelectedPath(p.path)}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M3 2h6l4 4v9H3V2z" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 2v4h4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="wiki-page-name">{p.title}</span>
                {backlinks.length > 0 && p.path === selectedPath && (
                  <span className="wiki-page-ct">{backlinks.length}↗</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* Right pane */}
      <section className="wiki-reader">
        {pageQuery.isLoading && <div className="mem-loading">Loading page…</div>}
        {pageQuery.isError && (
          <div className="wiki-reader-error">Failed to load page</div>
        )}
        {!selectedPath && !pageQuery.isLoading && (
          <div className="wiki-reader-empty">Select a page to read</div>
        )}

        {page && !pageQuery.isLoading && !pageQuery.isError && (
          <>
            <div className="crumbs">
              Wiki <span>/ {page.path}</span>
            </div>
            <h1>{page.title}</h1>
            <div className="meta">
              {page.type && <span>type <b>{page.type}</b></span>}
              {page.updated && <span>updated <b>{page.updated.slice(0, 10)}</b></span>}
              {page.size != null && <span>size <b>{page.size}B</b></span>}
              {page.tags.length > 0 && <span>tags <b>{page.tags.join(', ')}</b></span>}
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

            {/* eslint-disable-next-line react/no-danger */}
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />

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
          onClose={() => setShowAdd(false)}
          onSaved={() => void qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })}
        />
      )}
      {editTarget && (
        <PageModal
          initialPath={editTarget.path}
          initialContent={editTarget.content}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
            void qc.invalidateQueries({ queryKey: ['knowledge', 'read', editTarget.path] })
            setEditTarget(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Wiki Page"
        message={`Delete "${deleteTarget}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
