'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import type { ClaudeJob } from '@/lib/jobs-api'
import {
  deleteJob,
  fetchJobs,
  pauseJob,
  resumeJob,
  triggerJob,
} from '@/lib/jobs-api'
import { toast } from '@/components/ui/toast'
import {
  useCronsFilterStore,
  useCronsViewStore,
  useCronsPageSize,
  PAGE_SIZES_GRID,
  PAGE_SIZES_TABLE,
} from '@/stores/crons-screen-store'
import { CronsWizard } from './components/crons-wizard'
import { CronDetailDrawer } from './components/cron-detail-drawer'
import '@/styles/matrix-crons.css'

const QUERY_KEY = ['crons', 'list'] as const

// ── Debounce hook ────────────────────────────────────────────────────────────
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function relativeTime(value?: string | null): string {
  if (!value) return 'Never'
  try {
    const diffMs = Date.now() - new Date(value).getTime()
    if (diffMs < 0) return 'just now'
    if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s ago`
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`
    if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`
    return `${Math.round(diffMs / 86_400_000)}d ago`
  } catch {
    return value
  }
}

function friendlySchedule(job: ClaudeJob): string {
  if (job.schedule_display) return job.schedule_display
  const s = job.schedule
  if (!s || typeof s !== 'object') return 'custom'
  const expr = (s as Record<string, unknown>).cron_expression as string | undefined
  if (!expr) return 'custom'
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return expr
  const [min, hour, dom, , dow] = parts
  if (min === '*' && hour === '*') return 'every minute'
  if (min !== '*' && hour === '*') return `every hour at :${min.padStart(2, '0')}`
  if (dom === '*' && dow === '*') return `daily at ${hour}:${String(min).padStart(2, '0')}`
  if (dom === '*') return `weekly`
  return expr
}

function cronExpr(job: ClaudeJob): string {
  const s = job.schedule
  if (!s || typeof s !== 'object') return ''
  return ((s as Record<string, unknown>).cron_expression as string) ?? ''
}

function jobStatus(job: ClaudeJob): 'active' | 'paused' | 'error' | 'idle' {
  if (job.state === 'failed' || job.state === 'error' || job.last_run_success === false) return 'error'
  if (job.state === 'paused' || !job.enabled) return 'paused'
  if (job.state === 'running' || job.state === 'active') return 'active'
  if (job.last_run_at) return 'active'
  return 'idle'
}

// ── Status pill ───────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: ReturnType<typeof jobStatus> }) {
  return (
    <span className={`cr-status-pill cr-status-pill--${status}`}>
      <span className="dot" />
      {status}
    </span>
  )
}

// ── Cron card (grid view) ─────────────────────────────────────────────────────
function CronCard({
  job,
  onPause,
  onResume,
  onTrigger,
  onDelete,
  onEdit,
  onOpen,
}: {
  job: ClaudeJob
  onPause: (id: string) => void
  onResume: (id: string) => void
  onTrigger: (id: string) => void
  onDelete: (job: ClaudeJob) => void
  onEdit: (job: ClaudeJob) => void
  onOpen: (job: ClaudeJob) => void
}) {
  const status = jobStatus(job)
  const expr = cronExpr(job)
  const friendly = friendlySchedule(job)
  const owner = (job.skills ?? []).join(', ') || null

  return (
    <div className="cr-card" data-status={status} onClick={() => onOpen(job)} style={{ cursor: 'pointer' }}>
      <div className="cr-card-top">
        <div className="cr-card-name">{job.name || '(unnamed)'}</div>
        <StatusPill status={status} />
      </div>

      <div className="cr-card-schedule">
        {/* clock icon */}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 4.5v3.75L10 10" strokeLinecap="round" />
        </svg>
        <span>{friendly}</span>
        {expr && expr !== friendly && (
          <span className="cr-schedule-expr">{expr}</span>
        )}
      </div>

      <div className="cr-card-meta">
        <span className="cr-last-run">{relativeTime(job.last_run_at)}</span>
        {owner && (
          <span className="cr-agent-badge">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="5.5" r="2.5" />
              <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" strokeLinecap="round" />
            </svg>
            {owner}
          </span>
        )}
      </div>

      <div className="cr-card-actions">
        {/* Run now */}
        <button
          type="button"
          className="cr-action-btn"
          title="Run now"
          onClick={(e) => { e.stopPropagation(); onTrigger(job.id) }}
        >
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M5 3.5l8 4.5-8 4.5V3.5z" />
          </svg>
        </button>
        {/* Pause / Resume */}
        <button
          type="button"
          className="cr-action-btn"
          title={status === 'paused' ? 'Resume' : 'Pause'}
          onClick={(e) => { e.stopPropagation(); status === 'paused' ? onResume(job.id) : onPause(job.id) }}
        >
          {status === 'paused' ? (
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 3.5l8 4.5-8 4.5V3.5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="4" y="3" width="3" height="10" rx="1" />
              <rect x="9" y="3" width="3" height="10" rx="1" />
            </svg>
          )}
        </button>
        {/* Edit */}
        <button
          type="button"
          className="cr-action-btn"
          title="Edit"
          onClick={(e) => { e.stopPropagation(); onEdit(job) }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Delete */}
        <button
          type="button"
          className="cr-action-btn cr-action-btn--danger"
          title="Delete"
          onClick={(e) => { e.stopPropagation(); onDelete(job) }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9.5h5L11 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Cron table row ────────────────────────────────────────────────────────────
function CronTableRow({
  job,
  onPause,
  onResume,
  onTrigger,
  onDelete,
  onEdit,
  onOpen,
}: {
  job: ClaudeJob
  onPause: (id: string) => void
  onResume: (id: string) => void
  onTrigger: (id: string) => void
  onDelete: (job: ClaudeJob) => void
  onEdit: (job: ClaudeJob) => void
  onOpen: (job: ClaudeJob) => void
}) {
  const status = jobStatus(job)
  const expr = cronExpr(job)
  const friendly = friendlySchedule(job)

  return (
    <tr onClick={() => onOpen(job)} style={{ cursor: 'pointer' }}>
      <td className="cr-td-name">{job.name || '(unnamed)'}</td>
      <td className="cr-td-schedule">
        <div>{friendly}</div>
        {expr && <div style={{ opacity: 0.5, fontSize: 10 }}>{expr}</div>}
      </td>
      <td><StatusPill status={status} /></td>
      <td style={{ color: 'var(--m-text-faint,var(--theme-muted))', fontSize: 11 }}>
        {relativeTime(job.last_run_at)}
      </td>
      <td>
        {(job.skills ?? []).length > 0 && (
          <span className="cr-agent-badge">{(job.skills ?? []).join(', ')}</span>
        )}
      </td>
      <td>
        <div className="cr-td-actions">
        <button type="button" className="cr-action-btn" title="Run now" onClick={(e) => { e.stopPropagation(); onTrigger(job.id) }}>
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5l8 4.5-8 4.5V3.5z" /></svg>
        </button>
        <button
          type="button"
          className="cr-action-btn"
          title={status === 'paused' ? 'Resume' : 'Pause'}
          onClick={(e) => { e.stopPropagation(); status === 'paused' ? onResume(job.id) : onPause(job.id) }}
        >
          {status === 'paused' ? (
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5l8 4.5-8 4.5V3.5z" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="4" y="3" width="3" height="10" rx="1" />
              <rect x="9" y="3" width="3" height="10" rx="1" />
            </svg>
          )}
        </button>
        <button type="button" className="cr-action-btn" title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(job) }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="cr-action-btn cr-action-btn--danger" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(job) }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9.5h5L11 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        </div>
      </td>
    </tr>
  )
}

// ── Skeleton grid ─────────────────────────────────────────────────────────────
function SkeletonGrid() {
  return (
    <div className="cr-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="cr-skeleton">
          <div className="cr-skeleton-line" style={{ width: '55%' }} />
          <div className="cr-skeleton-badge" />
          <div className="cr-skeleton-line" style={{ width: '80%' }} />
          <div className="cr-skeleton-line" style={{ width: '40%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  )
}

// ── Filter pills component ────────────────────────────────────────────────────
function FilterPill<T extends string>({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: T
  active: boolean
  onClick: (v: T) => void
}) {
  return (
    <button
      type="button"
      className={`filter-pill${active ? ' filter-pill--active' : ''}`}
      onClick={() => onClick(value)}
    >
      {label}
    </button>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export function JobsScreen() {
  const queryClient = useQueryClient()
  const { viewMode, pageSizeGrid, pageSizeTable, setViewMode, setPageSize } = useCronsViewStore()
  const {
    search, statusFilter, cadenceFilter, page,
    setSearch, setStatusFilter, setCadenceFilter, setPage, resetFilters,
  } = useCronsFilterStore()
  const pageSize = useCronsPageSize()

  const rawSearch = search
  const debouncedSearch = useDebounced(rawSearch, 150)

  const [deleteTarget, setDeleteTarget] = useState<ClaudeJob | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editJob, setEditJob] = useState<ClaudeJob | null>(null)
  const [drawerJob, setDrawerJob] = useState<ClaudeJob | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  function openWizardNew() { setEditJob(null); setWizardOpen(true) }
  function openWizardEdit(job: ClaudeJob) { setEditJob(job); setWizardOpen(true) }
  function openDrawer(job: ClaudeJob) { setDrawerJob(job); setDrawerOpen(true) }

  const cronsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchJobs,
    refetchInterval: 30_000,
  })

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  const pauseMutation = useMutation({
    mutationFn: pauseJob,
    onSuccess: () => { invalidate(); toast('Cron paused') },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to pause', { type: 'error' }),
  })
  const resumeMutation = useMutation({
    mutationFn: resumeJob,
    onSuccess: () => { invalidate(); toast('Cron resumed') },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to resume', { type: 'error' }),
  })
  const triggerMutation = useMutation({
    mutationFn: triggerJob,
    onSuccess: () => { invalidate(); toast('Cron triggered') },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to trigger', { type: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteJob,
    onSuccess: () => { invalidate(); toast('Cron deleted') },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to delete', { type: 'error' }),
  })

  const allJobs = cronsQuery.data ?? []

  // counts
  const totalCount = allJobs.length
  const activeCount = allJobs.filter((j) => jobStatus(j) === 'active').length
  const pausedCount = allJobs.filter((j) => jobStatus(j) === 'paused').length
  const errorCount  = allJobs.filter((j) => jobStatus(j) === 'error').length

  // filter + search
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return allJobs.filter((job) => {
      if (q && !job.name?.toLowerCase().includes(q) && !job.prompt?.toLowerCase().includes(q)) return false
      if (statusFilter !== 'all' && jobStatus(job) !== statusFilter) return false
      if (cadenceFilter !== 'all') {
        const friendly = friendlySchedule(job).toLowerCase()
        const expr = cronExpr(job)
        if (cadenceFilter === 'hourly' && !friendly.includes('hour') && !expr.startsWith('0 *')) return false
        if (cadenceFilter === 'daily' && !friendly.includes('daily') && !/^[\d*]+ \d+ \* \* \*/.test(expr)) return false
        if (cadenceFilter === 'weekly' && !friendly.includes('week') && !/^[\d*]+ \d+ \* \* \d/.test(expr)) return false
        if (cadenceFilter === 'custom' && (friendly.includes('hour') || friendly.includes('daily') || friendly.includes('week'))) return false
      }
      return true
    })
  }, [allJobs, debouncedSearch, statusFilter, cadenceFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const hasActiveFilters = debouncedSearch || statusFilter !== 'all' || cadenceFilter !== 'all'

  // keep page in bounds when filters change
  const prevFiltered = useRef(filtered.length)
  useEffect(() => {
    if (filtered.length !== prevFiltered.current) {
      prevFiltered.current = filtered.length
      setPage(1)
    }
  }, [filtered.length, setPage])

  return (
    <div data-screen="crons" className="cr-shell">
      {/* ── Header ── */}
      <div className="cr-header">
        <div className="cr-header-left">
          <h1>Cron Jobs</h1>
          <div className="cr-header-stats">
            <span><b>{totalCount}</b> Total</span>
            <div className="sep" />
            <span><b className="ok">{activeCount}</b> Active</span>
            <div className="sep" />
            <span><b>{pausedCount}</b> Paused</span>
            {errorCount > 0 && (
              <>
                <div className="sep" />
                <span><b className="err">{errorCount}</b> Error</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn-new-cron"
          onClick={openWizardNew}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Cron
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="cr-filter-bar">
        {/* Search */}
        <div className="cr-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search crons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="cr-pills-row">
          {/* Status pills */}
          <div className="cr-pill-group">
            <span className="cr-pill-label">Status</span>
            {(['all', 'active', 'paused', 'error'] as const).map((s) => (
              <FilterPill key={s} label={s === 'all' ? 'All' : s} value={s} active={statusFilter === s} onClick={setStatusFilter} />
            ))}
          </div>

          <div className="cr-pills-divider" />

          {/* Cadence pills */}
          <div className="cr-pill-group">
            <span className="cr-pill-label">Cadence</span>
            {(['all', 'hourly', 'daily', 'weekly', 'custom'] as const).map((c) => (
              <FilterPill key={c} label={c === 'all' ? 'All' : c} value={c} active={cadenceFilter === c} onClick={setCadenceFilter} />
            ))}
          </div>
        </div>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button type="button" className="cr-clear-filters" onClick={resetFilters}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}>
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
            Clear
          </button>
        )}

        {/* View toggle */}
        <div className="cr-view-toggle">
          <button
            type="button"
            className={viewMode === 'grid' ? 'on' : ''}
            title="Grid view"
            onClick={() => setViewMode('grid')}
          >
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="2" width="5" height="5" rx="1" />
              <rect x="2" y="9" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            className={viewMode === 'table' ? 'on' : ''}
            title="Table view"
            onClick={() => setViewMode('table')}
          >
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="3" width="12" height="2" rx="1" />
              <rect x="2" y="7" width="12" height="2" rx="1" />
              <rect x="2" y="11" width="12" height="2" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="cr-canvas">
        {cronsQuery.isLoading ? (
          <SkeletonGrid />
        ) : cronsQuery.isError ? (
          <div className="cr-error-banner">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6.5" />
              <line x1="8" y1="5" x2="8" y2="8.5" />
              <circle cx="8" cy="11" r=".6" fill="currentColor" stroke="none" />
            </svg>
            <span>
              Failed to load cron jobs.{' '}
              {cronsQuery.error instanceof Error ? cronsQuery.error.message : ''}
            </span>
            <button type="button" onClick={() => void cronsQuery.refetch()}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="cr-empty">
            <div className="cr-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5.25L15 14" strokeLinecap="round" />
              </svg>
            </div>
            <div className="cr-empty-title">
              {allJobs.length === 0 ? 'No cron jobs yet' : 'No crons match'}
            </div>
            <div className="cr-empty-desc">
              {allJobs.length === 0
                ? 'Get started — create your first cron job.'
                : 'Try a different search or clear the filters.'}
            </div>
            {allJobs.length === 0 && (
              <button
                type="button"
                className="btn-new-cron"
                style={{ marginTop: 12 }}
                onClick={openWizardNew}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create your first cron
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="cr-grid">
            {paginated.map((job) => (
              <CronCard
                key={job.id}
                job={job}
                onPause={(id) => pauseMutation.mutate(id)}
                onResume={(id) => resumeMutation.mutate(id)}
                onTrigger={(id) => triggerMutation.mutate(id)}
                onDelete={setDeleteTarget}
                onEdit={openWizardEdit}
                onOpen={openDrawer}
              />
            ))}
          </div>
        ) : (
          <table className="cr-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Schedule</th>
                <th>Status</th>
                <th>Last Run</th>
                <th>Agent</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((job) => (
                <CronTableRow
                  key={job.id}
                  job={job}
                  onPause={(id) => pauseMutation.mutate(id)}
                  onResume={(id) => resumeMutation.mutate(id)}
                  onTrigger={(id) => triggerMutation.mutate(id)}
                  onDelete={setDeleteTarget}
                  onEdit={openWizardEdit}
                  onOpen={openDrawer}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Paginator ── */}
      {!cronsQuery.isLoading && filtered.length > 0 && (
        <div className="cr-pager">
          <span className="cr-pager-info">
            {filtered.length} cron{filtered.length !== 1 ? 's' : ''}
            {hasActiveFilters ? ' (filtered)' : ''}
          </span>

          <div className="cr-pager-controls">
            <button
              type="button"
              className="cr-pager-btn"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="cr-pager-page">{safePage} / {totalPages}</span>
            <button
              type="button"
              className="cr-pager-btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="cr-pager-size">
            Per page
            <select
              value={viewMode === 'grid' ? pageSizeGrid : pageSizeTable}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {(viewMode === 'grid' ? PAGE_SIZES_GRID : PAGE_SIZES_TABLE).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete cron job?"
        message={`Delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ── Wizard (create / edit) ── */}
      <CronsWizard
        open={wizardOpen}
        editJob={editJob}
        onClose={() => setWizardOpen(false)}
        onSuccess={invalidate}
      />

      {/* ── Detail drawer ── */}
      <CronDetailDrawer
        job={drawerJob}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onEdit={(job) => { setDrawerOpen(false); openWizardEdit(job) }}
        onTrigger={(id) => triggerMutation.mutate(id)}
        onPause={(id) => pauseMutation.mutate(id)}
        onResume={(id) => resumeMutation.mutate(id)}
        onDelete={(job) => { setDeleteTarget(job); setDrawerOpen(false) }}
      />
    </div>
  )
}
