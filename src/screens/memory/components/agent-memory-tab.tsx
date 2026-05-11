/**
 * AgentMemoryTab — Agent Memory tab body for the Memory screen (MEM-02).
 *
 * Left rail: built-in T1/T2 agents (T3 excluded per spec).
 * Right pane: file list tabs + viewer/editor for the selected agent's memory files.
 * Files live at $HERMES_HOME/profiles/<agent_id>/memory/*.md
 */

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MemoryDetailDrawer } from './memory-detail-drawer'
import type { DrawerItem } from './memory-detail-drawer'
import type { AgentFileReadResponse, AgentFilesListResponse } from '@/routes/api/memory/agent-files'
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { toast as showToast } from '@/components/ui/toast'
import { useMemoryAgentStore } from '@/stores/memory-screen-store'

// ── helpers ──────────────────────────────────────────────────────────────────

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
  if (!res.ok || payload.error) {
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
}

async function apiDelete(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || payload.error) {
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(1)}K`
}

// ── AddFileModal ──────────────────────────────────────────────────────────────

type AddFileModalProps = {
  agentId: string
  onClose: () => void
  onSaved: () => void
}

function AddFileModal({ agentId, onClose, onSaved }: AddFileModalProps) {
  const [filename, setFilename] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSave() {
    const name = filename.trim().endsWith('.md') ? filename.trim() : `${filename.trim()}.md`
    if (!name || name === '.md') {
      showToast('Filename is required')
      return
    }
    setSaving(true)
    try {
      await apiPost('/api/memory/agent-files', { agent: agentId, filename: name, content })
      showToast(`Created ${name}`)
      onSaved()
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create file')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="mem-modal-backdrop" onClick={onClose}>
      <div className="mem-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>Add Memory File</h3>
        <div className="mem-modal-field">
          <label className="mem-modal-label" htmlFor="mem-new-filename">Filename</label>
          <input
            id="mem-new-filename"
            ref={inputRef}
            className="mem-modal-input"
            placeholder="e.g. user.md"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave() }}
          />
        </div>
        <div className="mem-modal-field">
          <label className="mem-modal-label" htmlFor="mem-new-content">Content</label>
          <textarea
            id="mem-new-content"
            className="mem-modal-textarea"
            placeholder="# Filename&#10;&#10;Content here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="mem-modal-actions">
          <button type="button" className="mem-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="mem-btn is-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save File'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── FilePane ─────────────────────────────────────────────────────────────────

type FilePaneProps = {
  agentId: string
  agentName: string
  agentGlyph: string
  agentRole: string
  agentTier: 1 | 2
}

function FilePane({ agentId, agentName, agentGlyph, agentRole, agentTier }: FilePaneProps) {
  const qc = useQueryClient()
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [drawerItem, setDrawerItem] = useState<DrawerItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // List files for this agent
  const listQuery = useQuery<AgentFilesListResponse>({
    queryKey: ['agent-files', agentId],
    queryFn: () => apiFetch(`/api/memory/agent-files?agent=${encodeURIComponent(agentId)}`),
  })

  // Read active file
  const fileQuery = useQuery<AgentFileReadResponse>({
    queryKey: ['agent-file', agentId, activeFile],
    queryFn: () =>
      apiFetch(`/api/memory/agent-files?agent=${encodeURIComponent(agentId)}&filename=${encodeURIComponent(activeFile!)}`),
    enabled: !!activeFile,
  })

  // Auto-select first file when list loads
  useEffect(() => {
    if (listQuery.data && listQuery.data.files.length > 0 && !activeFile) {
      setActiveFile(listQuery.data.files[0].filename)
    }
    if (listQuery.data && listQuery.data.files.length === 0) {
      setActiveFile(null)
    }
  }, [listQuery.data, activeFile])

  // Reset edit state when switching files/agents
  useEffect(() => {
    setEditing(false)
    setDraft('')
  }, [agentId, activeFile])

  // Sync draft from loaded content
  useEffect(() => {
    if (fileQuery.data && !editing) {
      setDraft(fileQuery.data.content)
    }
  }, [fileQuery.data, editing])

  function handleFileSelect(filename: string) {
    if (filename === activeFile) return
    setActiveFile(filename)
    setEditing(false)
    setDraft('')
  }

  function handleEdit() {
    setDraft(fileQuery.data?.content ?? '')
    setEditing(true)
  }

  async function handleSave() {
    if (!activeFile) return
    setSaving(true)
    try {
      await apiPost('/api/memory/agent-files', { agent: agentId, filename: activeFile, content: draft })
      await qc.invalidateQueries({ queryKey: ['agent-files', agentId] })
      await qc.invalidateQueries({ queryKey: ['agent-file', agentId, activeFile] })
      setEditing(false)
      showToast('Saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await apiDelete('/api/memory/agent-files', { agent: agentId, filename: deleteTarget })
      if (activeFile === deleteTarget) setActiveFile(null)
      await qc.invalidateQueries({ queryKey: ['agent-files', agentId] })
      showToast(`Deleted ${deleteTarget}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleteTarget(null)
    }
  }

  const files = listQuery.data?.files ?? []
  const activeEntry = files.find((f) => f.filename === activeFile)

  return (
    <>
      <div className="mem-pane">
        {/* Pane header */}
        <div className="mem-pane-head">
          <div className="mem-pane-glyph">{agentGlyph}</div>
          <div>
            <span className="mem-pane-title">{agentName}</span>
            <span className="mem-pane-sub">
              {agentRole} · Tier {agentTier} · {files.length} memory file{files.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="mem-pane-actions">
            {editing ? (
              <>
                <button type="button" className="mem-btn" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className="mem-btn is-primary" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? 'Saving…' : (
                    <>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M2 8l4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Save
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                {activeFile && (
                  <button
                    type="button"
                    className="mem-btn is-danger"
                    onClick={() => setDeleteTarget(activeFile)}
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Delete
                  </button>
                )}
                {activeFile && (
                  <button type="button" className="mem-btn" onClick={handleEdit} disabled={!fileQuery.data}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M11 2l3 3-8 8H3v-3l8-8z" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Edit
                  </button>
                )}
                <button type="button" className="mem-btn is-primary" onClick={() => setShowAdd(true)}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 3v10M3 8h10" strokeLinecap="round"/>
                  </svg>
                  Add File
                </button>
              </>
            )}
          </div>
        </div>

        {/* File tabs */}
        {files.length > 0 ? (
          <div className="mem-file-tabs">
            {files.map((f) => (
              <button
                key={f.filename}
                type="button"
                className={`mem-file-tab ${f.filename === activeFile ? 'is-active' : ''}`}
                onClick={() => handleFileSelect(f.filename)}
                onDoubleClick={() => {
                  setDrawerItem({ kind: 'agent-file', agentId, agentName, filename: f.filename })
                  setDrawerOpen(true)
                }}
                title="Click to select · Double-click to open detail drawer"
              >
                {f.filename}
                <span className="mem-file-sz">{formatSize(f.sizeBytes)}</span>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="mem-file-detail-icon"
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDrawerItem({ kind: 'agent-file', agentId, agentName, filename: f.filename })
                    setDrawerOpen(true)
                  }}
                >
                  <path d="M6 3H3v10h10V9M9 2h5v5M14 2l-7 7" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ))}
          </div>
        ) : (
          <div className="mem-file-tabs" />
        )}

        {/* Viewer / editor */}
        <div className="mem-editor-wrap">
          {listQuery.isLoading || fileQuery.isLoading ? (
            <div className="mem-loading">Loading…</div>
          ) : files.length === 0 ? (
            <div className="mem-empty">
              <div className="mem-empty-icon">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                  <path d="M3 2h6l4 4v9H3V2z" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 2v4h4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              No memory files yet
              <button type="button" className="mem-btn is-primary" onClick={() => setShowAdd(true)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 3v10M3 8h10" strokeLinecap="round"/>
                </svg>
                Add First File
              </button>
            </div>
          ) : editing ? (
            <textarea
              className="mem-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
          ) : fileQuery.data ? (
            <div className="mem-viewer" onClick={handleEdit} title="Click to edit">
              {fileQuery.data.content || <span style={{ opacity: 0.4 }}>(empty file)</span>}
            </div>
          ) : activeEntry ? (
            <div className="mem-loading">Loading file…</div>
          ) : null}
        </div>
      </div>

      {/* Add file modal */}
      {showAdd && (
        <AddFileModal
          agentId={agentId}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['agent-files', agentId] })
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Memory File"
        message={`Delete "${deleteTarget}" from ${agentName}? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Detail drawer */}
      <MemoryDetailDrawer
        item={drawerItem}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onDeleted={() => {
          void qc.invalidateQueries({ queryKey: ['agent-files', agentId] })
          setActiveFile(null)
        }}
      />
    </>
  )
}

// ── AgentMemoryTab ────────────────────────────────────────────────────────────

export function AgentMemoryTab() {
  const { selectedAgentId, setSelectedAgentId } = useMemoryAgentStore()

  const t1 = BUILTIN_AGENTS.filter((a) => a.tier === 1)
  const t2 = BUILTIN_AGENTS.filter((a) => a.tier === 2)

  const activeAgent = BUILTIN_AGENTS.find((a) => a.id === selectedAgentId) ?? BUILTIN_AGENTS[0]

  return (
    <div className="mem-grid">
      {/* Left rail */}
      <aside className="mem-agent-rail">
        <div className="mem-rail-grp">
          Tier 1 <span className="ct">{t1.length}</span>
        </div>
        {t1.map((a) => (
          <div
            key={a.id}
            className={`mem-agent-row ${a.id === selectedAgentId ? 'is-active' : ''}`}
            onClick={() => setSelectedAgentId(a.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedAgentId(a.id) }}
          >
            <div className="mem-agent-glyph">{a.glyph}</div>
            <div className="mem-agent-info">
              <span className="mem-agent-name">{a.name}</span>
              <span className="mem-agent-role">{a.role}</span>
            </div>
            <span className="mem-agent-tier">T1</span>
          </div>
        ))}

        <div className="mem-rail-grp" style={{ marginTop: 10 }}>
          Tier 2 <span className="ct">{t2.length}</span>
        </div>
        {t2.map((a) => (
          <div
            key={a.id}
            className={`mem-agent-row ${a.id === selectedAgentId ? 'is-active' : ''}`}
            onClick={() => setSelectedAgentId(a.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedAgentId(a.id) }}
          >
            <div className="mem-agent-glyph">{a.glyph}</div>
            <div className="mem-agent-info">
              <span className="mem-agent-name">{a.name}</span>
              <span className="mem-agent-role">{a.role}</span>
            </div>
            <span className="mem-agent-tier">T2</span>
          </div>
        ))}

        <div className="mem-rail-grp" style={{ marginTop: 10 }}>
          Tier 3
        </div>
        <div className="mem-rail-note">
          Tier-3 personas are stateless — they inherit context per call and carry no layered memory.
        </div>
      </aside>

      {/* Right pane */}
      <FilePane
        agentId={activeAgent.id}
        agentName={activeAgent.name}
        agentGlyph={activeAgent.glyph}
        agentRole={activeAgent.role}
        agentTier={activeAgent.tier}
      />
    </div>
  )
}
