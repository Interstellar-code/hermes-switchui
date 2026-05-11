'use client'

/**
 * CR-07 — Cron Detail Drawer
 * Right-side drawer (~560px). Tabs: Overview | Prompt | Run History
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { fetchJobOutput } from '@/lib/jobs-api'
import type { ClaudeJob, JobOutput } from '@/lib/jobs-api'

type Tab = 'overview' | 'prompt' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'history', label: 'Run History' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function cronExpr(job: ClaudeJob): string {
  const s = job.schedule
  if (!s || typeof s !== 'object') return ''
  return ((s as Record<string, unknown>).cron_expression as string) ?? ''
}

function friendlySchedule(job: ClaudeJob): string {
  if (job.schedule_display) return job.schedule_display
  const expr = cronExpr(job)
  if (!expr) return 'custom'
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return expr
  const [min, hour, dom, , dow] = parts
  if (min !== '*' && hour === '*') return `Every hour at :${min.padStart(2, '0')}`
  if (dom === '*' && dow === '*') return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  if (dom === '*' && dow !== '*') return `Weekly`
  if (dom !== '*' && dow === '*') return `Monthly`
  return expr
}

function jobStatus(job: ClaudeJob): 'active' | 'paused' | 'error' | 'idle' {
  if (job.state === 'failed' || job.state === 'error' || job.last_run_success === false) return 'error'
  if (job.state === 'paused' || !job.enabled) return 'paused'
  if (job.state === 'running' || job.state === 'active') return 'active'
  if (job.last_run_at) return 'active'
  return 'idle'
}

function getTagsMeta(job: ClaudeJob): { agentId: string | null; tz: string | null; isDraft: boolean; userTags: string[] } {
  const tags: string[] = Array.isArray((job as unknown as Record<string, unknown>).tags)
    ? ((job as unknown as Record<string, unknown>).tags as string[])
    : []
  return {
    agentId: tags.find((t) => t.startsWith('agent:'))?.slice('agent:'.length) ?? null,
    tz: tags.find((t) => t.startsWith('tz:'))?.slice('tz:'.length) ?? null,
    isDraft: tags.includes('state:draft'),
    userTags: tags.filter(
      (t) => !t.startsWith('agent:') && !t.startsWith('glyph:') && !t.startsWith('tz:') && !t.startsWith('state:'),
    ),
  }
}

function getGlyph(job: ClaudeJob): string {
  const tags: string[] = Array.isArray((job as unknown as Record<string, unknown>).tags)
    ? ((job as unknown as Record<string, unknown>).tags as string[])
    : []
  const glyphTag = tags.find((t) => t.startsWith('glyph:'))
  return glyphTag ? glyphTag.slice('glyph:'.length) : '⚙'
}

// ── Tab: Overview ──────────────────────────────────────────────────────────────

function TabOverview({
  job,
  onEdit,
  onTrigger,
  onPause,
  onResume,
  onDelete,
}: {
  job: ClaudeJob
  onEdit: () => void
  onTrigger: () => void
  onPause: () => void
  onResume: () => void
  onDelete: () => void
}) {
  const status = jobStatus(job)
  const expr = cronExpr(job)
  const friendly = friendlySchedule(job)
  const meta = getTagsMeta(job)
  const isBuiltin = Array.isArray((job as unknown as Record<string, unknown>).tags)
    ? ((job as unknown as Record<string, unknown>).tags as string[]).includes('builtin')
    : false

  return (
    <div className="cr-drawer-tab-body">
      {/* Actions */}
      <div className="cr-drawer-actions">
        <button type="button" className="cr-drawer-action-btn" onClick={onTrigger} title="Run now">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5l8 4.5-8 4.5V3.5z" /></svg>
          Run now
        </button>
        {status === 'paused' ? (
          <button type="button" className="cr-drawer-action-btn" onClick={onResume} title="Resume">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5l8 4.5-8 4.5V3.5z" /></svg>
            Resume
          </button>
        ) : (
          <button type="button" className="cr-drawer-action-btn" onClick={onPause} title="Pause">
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="4" y="3" width="3" height="10" rx="1" />
              <rect x="9" y="3" width="3" height="10" rx="1" />
            </svg>
            Pause
          </button>
        )}
        {!isBuiltin && (
          <>
            <button type="button" className="cr-drawer-action-btn" onClick={onEdit} title="Edit">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z" strokeLinejoin="round" />
              </svg>
              Edit
            </button>
            <button type="button" className="cr-drawer-action-btn cr-drawer-action-btn--danger" onClick={onDelete} title="Delete">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9.5h5L11 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Delete
            </button>
          </>
        )}
      </div>

      {/* Schedule block */}
      <div className="cr-drawer-section">
        <div className="cr-drawer-section-title">Schedule</div>
        <div className="cr-drawer-cron-expr">{expr || '—'}</div>
        <div className="cr-drawer-cron-friendly">{friendly}</div>
      </div>

      {/* Meta grid */}
      <div className="cr-drawer-meta-grid">
        <div className="cr-drawer-meta-item">
          <span className="cr-drawer-meta-key">Next run</span>
          <span className="cr-drawer-meta-val">{relativeTime(job.next_run_at)}</span>
        </div>
        <div className="cr-drawer-meta-item">
          <span className="cr-drawer-meta-key">Last run</span>
          <span className="cr-drawer-meta-val">{relativeTime(job.last_run_at)}</span>
        </div>
        <div className="cr-drawer-meta-item">
          <span className="cr-drawer-meta-key">Total runs</span>
          <span className="cr-drawer-meta-val">{job.run_count ?? '—'}</span>
        </div>
        <div className="cr-drawer-meta-item">
          <span className="cr-drawer-meta-key">Agent</span>
          <span className="cr-drawer-meta-val">{meta.agentId ?? '—'}</span>
        </div>
        <div className="cr-drawer-meta-item">
          <span className="cr-drawer-meta-key">Timezone</span>
          <span className="cr-drawer-meta-val">{meta.tz ?? 'UTC'}</span>
        </div>
        <div className="cr-drawer-meta-item">
          <span className="cr-drawer-meta-key">Status</span>
          <span className="cr-drawer-meta-val">{status}</span>
        </div>
      </div>

      {/* Tags */}
      {meta.userTags.length > 0 && (
        <div className="cr-drawer-section">
          <div className="cr-drawer-section-title">Tags</div>
          <div className="cr-wiz-chip-row">
            {meta.userTags.map((t) => (
              <span key={t} className="cr-chip">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Prompt ────────────────────────────────────────────────────────────────

function TabPrompt({ job }: { job: ClaudeJob }) {
  function copyPrompt() {
    void navigator.clipboard.writeText(job.prompt ?? '').then(() => toast('Prompt copied'))
  }

  return (
    <div className="cr-drawer-tab-body">
      <div className="cr-drawer-section">
        <div className="cr-drawer-section-header">
          <div className="cr-drawer-section-title">Prompt</div>
          <button type="button" className="cr-drawer-copy-btn" onClick={copyPrompt} title="Copy prompt">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="5" width="8" height="9" rx="1" />
              <path d="M3 11V3h8" />
            </svg>
            Copy
          </button>
        </div>
        <pre className="cr-drawer-prompt-body">{job.prompt || '(no prompt)'}</pre>
      </div>
    </div>
  )
}

// ── Tab: Run History ───────────────────────────────────────────────────────────

function TabHistory({ job }: { job: ClaudeJob }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const historyQuery = useQuery({
    queryKey: ['crons', 'output', job.id],
    queryFn: () => fetchJobOutput(job.id, 10),
    staleTime: 15_000,
  })

  function toggleExpand(filename: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }

  if (historyQuery.isLoading) {
    return (
      <div className="cr-drawer-tab-body">
        <div className="cr-drawer-loading">Loading run history…</div>
      </div>
    )
  }

  if (historyQuery.isError) {
    return (
      <div className="cr-drawer-tab-body">
        <div className="cr-drawer-error-msg">
          Failed to load run history.{' '}
          <button type="button" className="cr-drawer-retry-btn" onClick={() => void historyQuery.refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const outputs: JobOutput[] = historyQuery.data ?? []

  if (outputs.length === 0) {
    return (
      <div className="cr-drawer-tab-body">
        <div className="cr-drawer-empty-msg">
          Run history will appear after first execution.
        </div>
      </div>
    )
  }

  return (
    <div className="cr-drawer-tab-body">
      <div className="cr-drawer-section">
        <div className="cr-drawer-section-title">Recent runs ({outputs.length})</div>
        <div className="cr-drawer-history-list">
          {outputs.map((out) => {
            const isExpanded = expanded.has(out.filename)
            const preview = out.content.slice(0, 200)
            const hasMore = out.content.length > 200
            return (
              <div key={out.filename} className="cr-drawer-history-item">
                <div className="cr-drawer-history-meta">
                  <span className="cr-drawer-history-time">{relativeTime(out.timestamp)}</span>
                  <span className="cr-drawer-history-filename">{out.filename}</span>
                  <span className="cr-drawer-history-size">{out.size}B</span>
                </div>
                <pre className="cr-drawer-history-preview">
                  {isExpanded ? out.content : preview}
                  {!isExpanded && hasMore ? '…' : ''}
                </pre>
                {hasMore && (
                  <button
                    type="button"
                    className="cr-drawer-show-full-btn"
                    onClick={() => toggleExpand(out.filename)}
                  >
                    {isExpanded ? 'Show less' : 'Show full'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main drawer ────────────────────────────────────────────────────────────────

type Props = {
  job: ClaudeJob | null
  open: boolean
  onClose: () => void
  onEdit: (job: ClaudeJob) => void
  onTrigger: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onDelete: (job: ClaudeJob) => void
}

export function CronDetailDrawer({
  job,
  open,
  onClose,
  onEdit,
  onTrigger,
  onPause,
  onResume,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  useEffect(() => {
    if (job) setTab('overview')
  }, [job?.id])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !job) return null

  const status = jobStatus(job)
  const glyph = getGlyph(job)

  return createPortal(
    <>
      <div className="cr-drawer-backdrop" onClick={onClose} />
      <div className="cr-drawer" role="dialog" aria-modal="true" aria-label={`Cron: ${job.name}`}>
        {/* Header */}
        <div className="cr-drawer-head">
          <div className="cr-drawer-head-left">
            <span className="cr-drawer-glyph">{glyph}</span>
            <div className="cr-drawer-head-info">
              <div className="cr-drawer-head-name">{job.name || '(unnamed)'}</div>
              <span className={`cr-status-pill cr-status-pill--${status}`}>
                <span className="dot" />
                {status}
              </span>
            </div>
          </div>
          <button type="button" className="cr-drawer-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="cr-drawer-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`cr-drawer-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && (
          <TabOverview
            job={job}
            onEdit={() => onEdit(job)}
            onTrigger={() => onTrigger(job.id)}
            onPause={() => onPause(job.id)}
            onResume={() => onResume(job.id)}
            onDelete={() => setDeleteConfirm(true)}
          />
        )}
        {tab === 'prompt' && <TabPrompt job={job} />}
        {tab === 'history' && <TabHistory job={job} />}
      </div>

      <ConfirmDialog
        open={deleteConfirm}
        title="Delete cron job?"
        message={`Delete "${job.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setDeleteConfirm(false)
          onDelete(job)
          onClose()
        }}
        onCancel={() => setDeleteConfirm(false)}
      />
    </>,
    document.body,
  )
}
