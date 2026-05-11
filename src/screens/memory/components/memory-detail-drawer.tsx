/**
 * MemoryDetailDrawer — Right-side drawer for Agent Memory files and Wiki pages (MEM-07).
 *
 * Tabs: Overview / Body / Metadata / Raw
 * - Body tab: inline editor, save via existing API
 * - Delete via ConfirmDialog
 *
 * Mirrors the agent-detail-drawer.tsx pattern from profiles.
 */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { toast as showToast } from '@/components/ui/toast'
import type { WikiPageMeta } from '@/server/knowledge-browser'
import type { AgentFileReadResponse } from '@/routes/api/memory/agent-files'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrawerItem =
  | { kind: 'agent-file'; agentId: string; agentName: string; filename: string }
  | { kind: 'wiki-page'; path: string }

type DrawerTab = 'overview' | 'body' | 'metadata' | 'raw'
const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'body', label: 'Body' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'raw', label: 'Raw' },
]

type Props = {
  item: DrawerItem | null
  open: boolean
  onClose: () => void
  onDeleted?: () => void
}

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

// ── Markdown mini-renderer (same as wiki-tab) ─────────────────────────────────

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
      const withCode = esc.replace(/`([^`]+)`/g, '<code>$1</code>')
      out.push(`<p>${withCode}</p>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

// ── Agent file data hook ──────────────────────────────────────────────────────

function useAgentFileData(item: DrawerItem | null) {
  return useQuery<AgentFileReadResponse>({
    queryKey: [
      'agent-file',
      item?.kind === 'agent-file' ? item.agentId : null,
      item?.kind === 'agent-file' ? item.filename : null,
    ],
    queryFn: () => {
      const i = item as Extract<DrawerItem, { kind: 'agent-file' }>
      return apiFetch(
        `/api/memory/agent-files?agent=${encodeURIComponent(i.agentId)}&filename=${encodeURIComponent(i.filename)}`,
      )
    },
    enabled: !!item && item.kind === 'agent-file',
    staleTime: 15_000,
  })
}

type WikiReadResponse = { page: WikiPageMeta; content: string; backlinks: string[] }

function useWikiPageData(item: DrawerItem | null) {
  return useQuery<WikiReadResponse>({
    queryKey: ['knowledge', 'read', item?.kind === 'wiki-page' ? item.path : null],
    queryFn: () => {
      const i = item as Extract<DrawerItem, { kind: 'wiki-page' }>
      return apiFetch(`/api/knowledge/read?path=${encodeURIComponent(i.path)}`)
    },
    enabled: !!item && item.kind === 'wiki-page',
    staleTime: 15_000,
  })
}

// ── Drawer body ───────────────────────────────────────────────────────────────

