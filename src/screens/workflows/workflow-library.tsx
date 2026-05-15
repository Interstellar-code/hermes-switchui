import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useUpsertWorkflowDefinition } from './use-workflows'
import type { WorkflowSummary } from './types'

const ORIGIN_OPTIONS = [
  { value: 'all', label: 'All origins' },
  { value: 'bundled', label: 'Built-in' },
  { value: 'user', label: 'User' },
  { value: 'project', label: 'Project' },
] as const

type OriginFilter = 'all' | 'bundled' | 'user' | 'project'

const YAML_TEMPLATE = `id: my-workflow
name: My Workflow
description: ""
nodes:
  - id: start
    type: prompt
    prompt: "Hello"
`

const ID_REGEX = /^[A-Za-z0-9_:.-]{1,128}$/

function slugify(name: string): string {
  return name
    .replace(/\.ya?ml$/i, '')
    .replace(/[^A-Za-z0-9_:.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
}

interface NewWorkflowModalProps {
  initialYaml?: string
  initialId?: string
  onClose: () => void
}

function NewWorkflowModal({ initialYaml, initialId, onClose }: NewWorkflowModalProps) {
  const [id, setId] = useState(initialId ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState<'user' | 'project'>('project')
  const [yaml, setYaml] = useState(initialYaml ?? YAML_TEMPLATE)
  const [serverError, setServerError] = useState<string | null>(null)

  const upsert = useUpsertWorkflowDefinition()

  const idValid = ID_REGEX.test(id)
  const canSubmit = idValid && name.trim().length > 0 && yaml.trim().length > 0 && !upsert.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    try {
      await upsert.mutateAsync({ id, name: name.trim(), description: description.trim() || undefined, source, yaml })
      onClose()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div
      className="wfrd-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="wfrd-modal"
        style={{
          background: 'var(--bg-2, #1a1a1a)', border: '1px solid var(--border, #333)',
          borderRadius: 8, padding: '24px 28px', width: 560, maxWidth: '95vw',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>New Workflow Definition</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted, #888)', lineHeight: 1 }}
            aria-label="Close"
          >×</button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e) }}>
          {/* ID */}
          <div style={{ marginBottom: 14 }}>
            <label className="wfrd-label" style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-muted, #888)' }}>
              ID <span style={{ color: 'var(--text-danger, #e55)' }}>*</span>
            </label>
            <input
              className="wfrd-input"
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-workflow"
              style={{ width: '100%', boxSizing: 'border-box' }}
              required
            />
            {id.length > 0 && !idValid && (
              <div style={{ color: 'var(--text-danger, #e55)', fontSize: 11, marginTop: 3 }}>
                id must be 1–128 chars of [A-Za-z0-9_:.-]
              </div>
            )}
          </div>

          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <label className="wfrd-label" style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-muted, #888)' }}>
              Name <span style={{ color: 'var(--text-danger, #e55)' }}>*</span>
            </label>
            <input
              className="wfrd-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workflow"
              style={{ width: '100%', boxSizing: 'border-box' }}
              required
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 14 }}>
            <label className="wfrd-label" style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-muted, #888)' }}>
              Description
            </label>
            <input
              className="wfrd-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Source */}
          <div style={{ marginBottom: 14 }}>
            <label className="wfrd-label" style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-muted, #888)' }}>
              Source
            </label>
            <select
              className="wfrd-select"
              value={source}
              onChange={(e) => setSource(e.target.value as 'user' | 'project')}
              style={{ width: '100%', boxSizing: 'border-box' }}
            >
              <option value="project">project</option>
              <option value="user">user</option>
            </select>
          </div>

          {/* YAML */}
          <div style={{ marginBottom: 18 }}>
            <label className="wfrd-label" style={{ display: 'block', fontSize: 12, marginBottom: 4, color: 'var(--text-muted, #888)' }}>
              YAML <span style={{ color: 'var(--text-danger, #e55)' }}>*</span>
            </label>
            <textarea
              className="wfrd-yaml"
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              rows={18}
              style={{
                width: '100%', boxSizing: 'border-box',
                fontFamily: 'monospace', fontSize: 12,
                resize: 'vertical',
              }}
              required
            />
          </div>

          {serverError && (
            <div style={{ color: 'var(--text-danger, #e55)', fontSize: 12, marginBottom: 12 }}>
              {serverError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="wfr-btn-import" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="wfr-btn-new" disabled={!canSubmit}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export interface WorkflowLibraryProps {
  selectedId: string | null
  onSelectWorkflow: (id: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  onFilteredChange?: (workflows: Array<WorkflowSummary>) => void
  /** B.4: live workflow definitions (adapted from /api/workflow-definitions). */
  workflows: Array<WorkflowSummary>
}

export function WorkflowLibrary({
  selectedId: _selectedId,
  onSelectWorkflow: _onSelectWorkflow,
  collapsed,
  onToggleCollapse,
  onFilteredChange,
  workflows,
}: WorkflowLibraryProps) {
  const TOTAL = workflows.length
  const [, setSkeleton] = useState(true)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalInitialYaml, setModalInitialYaml] = useState<string | undefined>(undefined)
  const [modalInitialId, setModalInitialId] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setSkeleton(false), 280)
    return () => clearTimeout(t)
  }, [])

  const normalizedSearch = deferredSearch.trim().toLowerCase()

  // origin counts (unfiltered)
  const originCounts = useMemo(() => {
    const counts: Record<string, number> = { all: TOTAL }
    for (const w of workflows) {
      counts[w.source] = (counts[w.source] || 0) + 1
    }
    return counts
  }, [workflows, TOTAL])

  const filtered = useMemo<Array<WorkflowSummary>>(() => {
    return workflows.filter((w) => {
      if (originFilter !== 'all' && w.source !== originFilter) return false
      if (normalizedSearch) {
        if (
          !w.name.toLowerCase().includes(normalizedSearch) &&
          !w.description.toLowerCase().includes(normalizedSearch)
        )
          return false
      }
      return true
    })
  }, [workflows, originFilter, normalizedSearch])

  useEffect(() => {
    onFilteredChange?.(filtered)
  }, [filtered, onFilteredChange])

  function handleNew() {
    setModalInitialYaml(undefined)
    setModalInitialId(undefined)
    setModalOpen(true)
  }

  function handleImport() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setModalInitialYaml(text)
    setModalInitialId(slugify(file.name))
    setModalOpen(true)
    // Reset so the same file can be re-imported
    e.target.value = ''
  }

  if (collapsed) {
    return (
      <div className="wfr-panel wfr-panel--collapsed">
        <button
          type="button"
          className="wfr-expand-btn"
          title="Expand rail"
          aria-label="Expand rail"
          onClick={onToggleCollapse}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <span className="wfr-collapsed-label">Workflows</span>
      </div>
    )
  }

  return (
    <>
      {modalOpen && (
        <NewWorkflowModal
          initialYaml={modalInitialYaml}
          initialId={modalInitialId}
          onClose={() => setModalOpen(false)}
        />
      )}

      {/* Hidden file input for Import YAML */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".yml,.yaml,text/yaml"
        style={{ display: 'none' }}
        onChange={(e) => { void handleFileChange(e) }}
      />

      <div className="wfr-panel">
        {/* ── Rail header ─────────────────────────────────── */}
        <div className="wfr-header">
          <h2>Workflows</h2>
          <span className="wfr-ct">{TOTAL}</span>
          <button
            type="button"
            className="wfr-collapse-btn"
            title="Collapse rail"
            aria-label="Collapse rail"
            onClick={onToggleCollapse}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        {/* ── CTA buttons ─────────────────────────────────── */}
        <div className="wfr-ctas">
          <button className="wfr-btn-import" onClick={handleImport}>
            Import YAML
          </button>
          <button className="wfr-btn-new" onClick={handleNew}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        </div>

        {/* ── Search ──────────────────────────────────────── */}
        <div className="wfr-search-wrap">
          <svg className="wfr-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="wfr-search"
            type="text"
            placeholder="Search workflows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search workflows"
          />
          {search && (
            <button className="wfr-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        {/* ── Filter body ─────────────────────────────────── */}
        <div className="wfr-body">

          {/* ORIGIN section */}
          <div className="wfr-section">
            <div className="wfr-sec-label">Origin</div>
            <div className="wfr-list">
              {ORIGIN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wfr-row${originFilter === opt.value ? ' active' : ''}`}
                  onClick={() => setOriginFilter(opt.value as OriginFilter)}
                >
                  <span>{opt.label}</span>
                  <span className="wfr-row-ct">{originCounts[opt.value] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

        </div>{/* end wfr-body */}
      </div>
    </>
  )
}
