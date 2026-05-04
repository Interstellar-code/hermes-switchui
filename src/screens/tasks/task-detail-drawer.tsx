'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, HierarchyIcon, CpuIcon, Alert02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  kanbanPriorityLabel,
  HERMES_KANBAN_STATUS_LABELS,
  HERMES_KANBAN_VISIBLE_STATUS_ORDER,
} from '@/lib/hermes-kanban-types'
import type { HermesKanbanTask, HermesKanbanTaskDetail, HermesKanbanStatus } from '@/lib/hermes-kanban-types'
import { updateTask, fetchAssignees, fetchTasks, addLink, removeLink } from '@/lib/tasks-api'

type LogResponse = { log: { content: string; exists: boolean; truncated: boolean; size_bytes: number } }

const PRIORITY_OPTIONS = [
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Normal', value: 'normal' },
  { label: 'Low', value: 'low' },
] as const
type FormPriority = (typeof PRIORITY_OPTIONS)[number]['value']

function numericToFormPriority(n: number): FormPriority {
  if (n >= 3) return 'high'
  if (n >= 1) return 'medium'
  if (n === 0) return 'normal'
  return 'low'
}
function formPriorityToNumeric(p: FormPriority): number {
  if (p === 'high') return 3
  if (p === 'medium') return 1
  if (p === 'normal') return 0
  return -1
}

const inputClass = cn(
  'w-full rounded-lg border px-3 py-2 text-sm',
  'bg-[var(--theme-input)] border-[var(--theme-border)] text-[var(--theme-text)]',
  'focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
  'placeholder:text-[var(--theme-muted)]',
)
const labelClass = 'block text-xs font-medium text-[var(--theme-muted)] mb-1'

const WORKSPACE_KIND_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'scratch', label: 'Scratch (auto temp dir)' },
  { value: 'git', label: 'Git repo' },
  { value: 'local', label: 'Local folder' },
  { value: 'remote', label: 'Remote' },
] as const

export const DRAWER_TABS = ['overview', 'comments', 'dependencies', 'runs', 'events', 'log'] as const
export type DrawerTab = typeof DRAWER_TABS[number]

const TAB_LABELS: Record<DrawerTab, string> = {
  overview: 'Overview',
  comments: 'Comments',
  dependencies: 'Dependencies',
  runs: 'Runs',
  events: 'Events',
  log: 'Log',
}

function runStatusColor(status: string): string {
  switch (status) {
    case 'success': return '#22c55e'
    case 'failure': return '#ef4444'
    case 'running': return '#f97316'
    default: return '#6b7280'
  }
}