function DrawerBody({ item, tab, onClose, onDeleted }: {
  item: DrawerItem
  tab: DrawerTab
  onClose: () => void
  onDeleted?: () => void
}) {
  const qc = useQueryClient()
  const agentQuery = useAgentFileData(item)
  const wikiQuery = useWikiPageData(item)

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isAgent = item.kind === 'agent-file'
  const dataQuery = isAgent ? agentQuery : wikiQuery

  const rawContent = isAgent
    ? agentQuery.data?.content ?? ''
    : wikiQuery.data?.content ?? ''

  // Sync draft when content loads or item changes
  useEffect(() => {
    if (!editing) setDraft(rawContent)
  }, [rawContent, editing])

  useEffect(() => {
    setEditing(false)
    setDraft('')
  }, [item.kind === 'agent-file' ? `${item.agentId}/${item.filename}` : item.path])

  async function handleSave() {
    setSaving(true)
    try {
      if (item.kind === 'agent-file') {
        await apiPost('/api/memory/agent-files', {
          agent: item.agentId,
          filename: item.filename,
          content: draft,
        })
        await qc.invalidateQueries({ queryKey: ['agent-file', item.agentId, item.filename] })
        await qc.invalidateQueries({ queryKey: ['agent-files', item.agentId] })
        showToast('Saved')
      } else {
        await apiPost('/api/knowledge/write', { path: item.path, content: draft })
        await qc.invalidateQueries({ queryKey: ['knowledge', 'read', item.path] })
        await qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
        showToast('Saved')
      }
      setEditing(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    try {
      if (item.kind === 'agent-file') {
        await apiDelete('/api/memory/agent-files', { agent: item.agentId, filename: item.filename })
        await qc.invalidateQueries({ queryKey: ['agent-files', item.agentId] })
        showToast(`Deleted ${item.filename}`)
      } else {
        await apiDelete('/api/knowledge/write', { path: item.path })
        await qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
        showToast(`Deleted ${item.path}`)
      }
      setConfirmDelete(false)
      onDeleted?.()
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete')
      setConfirmDelete(false)
    }
  }

  if (dataQuery.isLoading) {
    return <div className="mem-loading">Loading…</div>
  }
  if (dataQuery.isError) {
    return (
      <div className="mdd-error">
        Failed to load.{' '}
        <button type="button" className="mem-btn" onClick={() => void dataQuery.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  if (tab === 'overview') {
    const name = isAgent ? item.filename : (item as Extract<DrawerItem, { kind: 'wiki-page' }>).path
    const size = isAgent ? agentQuery.data?.sizeBytes : wikiQuery.data?.page.size
    const modified = isAgent ? agentQuery.data?.modifiedAt : wikiQuery.data?.page.modified
    const title = isAgent ? item.filename : (wikiQuery.data?.page.title ?? name)

    return (
      <div className="mdd-overview">
        <div className="mdd-overview-title">{title}</div>
        <div className="mdd-overview-path">{name}</div>
        <div className="mdd-overview-meta">
          {size != null && (
            <div className="mdd-meta-row">
              <span className="mdd-meta-key">Size</span>
              <span className="mdd-meta-val">{size} B</span>
            </div>
          )}
          {modified && (
            <div className="mdd-meta-row">
              <span className="mdd-meta-key">Modified</span>
              <span className="mdd-meta-val">{new Date(modified).toLocaleString()}</span>
            </div>
          )}
          {isAgent && (
            <div className="mdd-meta-row">
              <span className="mdd-meta-key">Agent</span>
              <span className="mdd-meta-val">{item.agentName}</span>
            </div>
          )}
          {!isAgent && wikiQuery.data?.page.type && (
            <div className="mdd-meta-row">
              <span className="mdd-meta-key">Type</span>
              <span className="mdd-meta-val">{wikiQuery.data.page.type}</span>
            </div>
          )}
          {!isAgent && wikiQuery.data?.page.tags && wikiQuery.data.page.tags.length > 0 && (
            <div className="mdd-meta-row">
              <span className="mdd-meta-key">Tags</span>
              <span className="mdd-meta-val">{wikiQuery.data.page.tags.join(', ')}</span>
            </div>
          )}
          {!isAgent && wikiQuery.data?.backlinks && wikiQuery.data.backlinks.length > 0 && (
            <div className="mdd-meta-row">
              <span className="mdd-meta-key">Backlinks</span>
              <span className="mdd-meta-val">{wikiQuery.data.backlinks.length}</span>
            </div>
          )}
        </div>
        <div className="mdd-overview-actions">
          <button type="button" className="mem-btn" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
        <ConfirmDialog
          open={confirmDelete}
          title="Delete"
          message={`Delete "${name}"? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      </div>
    )
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  if (tab === 'body') {
    return (
      <div className="mdd-body">
        {!editing ? (
          <>
            <div className="mdd-body-actions">
              <button type="button" className="mem-btn is-primary" onClick={() => { setDraft(rawContent); setEditing(true) }}>
                Edit
              </button>
            </div>
            {/* eslint-disable-next-line react/no-danger */}
            <div className="mdd-body-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(rawContent) }} />
          </>
        ) : (
          <>
            <div className="mdd-body-actions">
              <button type="button" className="mem-btn" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="mem-btn is-primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <textarea
              className="mdd-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
          </>
        )}
      </div>
    )
  }

  // ── Metadata ──────────────────────────────────────────────────────────────
  if (tab === 'metadata') {
    if (isAgent) {
      const data = agentQuery.data
      return (
        <div className="mdd-metadata">
          <div className="mdd-meta-row"><span className="mdd-meta-key">Agent</span><span className="mdd-meta-val">{item.agentId}</span></div>
          <div className="mdd-meta-row"><span className="mdd-meta-key">Filename</span><span className="mdd-meta-val">{item.filename}</span></div>
          {data && <>
            <div className="mdd-meta-row"><span className="mdd-meta-key">Size</span><span className="mdd-meta-val">{data.sizeBytes} B</span></div>
            <div className="mdd-meta-row"><span className="mdd-meta-key">Modified</span><span className="mdd-meta-val">{new Date(data.modifiedAt).toLocaleString()}</span></div>
          </>}
        </div>
      )
    }
    const page = wikiQuery.data?.page
    if (!page) return null
    return (
      <div className="mdd-metadata">
        <div className="mdd-meta-row"><span className="mdd-meta-key">Path</span><span className="mdd-meta-val">{page.path}</span></div>
        <div className="mdd-meta-row"><span className="mdd-meta-key">Title</span><span className="mdd-meta-val">{page.title}</span></div>
        {page.type && <div className="mdd-meta-row"><span className="mdd-meta-key">Type</span><span className="mdd-meta-val">{page.type}</span></div>}
        {page.domain && <div className="mdd-meta-row"><span className="mdd-meta-key">Domain</span><span className="mdd-meta-val">{page.domain}</span></div>}
        {page.status && <div className="mdd-meta-row"><span className="mdd-meta-key">Status</span><span className="mdd-meta-val">{page.status}</span></div>}
        {page.summary && <div className="mdd-meta-row"><span className="mdd-meta-key">Summary</span><span className="mdd-meta-val">{page.summary}</span></div>}
        {page.created && <div className="mdd-meta-row"><span className="mdd-meta-key">Created</span><span className="mdd-meta-val">{page.created}</span></div>}
        {page.updated && <div className="mdd-meta-row"><span className="mdd-meta-key">Updated</span><span className="mdd-meta-val">{page.updated}</span></div>}
        <div className="mdd-meta-row"><span className="mdd-meta-key">Modified</span><span className="mdd-meta-val">{new Date(page.modified).toLocaleString()}</span></div>
        <div className="mdd-meta-row"><span className="mdd-meta-key">Size</span><span className="mdd-meta-val">{page.size} B</span></div>
        {page.tags.length > 0 && <div className="mdd-meta-row"><span className="mdd-meta-key">Tags</span><span className="mdd-meta-val">{page.tags.join(', ')}</span></div>}
        {page.wikilinks.length > 0 && <div className="mdd-meta-row"><span className="mdd-meta-key">Wikilinks</span><span className="mdd-meta-val">{page.wikilinks.join(', ')}</span></div>}
        {wikiQuery.data?.backlinks && wikiQuery.data.backlinks.length > 0 && (
          <div className="mdd-meta-row"><span className="mdd-meta-key">Backlinks</span><span className="mdd-meta-val">{wikiQuery.data.backlinks.join(', ')}</span></div>
        )}
      </div>
    )
  }

  // ── Raw ───────────────────────────────────────────────────────────────────
  return (
    <div className="mdd-raw">
      <pre>{rawContent}</pre>
    </div>
  )
}

// ── MemoryDetailDrawer ────────────────────────────────────────────────────────

export function MemoryDetailDrawer({ item, open, onClose, onDeleted }: Props) {
  const [tab, setTab] = useState<DrawerTab>('overview')

  // Reset tab when item changes
  useEffect(() => {
    if (item) setTab('overview')
  }, [
    item?.kind === 'agent-file'
      ? `${item.agentId}/${item.filename}`
      : item?.kind === 'wiki-page'
        ? item.path
        : null,
  ])

  const title = !item
    ? ''
    : item.kind === 'agent-file'
      ? item.filename
      : item.path.split('/').pop() ?? item.path

  return (
    <>
      {open && (
        <div
          className="pf-drawer-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        role="dialog"
        aria-label={item ? `Details: ${title}` : 'Details'}
        className={`pf-drawer${open ? ' is-open' : ''}`}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="pf-drawer-header">
          <div className="pf-drawer-glyph">
            {item?.kind === 'agent-file' ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 22, height: 22 }}>
                <rect x="2" y="4" width="12" height="8" rx="1.5"/>
                <path d="M5 4V2M8 4V2M11 4V2M5 12v2M8 12v2M11 12v2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 22, height: 22 }}>
                <path d="M3 2h6l4 4v9H3V2z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 2v4h4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <div className="pf-drawer-name">{title}</div>
          <div className="pf-drawer-badges">
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              fontFamily: 'monospace',
              background: item?.kind === 'agent-file' ? 'rgba(0,255,65,.1)' : 'rgba(95,207,255,.1)',
              color: item?.kind === 'agent-file' ? '#00ff41' : '#5fcfff',
              border: `1px solid ${item?.kind === 'agent-file' ? 'rgba(0,255,65,.3)' : 'rgba(95,207,255,.3)'}`,
            }}>
              {item?.kind === 'agent-file' ? 'Memory' : 'Wiki'}
            </span>
          </div>
          <button type="button" className="pf-drawer-close" onClick={onClose} aria-label="Close drawer">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="pf-drawer-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pf-drawer-tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="pf-drawer-body">
          {item ? (
            <DrawerBody
              item={item}
              tab={tab}
              onClose={onClose}
              onDeleted={onDeleted}
            />
          ) : (
            <div className="mem-loading">No item selected</div>
          )}
        </div>
      </div>
    </>
  )
}
