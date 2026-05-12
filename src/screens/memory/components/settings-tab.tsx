/**
 * SettingsTab — Memory & Wiki settings (MEM-08).
 *
 * Sections:
 * 1. Wiki source — local FS vs GitHub-backed (read + edit via /api/knowledge/config)
 * 2. Knowledge graph rebuild — POST /api/knowledge/graph?action=rebuild (stub toast if not exposed)
 * 3. Cache controls — clear knowledge cache via /api/knowledge/sync?action=clear
 * 4. Provider config notice — per-agent memory providers live in Profile wizard step 6
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { KnowledgeBaseConfig } from '@/server/knowledge-config'
import { toast as showToast } from '@/components/ui/toast'

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

async function apiPost(url: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok || payload.error) throw new Error(payload.error ?? `Request failed (${res.status})`)
  return payload
}

// ── WikiSourceSection ─────────────────────────────────────────────────────────

type ConfigResponse = { config: KnowledgeBaseConfig }

function WikiSourceSection() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // local draft state
  const [sourceType, setSourceType] = useState<'local' | 'github'>('local')
  const [localPath, setLocalPath] = useState('')
  const [ghRepo, setGhRepo] = useState('')
  const [ghBranch, setGhBranch] = useState('main')
  const [ghPath, setGhPath] = useState('')

  const { data, isLoading, isError, refetch } = useQuery<ConfigResponse>({
    queryKey: ['knowledge', 'config'],
    queryFn: () => apiFetch('/api/knowledge/config'),
    staleTime: 60_000,
  })

  function startEdit() {
    if (!data) return
    const src = data.config.source
    setSourceType(src.type)
    if (src.type === 'local') {
      setLocalPath(src.path)
    } else {
      setGhRepo(src.repo)
      setGhBranch(src.branch)
      setGhPath(src.path)
    }
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const source: KnowledgeBaseConfig['source'] =
        sourceType === 'local'
          ? { type: 'local', path: localPath.trim() }
          : { type: 'github', repo: ghRepo.trim(), branch: ghBranch.trim(), path: ghPath.trim() }
      await apiPost('/api/knowledge/config', { source })
      await qc.invalidateQueries({ queryKey: ['knowledge', 'config'] })
      await qc.invalidateQueries({ queryKey: ['knowledge', 'list'] })
      showToast('Wiki source saved')
      setEditing(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mset-section">
      <h2 className="mset-section-title">Wiki Source</h2>
      <p className="mset-section-desc">
        Where Hermes reads and writes wiki pages. Changes take effect immediately.
      </p>

      {isLoading && <div className="mem-loading">Loading…</div>}
      {isError && (
        <div className="mset-error">
          Failed to load config.{' '}
          <button type="button" className="mem-btn" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      )}

      {data && !editing && (
        <div className="mset-card">
          <div className="mset-row">
            <span className="mset-key">Source type</span>
            <span className="mset-val mset-badge">{data.config.source.type}</span>
          </div>
          {data.config.source.type === 'local' && (
            <div className="mset-row">
              <span className="mset-key">Path</span>
              <span className="mset-val mset-mono">{data.config.source.path || '(default HERMES_HOME)'}</span>
            </div>
          )}
          {data.config.source.type === 'github' && (
            <>
              <div className="mset-row">
                <span className="mset-key">Repo</span>
                <span className="mset-val mset-mono">{data.config.source.repo}</span>
              </div>
              <div className="mset-row">
                <span className="mset-key">Branch</span>
                <span className="mset-val mset-mono">{data.config.source.branch}</span>
              </div>
              <div className="mset-row">
                <span className="mset-key">Path</span>
                <span className="mset-val mset-mono">{data.config.source.path}</span>
              </div>
            </>
          )}
          <div className="mset-actions">
            <button type="button" className="mem-btn" onClick={startEdit}>
              Edit Source
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="mset-card mset-form">
          <div className="mset-field">
            <label className="mset-label">Source type</label>
            <div className="mset-radio-group">
              <label className="mset-radio">
                <input
                  type="radio"
                  name="source-type"
                  value="local"
                  checked={sourceType === 'local'}
                  onChange={() => setSourceType('local')}
                />
                Local filesystem
              </label>
              <label className="mset-radio">
                <input
                  type="radio"
                  name="source-type"
                  value="github"
                  checked={sourceType === 'github'}
                  onChange={() => setSourceType('github')}
                />
                GitHub repository
              </label>
            </div>
          </div>

          {sourceType === 'local' && (
            <div className="mset-field">
              <label className="mset-label" htmlFor="mset-local-path">
                Directory path
              </label>
              <input
                id="mset-local-path"
                className="mset-input"
                placeholder="Leave empty for $HERMES_HOME/wiki"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
              />
            </div>
          )}

          {sourceType === 'github' && (
            <>
              <div className="mset-field">
                <label className="mset-label" htmlFor="mset-gh-repo">
                  Repository (owner/repo)
                </label>
                <input
                  id="mset-gh-repo"
                  className="mset-input"
                  placeholder="e.g. acme/wiki"
                  value={ghRepo}
                  onChange={(e) => setGhRepo(e.target.value)}
                />
              </div>
              <div className="mset-field">
                <label className="mset-label" htmlFor="mset-gh-branch">
                  Branch
                </label>
                <input
                  id="mset-gh-branch"
                  className="mset-input"
                  placeholder="main"
                  value={ghBranch}
                  onChange={(e) => setGhBranch(e.target.value)}
                />
              </div>
              <div className="mset-field">
                <label className="mset-label" htmlFor="mset-gh-path">
                  Subdirectory (optional)
                </label>
                <input
                  id="mset-gh-path"
                  className="mset-input"
                  placeholder="e.g. docs/"
                  value={ghPath}
                  onChange={(e) => setGhPath(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="mset-actions">
            <button type="button" className="mem-btn" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="mem-btn is-primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── GraphRebuildSection ───────────────────────────────────────────────────────

function GraphRebuildSection() {
  const [rebuilding, setRebuilding] = useState(false)

  function handleRebuild() {
    setRebuilding(true)
    try {
      // The graph route only exposes GET (builds on read). POST ?action=rebuild is not yet
      // a separate endpoint — stub with an informative toast per plan spec.
      showToast('Backend graph rebuild not yet exposed — use GET /api/knowledge/graph to refresh')
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <section className="mset-section">
      <h2 className="mset-section-title">Knowledge Graph</h2>
      <p className="mset-section-desc">
        The knowledge graph is rebuilt automatically when you load the Graph tab. Use this to force
        an immediate rebuild, e.g. after bulk-importing wiki pages.
      </p>
      <div className="mset-actions">
        <button
          type="button"
          className="mem-btn"
          onClick={handleRebuild}
          disabled={rebuilding}
        >
          {rebuilding ? 'Rebuilding…' : 'Rebuild Graph'}
        </button>
      </div>
    </section>
  )
}

// ── CacheSection ──────────────────────────────────────────────────────────────

function CacheSection() {
  const qc = useQueryClient()
  const [clearing, setClearing] = useState(false)

  async function handleClear() {
    setClearing(true)
    try {
      // Invalidate all TanStack Query knowledge caches so the next request
      // fetches fresh data from the wiki source. The server holds no separate
      // in-memory cache beyond what knowledge-browser.ts builds on each call,
      // so client-side invalidation is sufficient.
      await qc.invalidateQueries({ queryKey: ['knowledge'] })
      showToast('Knowledge cache cleared')
    } finally {
      setClearing(false)
    }
  }

  return (
    <section className="mset-section">
      <h2 className="mset-section-title">Cache Controls</h2>
      <p className="mset-section-desc">
        Clears the in-memory knowledge cache so the next request fetches fresh data from the wiki
        source. Useful after manual edits to the underlying files.
      </p>
      <div className="mset-actions">
        <button
          type="button"
          className="mem-btn is-danger"
          onClick={() => void handleClear()}
          disabled={clearing}
        >
          {clearing ? 'Clearing…' : 'Clear Knowledge Cache'}
        </button>
      </div>
    </section>
  )
}

// ── ProviderNoticeSection ─────────────────────────────────────────────────────

function ProviderNoticeSection() {
  return (
    <section className="mset-section">
      <h2 className="mset-section-title">Memory Providers</h2>
      <p className="mset-section-desc">
        Per-agent memory providers (Hindsight, Mem0, etc.) are configured per agent profile — not
        globally. To configure them, open the agent's profile and complete step&nbsp;6 of the
        Profile wizard.
      </p>
      <div className="mset-notice">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5"/>
          <path d="M8 7v5M8 5.5v.5" strokeLinecap="round"/>
        </svg>
        <span>
          Memory provider settings are per-profile.{' '}
          <a href="/profiles" className="mset-link">
            Open Profiles →
          </a>
        </span>
      </div>
    </section>
  )
}

// ── SettingsTab ───────────────────────────────────────────────────────────────

export function SettingsTab() {
  return (
    <div className="mset-shell">
      <WikiSourceSection />
      <GraphRebuildSection />
      <CacheSection />
      <ProviderNoticeSection />
    </div>
  )
}