function relativeTime(epochSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSeconds
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

type Props = {
  task: HermesKanbanTask
  onClose: () => void
}

export function TaskDetailDrawer({ task, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')

  const detailQuery = useQuery<HermesKanbanTaskDetail>({
    queryKey: ['hermes-kanban', 'task', task.id],
    queryFn: async () => {
      const res = await fetch(`/api/hermes-kanban/tasks/${task.id}`)
      if (!res.ok) throw new Error(`Failed to load task: ${res.status}`)
      return res.json() as Promise<HermesKanbanTaskDetail>
    },
    staleTime: 30_000,
  })

  const logQuery = useQuery({
    queryKey: ['hermes-kanban', 'task', task.id, 'log'],
    queryFn: async () => {
      const res = await fetch(`/api/hermes-kanban/tasks/${task.id}/log?tail=100`)
      if (!res.ok) throw new Error(`Log unavailable: ${res.status}`)
      return res.json() as Promise<LogResponse>
    },
    enabled: activeTab === 'log',
    staleTime: 10_000,
  })

  const detail = detailQuery.data

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative z-10 flex h-full w-full max-w-xl flex-col bg-[var(--theme-card)] border-l border-[var(--theme-border)] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--theme-border)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-mono text-[var(--theme-muted)] mb-0.5">{task.id}</p>
            <h2 className="text-sm font-semibold text-[var(--theme-text)] line-clamp-2">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]">
                {HERMES_KANBAN_STATUS_LABELS[task.status]}
              </span>
              <span className="text-[10px] text-[var(--theme-muted)]">
                {kanbanPriorityLabel(task.priority ?? 0)} priority
              </span>
              {task.assignee && (
                <span className="text-[10px] text-[var(--theme-muted)]">
                  @{task.assignee}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 hover:bg-[var(--theme-hover)] transition-colors">
            <HugeiconsIcon icon={Cancel01Icon} size={16} className="text-[var(--theme-muted)]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--theme-border)] px-4 overflow-x-auto gap-0 shrink-0">
          {DRAWER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap border-b-2 -mb-px',
                activeTab === tab
                  ? 'border-[var(--theme-accent)] text-[var(--theme-accent)]'
                  : 'border-transparent text-[var(--theme-muted)] hover:text-[var(--theme-text)]',
              )}
            >
              {TAB_LABELS[tab]}
              {tab === 'comments' && (detail?.comments?.length ?? 0) > 0 && (
                <span className="ml-1 text-[9px] opacity-60">{detail?.comments.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {detailQuery.isLoading && (
            <div className="space-y-2 animate-pulse">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-4 bg-[var(--theme-hover)] rounded w-full" />
              ))}
            </div>
          )}

          {detailQuery.isError && (
            <p className="text-xs text-red-400">Failed to load task detail.</p>
          )}

          {detail && (
            <>
              {activeTab === 'overview' && <OverviewTab task={task} detail={detail} />}
              {activeTab === 'comments' && <CommentsTab detail={detail} taskId={task.id} />}
              {activeTab === 'dependencies' && <DepsTab task={task} detail={detail} />}
              {activeTab === 'runs' && <RunsTab detail={detail} />}
              {activeTab === 'events' && <EventsTab detail={detail} />}
              {activeTab === 'log' && <LogTab query={logQuery} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ task, detail }: { task: HermesKanbanTask; detail: HermesKanbanTaskDetail }) {
  const td = detail.task ?? task
  const queryClient = useQueryClient()

  const [title, setTitle] = useState(td.title)
  const [body, setBody] = useState(td.body ?? '')
  const [status, setStatus] = useState<HermesKanbanStatus>(td.status)
  const [priority, setPriority] = useState<FormPriority>(numericToFormPriority(td.priority ?? 0))
  const [blockReason, setBlockReason] = useState(td.block_reason ?? '')
  const [summary, setSummary] = useState(td.summary ?? '')
  const [workspaceKind, setWorkspaceKind] = useState(td.workspace_kind ?? '')
  const [workspacePath, setWorkspacePath] = useState(td.workspace_path ?? '')
  const [saving, setSaving] = useState(false)

  const assigneesQuery = useQuery({
    queryKey: ['hermes-kanban', 'assignees'],
    queryFn: fetchAssignees,
    staleTime: 60_000,
  })
  const assignees = assigneesQuery.data?.assignees ?? []
  const [assignee, setAssignee] = useState(td.assignee ?? '')

  const isDirty =
    title !== td.title ||
    body !== (td.body ?? '') ||
    status !== td.status ||
    formPriorityToNumeric(priority) !== (td.priority ?? 0) ||
    blockReason !== (td.block_reason ?? '') ||
    summary !== (td.summary ?? '') ||
    assignee !== (td.assignee ?? '') ||
    workspaceKind !== (td.workspace_kind ?? '') ||
    workspacePath !== (td.workspace_path ?? '')

  async function handleSave() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await updateTask(task.id, {
        title: title.trim(),
        body: body.trim() || null,
        status,
        priority: formPriorityToNumeric(priority),
        assignee: assignee || null,
        block_reason: blockReason.trim() || null,
        summary: summary.trim() || null,
        workspace_kind: workspaceKind || null,
        workspace_path: workspacePath.trim() || null,
      })
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
      await queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Title */}
      <div>
        <label className={labelClass}>Title</label>
        <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} />
      </div>

      {/* Body */}
      <div>
        <label className={labelClass}>Body</label>
        <textarea className={cn(inputClass, 'resize-none')} rows={3} value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Acceptance criteria, context, links…" />
      </div>

      {/* Status + Priority */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Status</label>
          <select className={inputClass} style={{ colorScheme: 'dark' }}
            value={status} onChange={e => setStatus(e.target.value as HermesKanbanStatus)}>
            {HERMES_KANBAN_VISIBLE_STATUS_ORDER.map(s => (
              <option key={s} value={s}>{HERMES_KANBAN_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
            {status === 'triage' && 'Backlog — agent will not pick up automatically.'}
            {status === 'ready' && 'Dispatchable — agent can claim immediately.'}
            {status === 'todo' && 'Held — waiting on parent dependencies.'}
            {status === 'blocked' && 'Blocked — enter a reason below.'}
            {status === 'running' && 'Running — agent is actively working this task.'}
            {status === 'done' && 'Done — task is complete.'}
          </p>
        </div>
        <div>
          <label className={labelClass}>Priority</label>
          <select className={inputClass} style={{ colorScheme: 'dark' }}
            value={priority} onChange={e => setPriority(e.target.value as FormPriority)}>
            {PRIORITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Block reason — conditional */}
      {status === 'blocked' && (
        <div>
          <label className={labelClass}>Block reason</label>
          <input className={inputClass} value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            placeholder="Why is this task blocked?" />
        </div>
      )}

      {/* Assignee */}
      <div>
        <label className={labelClass}>Assignee</label>
        <select className={inputClass} style={{ colorScheme: 'dark' }}
          value={assignee} onChange={e => setAssignee(e.target.value)}>
          <option value="">Unassigned</option>
          {assignees.map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      {/* Workspace kind + path */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Workspace type</label>
          <select className={inputClass} style={{ colorScheme: 'dark' }}
            value={workspaceKind} onChange={e => setWorkspaceKind(e.target.value)}>
            {WORKSPACE_KIND_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Workspace path</label>
          <input className={inputClass} value={workspacePath}
            onChange={e => setWorkspacePath(e.target.value)}
            placeholder="/path/to/repo (optional)" />
        </div>
      </div>

      {/* Summary */}
      <div>
        <label className={labelClass}>Summary</label>
        <textarea className={cn(inputClass, 'resize-none')} rows={2} value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="Agent-written summary of work done…" />
      </div>

      {/* Save */}
      {isDirty && (
        <div className="flex justify-end pt-1">
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--theme-accent)' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {/* Read-only metadata */}
      {(td.tenant || td.skills || td.max_runtime_seconds || td.result ||
        td.created_at || td.started_at || td.completed_at || (td.spawn_failures ?? 0) > 0) && (
          <div className="pt-2 border-t border-[var(--theme-border)] space-y-2">
            <p className={labelClass}>Task metadata</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {td.tenant && <MetaField label="Tenant" value={td.tenant} />}
              {td.max_runtime_seconds && <MetaField label="Max runtime" value={`${td.max_runtime_seconds}s`} />}
              {td.skills && <MetaField label="Skills" value={Array.isArray(td.skills) ? td.skills.join(', ') : String(td.skills)} />}
              {td.result && <MetaField label="Result" value={td.result} />}
              {td.created_at && <MetaField label="Created" value={relativeTime(td.created_at)} />}
              {td.started_at && <MetaField label="Started" value={relativeTime(td.started_at)} />}
              {td.completed_at && <MetaField label="Completed" value={relativeTime(td.completed_at)} />}
            </div>
            {(td.spawn_failures ?? 0) > 0 && (
              <div className="flex items-center gap-1.5 text-red-400 text-xs">
                <HugeiconsIcon icon={Alert02Icon} size={12} />
                <span>{td.spawn_failures} spawn failure(s){td.last_spawn_error ? `: ${td.last_spawn_error}` : ''}</span>
              </div>
            )}
          </div>
        )}
    </div>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[var(--theme-muted)] uppercase tracking-wide text-[9px] mb-0.5">{label}</p>
      <p className="text-[var(--theme-text)] break-words text-xs">{value}</p>
    </div>
  )
}

function CommentsTab({ detail, taskId }: { detail: HermesKanbanTaskDetail; taskId: string }) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const queryClient = useQueryClient()

  async function submit() {
    if (!body.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/hermes-kanban/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim(), author: 'SwitchUI' }),
      })
      if (res.ok) {
        setBody('')
        await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', taskId] })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      {detail.comments.length === 0 && (
        <p className="text-xs text-[var(--theme-muted)]">No comments yet.</p>
      )}
      {detail.comments.map(c => (
        <div key={c.id} className="rounded-lg border border-[var(--theme-border)] p-3 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-[var(--theme-text)]">{c.author ?? 'Unknown'}</span>
            <span className="text-[var(--theme-muted)]">{relativeTime(c.created_at)}</span>
          </div>
          <p className="text-[var(--theme-muted)] whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}
      <div className="pt-2 border-t border-[var(--theme-border)]">
        <textarea
          className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] resize-none focus:outline-none focus:border-[var(--theme-accent)] mb-2"
          rows={3}
          placeholder="Add a comment…"
          value={body}
          onChange={e => setBody(e.target.value)}
        />
        <button
          onClick={submit}
          disabled={!body.trim() || submitting}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--theme-accent)' }}
        >
          {submitting ? 'Posting…' : 'Post comment'}
        </button>
      </div>
    </div>
  )
}

/** Combobox for searching + selecting a task to link. */
function TaskCombobox({
  placeholder,
  candidates,
  onSelect,
  disabled,
}: {
  placeholder: string
  candidates: HermesKanbanTask[]
  onSelect: (task: HermesKanbanTask) => void
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = query.trim()
    ? candidates.filter(t =>
      t.id.toLowerCase().includes(query.toLowerCase()) ||
      t.title.toLowerCase().includes(query.toLowerCase()),
    )
    : candidates

  return (
    <div className="relative mt-2">
      <input
        className={inputClass}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-xl">
          {filtered.map(t => (
            <button
              key={t.id}
              onMouseDown={e => e.preventDefault()} // keep focus on input so onBlur fires after
              onClick={() => { onSelect(t); setQuery(''); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--theme-hover)] transition-colors"
            >
              <span className="text-[10px] font-mono text-[var(--theme-muted)] shrink-0 uppercase">{t.id}</span>
              <span className="text-xs text-[var(--theme-text)] truncate">— {t.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DepsTab({ task, detail }: { task: HermesKanbanTask; detail: HermesKanbanTaskDetail }) {
  const { parents, children } = detail.links ?? { parents: [], children: [] }
  const queryClient = useQueryClient()
  const [linking, setLinking] = useState(false)

  // Fetch all board tasks for the autocomplete (uses shared TanStack cache)
  const boardQuery = useQuery({
    queryKey: ['claude', 'tasks', 'all'],
    queryFn: () => fetchTasks({ include_done: true }),
    staleTime: 60_000,
  })
  const allTasks = boardQuery.data ?? []

  const linkedIds = new Set([task.id, ...parents.map(p => p.id), ...children.map(c => c.id)])
  const parentCandidates = allTasks.filter(t => !linkedIds.has(t.id))
  const childCandidates = allTasks.filter(t => !linkedIds.has(t.id))

  async function handleAdd(parentId: string, childId: string) {
    setLinking(true)
    try {
      await addLink(parentId, childId)
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
    } finally {
      setLinking(false)
    }
  }

  async function handleRemove(parentId: string, childId: string) {
    setLinking(true)
    try {
      await removeLink(parentId, childId)
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Parents */}
      <section>
        <p className={labelClass}>
          <HugeiconsIcon icon={HierarchyIcon} size={11} className="inline mr-1 -mt-0.5" />
          Parents ({parents.length})
        </p>
        {parents.length === 0 ? (
          <p className="text-xs text-[var(--theme-muted)]">No parent dependencies.</p>
        ) : parents.map(p => (
          <TaskRef key={p.id} task={p} onRemove={linking ? undefined : () => handleRemove(p.id, task.id)} />
        ))}
        <TaskCombobox
          placeholder="Search tasks to add as parent…"
          candidates={parentCandidates}
          disabled={linking}
          onSelect={t => handleAdd(t.id, task.id)}
        />
      </section>

      {/* Children */}
      <section>
        <p className={labelClass}>
          <HugeiconsIcon icon={HierarchyIcon} size={11} className="inline mr-1 -mt-0.5" />
          Children / subtasks ({children.length})
        </p>
        {children.length === 0 ? (
          <p className="text-xs text-[var(--theme-muted)]">No child tasks.</p>
        ) : children.map(c => (
          <TaskRef key={c.id} task={c} onRemove={linking ? undefined : () => handleRemove(task.id, c.id)} />
        ))}
        <TaskCombobox
          placeholder="Search tasks to add as child…"
          candidates={childCandidates}
          disabled={linking}
          onSelect={t => handleAdd(task.id, t.id)}
        />
      </section>
    </div>
  )
}

function TaskRef({ task, onRemove }: { task: HermesKanbanTask; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] px-3 py-2 mb-1.5 group">
      <span className="text-[10px] text-[var(--theme-muted)] font-mono shrink-0">{task.id.slice(0, 10)}</span>
      <span className="text-xs text-[var(--theme-text)] truncate flex-1">{task.title}</span>
      <span className="text-[10px] text-[var(--theme-muted)] shrink-0">{HERMES_KANBAN_STATUS_LABELS[task.status]}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-[var(--theme-hover)] transition-opacity"
          title="Remove link"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} className="text-[var(--theme-muted)]" />
        </button>
      )}
    </div>
  )
}

function RunsTab({ detail }: { detail: HermesKanbanTaskDetail }) {
  return (
    <div className="space-y-2">
      {detail.runs.length === 0 && <p className="text-xs text-[var(--theme-muted)]">No runs recorded.</p>}
      {detail.runs.map(run => (
        <div key={run.id} className="rounded-lg border border-[var(--theme-border)] p-3 text-xs">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: runStatusColor(run.status) }} />
              <span className="font-medium capitalize">{run.status}</span>
              {run.worker_pid && (
                <span className="flex items-center gap-0.5 text-[var(--theme-muted)]">
                  <HugeiconsIcon icon={CpuIcon} size={10} /> PID {run.worker_pid}
                </span>
              )}
            </div>
            {run.started_at && (
              <span className="text-[var(--theme-muted)]">{relativeTime(run.started_at)}</span>
            )}
          </div>
          {run.error && <p className="text-red-400 text-[10px] mt-1">{run.error}</p>}
        </div>
      ))}
    </div>
  )
}

const EVENT_KIND_COLORS: Record<string, string> = {
  created: '#22c55e',
  claimed: '#3b82f6',
  spawned: '#f97316',
  unclaimed: '#6b7280',
  completed: '#22c55e',
  failed: '#ef4444',
  status_changed: '#a78bfa',
  heartbeat: '#374151',
  timed_out: '#ef4444',
}

function eventKindColor(kind: string): string {
  return EVENT_KIND_COLORS[kind] ?? '#6b7280'
}

function eventPayloadSummary(kind: string, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (kind === 'created') {
    const parts: string[] = []
    if (p.status) parts.push(`status: ${p.status}`)
    if (p.assignee) parts.push(`assignee: ${p.assignee}`)
    return parts.join(' · ') || null
  }
  if (kind === 'status_changed') {
    return p.from && p.to ? `${p.from} → ${p.to}` : null
  }
  if (kind === 'claimed') {
    return p.lock ? `by ${String(p.lock).split(':')[0]}` : null
  }
  if (kind === 'spawned') {
    return p.pid ? `PID ${p.pid}` : null
  }
  if (kind === 'failed') {
    return typeof p.error === 'string' ? p.error.slice(0, 80) : null
  }
  return null
}

function EventsTab({ detail }: { detail: HermesKanbanTaskDetail }) {
  if (detail.events.length === 0) {
    return <p className="text-xs text-[var(--theme-muted)]">No events recorded.</p>
  }
  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--theme-border)]" />
      <div className="space-y-3">
        {detail.events.map(ev => {
          const color = eventKindColor(ev.kind)
          const summary = eventPayloadSummary(ev.kind, ev.payload)
          return (
            <div key={ev.id} className="flex items-start gap-3 pl-1">
              {/* Dot */}
              <span className="relative z-10 mt-1 w-3 h-3 rounded-full shrink-0 ring-2 ring-[var(--theme-card)]"
                style={{ background: color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-[var(--theme-text)] capitalize">
                    {ev.kind.replace(/_/g, ' ')}
                  </span>
                  {ev.run_id != null && (
                    <span className="text-[10px] text-[var(--theme-muted)] font-mono">run #{ev.run_id}</span>
                  )}
                  <span className="ml-auto text-[10px] text-[var(--theme-muted)] tabular-nums shrink-0">
                    {relativeTime(ev.created_at)}
                  </span>
                </div>
                {summary && (
                  <p className="text-[11px] text-[var(--theme-muted)] mt-0.5 truncate">{summary}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LogTab({ query }: { query: ReturnType<typeof useQuery> }) {
  if (query.isLoading) return <p className="text-xs text-[var(--theme-muted)] animate-pulse">Loading log…</p>
  if (query.isError) return <p className="text-xs text-red-400">Worker log unavailable.</p>
  const logObj = (query.data as LogResponse | undefined)?.log
  if (!logObj?.exists) return <p className="text-xs text-[var(--theme-muted)]">No log file for this task yet.</p>
  if (!logObj.content) return <p className="text-xs text-[var(--theme-muted)]">Log is empty.</p>
  return (
    <div className="space-y-1">
      {logObj.truncated && (
        <p className="text-[10px] text-[var(--theme-muted)] italic">
          Showing tail of {logObj.size_bytes.toLocaleString()} byte log.
        </p>
      )}
      <pre className="text-[10px] font-mono text-[var(--theme-text)] whitespace-pre-wrap break-all leading-relaxed">
        {logObj.content}
      </pre>
    </div>
  )
}

