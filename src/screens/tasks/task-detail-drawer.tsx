'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, HierarchyIcon, CpuIcon, Alert02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import {
  kanbanPriorityLabel,
  kanbanPriorityColor,
  HERMES_KANBAN_STATUS_LABELS,
  HERMES_KANBAN_VISIBLE_STATUS_ORDER,
} from '@/lib/hermes-kanban-types'
import type { HermesKanbanTask, HermesKanbanTaskDetail, HermesKanbanStatus } from '@/lib/hermes-kanban-types'
import { updateTask, fetchAssignees, fetchTasks, addLink, removeLink, createTask, deleteTask, hardDeleteTask, COLUMN_COLORS, fetchHomeChannels, subscribeHomeChannel, unsubscribeHomeChannel } from '@/lib/tasks-api'
import type { HomeChannel } from '@/lib/tasks-api'
import { unionAssigneesWithProfiles } from '@/lib/assignee-profile-union'
import { TaskDialog } from './task-dialog'
import type { TaskDialogSubmit } from './task-dialog'

type LogResponse = { log: { content: string; exists: boolean; truncated: boolean; size_bytes: number } }

/** Normalise the skills field (string | string[] | null) → trimmed lowercase string[]. */
function normaliseSkills(raw: Array<string> | string | null | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(s => s.trim().toLowerCase()).filter(Boolean)
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

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

function HeaderMetaStrip({ td }: { td: HermesKanbanTask }) {
  const fields: Array<[string, string]> = []
  if (td.created_at) fields.push(['Created', relativeTime(td.created_at)])
  if (td.started_at) fields.push(['Started', relativeTime(td.started_at)])
  if (td.completed_at) fields.push(['Completed', relativeTime(td.completed_at)])
  if (td.tenant) fields.push(['Tenant', td.tenant])
  if (td.max_runtime_seconds) fields.push(['Runtime', `${td.max_runtime_seconds}s`])
  if (td.result) fields.push(['Result', td.result])
  const hasWarning = (td.spawn_failures ?? 0) > 0
  if (fields.length === 0 && !hasWarning) return null
  return (
    <div className="flex flex-col gap-1 pt-1.5 border-t border-[var(--theme-border)]/40">
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {fields.map(([label, value]) => (
            <span key={label} className="inline-flex items-center gap-1 text-[9px]">
              <span className="uppercase tracking-wide text-[var(--theme-muted)] opacity-60">{label}</span>
              <span className="text-[var(--theme-text)] opacity-80">{value}</span>
            </span>
          ))}
        </div>
      )}
      {hasWarning && (
        <div className="flex items-center gap-1 text-red-400 text-[9px]">
          <HugeiconsIcon icon={Alert02Icon} size={9} />
          <span>{td.spawn_failures} spawn failure(s){td.last_spawn_error ? `: ${td.last_spawn_error}` : ''}</span>
        </div>
      )}
    </div>
  )
}

export function TaskDetailDrawer({ task, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')
  const queryClient = useQueryClient()
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const isArchived = task.status === 'archived'

  async function handleArchive() {
    if (archiving) return
    setArchiving(true)
    try {
      await deleteTask(task.id)
      await queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      onClose()
    } finally {
      setArchiving(false)
    }
  }

  async function handleHardDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await hardDeleteTask(task.id)
      await queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      onClose()
    } finally {
      setDeleting(false)
    }
  }

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
    <div className="fixed inset-0 z-40 flex items-stretch justify-end py-3 pr-3">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer — floats with rounded corners */}
      <div className="relative z-10 flex h-full w-full max-w-xl flex-col bg-[var(--theme-card)] border border-[var(--theme-border)] shadow-2xl rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-1.5 border-b border-[var(--theme-border)] px-5 pt-3 pb-3">
          {/* Top row: task ID + actions */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-mono text-[var(--theme-muted)] truncate">{task.id}</p>
            <div className="flex items-center gap-1 shrink-0">
              {isArchived ? (
                <button
                  onClick={handleHardDelete}
                  disabled={deleting}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: '#ef4444' }}
                  title="Permanently delete this task — cannot be undone"
                >
                  {deleting ? 'Deleting…' : '🗑 Delete permanently'}
                </button>
              ) : (
                <button
                  onClick={handleArchive}
                  disabled={archiving}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-medium border border-[var(--theme-border)] text-[var(--theme-muted)] hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  {archiving ? 'Archiving…' : 'Archive'}
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-md p-1.5 hover:bg-[var(--theme-hover)] transition-colors"
                title="Close"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={15} className="text-[var(--theme-muted)]" />
              </button>
            </div>
          </div>
          {/* Title */}
          <h2 className="text-sm font-semibold text-[var(--theme-text)] line-clamp-2 leading-snug">{task.title}</h2>
          {/* Status / priority / assignee pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
              style={{ background: COLUMN_COLORS[task.status] }}>
              {HERMES_KANBAN_STATUS_LABELS[task.status]}
            </span>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
              style={{ background: kanbanPriorityColor(task.priority ?? 0) }}>
              {kanbanPriorityLabel(task.priority ?? 0)} priority
            </span>
            {task.assignee && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--theme-hover)] text-[var(--theme-muted)]">
                @{task.assignee}
              </span>
            )}
          </div>

          {/* Compact metadata strip — visible once detail loads */}
          {detail?.task && <HeaderMetaStrip td={detail.task} />}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--theme-border)] px-3 py-1 overflow-x-auto gap-0.5 shrink-0">
          {DRAWER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap rounded-lg',
                activeTab === tab
                  ? 'bg-[var(--theme-accent)] text-white shadow-sm'
                  : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)]',
              )}
            >
              {TAB_LABELS[tab]}
              {tab === 'comments' && (detail?.comments?.length ?? 0) > 0 && (
                <span className={cn('ml-1 text-[9px]', activeTab === tab ? 'opacity-70' : 'opacity-50')}>
                  {detail?.comments.length}
                </span>
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

function SkillsCombobox({
  selected,
  onChange,
  suggestions,
}: {
  selected: string[]
  onChange: (skills: string[]) => void
  suggestions: string[]
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const q = query.trim().toLowerCase()

  // Empty query → show all unselected suggestions. Typing → filter by substring.
  const options = (q
    ? suggestions.filter(s => s.includes(q))
    : suggestions
  ).filter(s => !selected.includes(s))

  function select(skill: string) {
    onChange([...selected, skill])
    setQuery('')
    // Keep dropdown open to allow selecting multiple skills in one pass.
  }

  function remove(skill: string) {
    onChange(selected.filter(s => s !== skill))
  }

  return (
    <div className="space-y-2">
      {/* Selected skill pills */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(skill => (
            <span key={skill}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-hover)] text-[var(--theme-text)]">
              {skill}
              <button type="button" onClick={() => remove(skill)}
                className="flex items-center hover:text-red-400 transition-colors">
                <HugeiconsIcon icon={Cancel01Icon} size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Filter input + suggestions dropdown */}
      <div className="relative">
        <input
          type="text"
          className={inputClass}
          value={query}
          placeholder={suggestions.length === 0 ? 'No skills found on this agent' : selected.length ? 'Filter to add more…' : 'Filter skills…'}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQuery('') } }}
        />

        {open && options.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-xl">
            {options.map(s => (
              <button key={s} type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => select(s)}
                className="w-full px-3 py-2 text-left text-xs hover:bg-[var(--theme-hover)] transition-colors text-[var(--theme-text)]">
                {q ? (
                  // Highlight the matching substring in accent colour
                  (() => {
                    const idx = s.indexOf(q)
                    return <>{s.slice(0, idx)}<span className="font-semibold text-[var(--theme-accent)]">{s.slice(idx, idx + q.length)}</span>{s.slice(idx + q.length)}</>
                  })()
                ) : s}
              </button>
            ))}
          </div>
        )}

        {open && q && options.length === 0 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 shadow-xl">
            <p className="text-xs text-[var(--theme-muted)]">No matching skills.</p>
          </div>
        )}
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [rescuing, setRescuing] = useState(false)

  const assigneesQuery = useQuery({
    queryKey: ['hermes-kanban', 'assignees'],
    queryFn: fetchAssignees,
    staleTime: 60_000,
  })
  const profilesQuery = useQuery({
    queryKey: ['profiles', 'list'],
    queryFn: () => fetch('/api/profiles/list').then(r => r.json()) as Promise<{ profiles: Array<{ name: string }>; activeProfile: string }>,
    staleTime: 60_000,
  })
  const assignees = assigneesQuery.data?.assignees ?? []
  const options = unionAssigneesWithProfiles(
    assignees,
    profilesQuery.data?.profiles ?? [],
    profilesQuery.data?.activeProfile,
  )
  const [assignee, setAssignee] = useState(td.assignee ?? '')

  const [skills, setSkills] = useState<string[]>(normaliseSkills(td.skills))

  // Re-sync server-driven fields whenever the underlying task data refreshes
  // (e.g. after rescue actions, SSE-triggered board updates, or manual refetch).
  // User-edited text fields (title, body, workspacePath) are intentionally
  // excluded so in-progress edits are not discarded mid-typing.
  useEffect(() => {
    setStatus(td.status)
    setAssignee(td.assignee ?? '')
    setBlockReason(td.block_reason ?? '')
    setSummary(td.summary ?? '')
    setWorkspaceKind(td.workspace_kind ?? '')
    setPriority(numericToFormPriority(td.priority ?? 0))
    setSaveError(null)
  }, [td.id, td.status, td.assignee, td.claim_lock, td.priority,
  td.block_reason, td.summary, td.workspace_kind])

  // Fetch the installed Hermes skills — same source as the Skills screen.
  // Query key matches ['skills-browser','installed'] so it shares the TanStack
  // cache if the Skills screen was already visited in this session.
  const installedSkillsQuery = useQuery({
    queryKey: ['skills-browser', 'installed'] as const,
    queryFn: async () => {
      const res = await fetch('/api/skills?tab=installed&limit=200')
      if (!res.ok) return { skills: [] as Array<{ name: string; enabled: boolean }> }
      return res.json() as Promise<{ skills: Array<{ name: string; enabled: boolean }> }>
    },
    staleTime: 5 * 60_000, // skills rarely change; 5-min cache
  })
  const skillSuggestions = (installedSkillsQuery.data?.skills ?? [])
    .filter(s => s.enabled !== false)
    .map(s => s.name.trim().toLowerCase())
    .filter(Boolean)
    .sort()

  const initialSkills = normaliseSkills(td.skills)
  const isDirty =
    title !== td.title ||
    body !== (td.body ?? '') ||
    status !== td.status ||
    formPriorityToNumeric(priority) !== (td.priority ?? 0) ||
    blockReason !== (td.block_reason ?? '') ||
    summary !== (td.summary ?? '') ||
    assignee !== (td.assignee ?? '') ||
    workspaceKind !== (td.workspace_kind ?? '') ||
    workspacePath !== (td.workspace_path ?? '') ||
    JSON.stringify([...skills].sort()) !== JSON.stringify([...initialSkills].sort())

  // Detected: task is in running state but the spawn failed
  const isSpawnFailed = td.status === 'running' && ((td.spawn_failures ?? 0) > 0 || !!td.last_spawn_error)
  // Detected: gateway will refuse assignee/profile change while claim_lock is held
  const isClaimLocked = !!td.claim_lock && td.status === 'running'

  async function handleSave() {
    if (!title.trim() || saving) return
    setSaving(true)
    setSaveError(null)
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
        skills: skills.length > 0 ? skills : null,
      })
      setSaveError(null)
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
      await queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleRescue(targetStatus: 'ready' | 'blocked') {
    if (rescuing) return
    setRescuing(true)
    try {
      await updateTask(task.id, {
        status: targetStatus,
        spawn_failures: 0,
        last_spawn_error: null,
        ...(targetStatus === 'ready'
          ? { claim_lock: null, worker_pid: null }
          : { block_reason: td.last_spawn_error ?? 'Spawn failure: profile not found' }),
      })
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
      await queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      if (targetStatus === 'ready') setStatus('ready')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Rescue failed')
    } finally {
      setRescuing(false)
    }
  }

  return (
    <div className="space-y-3">

      {/* ── Rescue banner: spawn failure or stale claim_lock ────────────── */}
      {(isSpawnFailed || isClaimLocked) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <HugeiconsIcon icon={Alert02Icon} size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-300 mb-0.5">
                {isSpawnFailed
                  ? `Task stuck — spawn failed ${(td.spawn_failures ?? 0) > 0 ? `(${td.spawn_failures}×)` : ''}`
                  : 'Task appears claimed but worker may have died'}
              </p>
              {isSpawnFailed && td.last_spawn_error && (
                <p className="text-[10px] text-amber-400/80 font-mono break-words leading-relaxed">
                  {td.last_spawn_error}
                </p>
              )}
              {!isSpawnFailed && (
                <p className="text-[10px] text-amber-400/80 leading-relaxed">
                  Reset to Ready to release the claim and re-queue.
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 pl-5">
            <button
              onClick={() => handleRescue('ready')}
              disabled={rescuing}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: '#8b5cf6' }}
            >
              {rescuing ? 'Resetting…' : 'Reset to Ready'}
            </button>
            {isSpawnFailed && (
              <button
                onClick={() => handleRescue('blocked')}
                disabled={rescuing}
                className="rounded-lg px-3 py-1.5 text-[11px] font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
              >
                Mark Blocked
              </button>
            )}
          </div>
        </div>
      )}

      {/* Title */}
      <div>
        <label className={labelClass}>Title</label>
        <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} />
      </div>

      {/* Task Description */}
      <div>
        <label className={labelClass}>Task Description</label>
        <textarea className={cn(inputClass, 'resize-none')} rows={5} value={body}
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

      {/* Agent profile + Notifications side-by-side */}
      <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
        <div>
          <label className={labelClass}>Agent profile</label>
          <select className={inputClass} style={{ colorScheme: 'dark' }}
            value={assignee} onChange={e => setAssignee(e.target.value)}
            disabled={isClaimLocked}>
            <option value="">Unassigned — any worker can claim</option>
            {options.map(({ id, label, onDisk }) => (
              <option key={id} value={id}>
                {onDisk ? label : `${label} ⚠ (profile not installed)`}
              </option>
            ))}
          </select>
          {isClaimLocked && (
            <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
              Profile cannot be changed while task is actively claimed. Use <span className="text-amber-400">Reset to Ready</span> above first.
            </p>
          )}
          {!isClaimLocked && assignee && !options.find(a => a.id === assignee)?.onDisk && (
            <p className="mt-1 text-[10px] text-amber-400 flex items-start gap-1">
              <span>⚠</span>
              <span>
                Profile <span className="font-mono">"{assignee}"</span> is not installed on disk — dispatching will fail.
                Run: <span className="font-mono">hermes profile create {assignee}</span>
              </span>
            </p>
          )}
          {!assignee && (
            <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
              The dispatcher will run this task as whichever agent profile claims it.
            </p>
          )}
        </div>
        <NotificationsSection taskId={task.id} compact />
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

      {/* Skills */}
      <div>
        <label className={labelClass}>Skills</label>
        <SkillsCombobox selected={skills} onChange={setSkills} suggestions={skillSuggestions} />
      </div>

      {/* Summary */}
      <div>
        <label className={labelClass}>Summary</label>
        <textarea className={cn(inputClass, 'resize-none')} rows={2} value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="Agent-written summary of work done…" />
      </div>

      {/* Save */}
      {(isDirty || saveError) && (
        <div className="flex flex-col gap-1.5 pt-1">
          {saveError && (
            <p className="text-[10px] text-red-400 flex items-start gap-1">
              <HugeiconsIcon icon={Alert02Icon} size={11} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </p>
          )}
          {isDirty && (
            <div className="flex justify-end">
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
    <div className="flex flex-col gap-0">
      {/* Message list */}
      <div className="flex flex-col gap-1.5 mb-3">
        {detail.comments.length === 0 && (
          <p className="text-xs text-[var(--theme-muted)] text-center py-4">No comments yet.</p>
        )}
        {detail.comments.map(c => {
          const isOwn = c.author === 'SwitchUI'
          return (
            <div key={c.id} className={cn('flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
              <div className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-xs',
                isOwn
                  ? 'rounded-br-sm text-white'
                  : 'rounded-bl-sm bg-[var(--theme-hover)] text-[var(--theme-text)]',
              )}
                style={isOwn ? { background: 'var(--theme-accent)' } : undefined}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{c.body}</p>
              </div>
              <div className={cn('flex items-center gap-1 px-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
                <span className="text-[9px] font-medium text-[var(--theme-muted)]">{c.author ?? 'Agent'}</span>
                <span className="text-[9px] text-[var(--theme-muted)] opacity-60">·</span>
                <span className="text-[9px] text-[var(--theme-muted)] opacity-60">{relativeTime(c.created_at)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Compose */}
      <div className="border-t border-[var(--theme-border)] pt-3">
        <textarea
          className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] resize-none focus:outline-none focus:border-[var(--theme-accent)] mb-2"
          rows={2}
          placeholder="Add a comment…"
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-[var(--theme-muted)] opacity-50">⌘↵ to send</span>
          <button
            onClick={submit}
            disabled={!body.trim() || submitting}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--theme-accent)' }}
          >
            {submitting ? 'Posting…' : 'Send'}
          </button>
        </div>
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

/**
 * The gateway may return links.parents/children as bare ID strings OR as full
 * task objects, depending on the plugin version. Normalise to task objects by
 * looking them up from the board cache; fall back to a minimal stub so the UI
 * never crashes on a missing field.
 */
function resolveLinked(
  raw: Array<HermesKanbanTask | string>,
  taskMap: Map<string, HermesKanbanTask>,
): HermesKanbanTask[] {
  return raw.map(entry => {
    if (typeof entry === 'string') {
      return taskMap.get(entry) ?? ({
        id: entry,
        title: entry,
        status: 'triage',
        priority: 0,
        body: null,
        assignee: null,
        created_by: null,
        created_at: 0,
        started_at: null,
        completed_at: null,
        workspace_kind: null,
        workspace_path: null,
        claim_lock: null,
        claim_expires: null,
        tenant: null,
        result: null,
        spawn_failures: 0,
        worker_pid: null,
        last_spawn_error: null,
        max_runtime_seconds: null,
        last_heartbeat_at: null,
        current_run_id: null,
        workflow_template_id: null,
        current_step_key: null,
        skills: null,
      } satisfies HermesKanbanTask)
    }
    return entry
  })
}

function DepsTab({ task, detail }: { task: HermesKanbanTask; detail: HermesKanbanTaskDetail }) {
  const rawLinks = detail.links ?? { parents: [], children: [] }
  const queryClient = useQueryClient()
  const [linking, setLinking] = useState(false)
  const [dialogMode, setDialogMode] = useState<'blocker' | 'unblocks' | null>(null)
  const [dialogSubmitting, setDialogSubmitting] = useState(false)

  const boardQuery = useQuery({
    queryKey: ['claude', 'tasks', 'all'],
    queryFn: () => fetchTasks({ include_done: true }),
    staleTime: 60_000,
  })
  const allTasks = boardQuery.data ?? []
  const taskMap = new Map(allTasks.map(t => [t.id, t]))

  const assigneesQuery = useQuery({
    queryKey: ['hermes-kanban', 'assignees'],
    queryFn: fetchAssignees,
    staleTime: 60_000,
  })
  const assignees = assigneesQuery.data?.assignees ?? []

  // Normalise: string IDs → full task objects (or stubs if not yet in board cache)
  const parents = resolveLinked(rawLinks.parents, taskMap)
  const children = resolveLinked(rawLinks.children, taskMap)

  const linkedIds = new Set([task.id, ...parents.map(p => p.id), ...children.map(c => c.id)])
  const parentCandidates = allTasks.filter(t => !linkedIds.has(t.id))
  const childCandidates = allTasks.filter(t => !linkedIds.has(t.id))

  async function handleAdd(parentId: string, childId: string) {
    setLinking(true)
    try {
      await addLink(parentId, childId)
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
    } finally { setLinking(false) }
  }

  async function handleRemove(parentId: string, childId: string) {
    setLinking(true)
    try {
      await removeLink(parentId, childId)
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
    } finally { setLinking(false) }
  }

  async function handleDialogSubmit(payload: TaskDialogSubmit) {
    if (!dialogMode) return
    setDialogSubmitting(true)
    try {
      const newTask = await createTask(payload.createInput)
      if (payload.desiredStatus) {
        await updateTask(newTask.id, {
          status: payload.desiredStatus,
          block_reason: payload.blockReason ?? null,
        })
      }
      if (dialogMode === 'blocker') await addLink(newTask.id, task.id)
      else await addLink(task.id, newTask.id)
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', task.id] })
      await queryClient.invalidateQueries({ queryKey: ['claude', 'tasks', 'all'] })
      await queryClient.invalidateQueries({ queryKey: ['claude', 'tasks'] })
      setDialogMode(null)
    } finally { setDialogSubmitting(false) }
  }

  const busy = linking || dialogSubmitting

  return (
    <div className="space-y-5">
      <p className="text-[10px] text-[var(--theme-muted)] mb-2">A task only becomes Ready once everything in "Blocked by" is Done.</p>

      {/* Blocked by */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <p className={labelClass}>
            <HugeiconsIcon icon={HierarchyIcon} size={11} className="inline mr-1 -mt-0.5" />
            Blocked by — must finish first ({parents.length})
          </p>
          <button onClick={() => setDialogMode('blocker')} disabled={busy}
            className="text-[10px] font-medium text-[var(--theme-accent)] hover:opacity-80 transition-opacity disabled:opacity-40">
            + Create new
          </button>
        </div>
        {parents.length === 0 && (
          <p className="text-xs text-[var(--theme-muted)]">Nothing blocks this task.</p>
        )}
        {parents.map(p => (
          <TaskRef key={p.id} task={p} onRemove={busy ? undefined : () => handleRemove(p.id, task.id)} />
        ))}
        <TaskCombobox placeholder="Search tasks that must finish before this one…"
          candidates={parentCandidates} disabled={busy}
          onSelect={t => handleAdd(t.id, task.id)} />
      </section>

      {/* Unblocks */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <p className={labelClass}>
            <HugeiconsIcon icon={HierarchyIcon} size={11} className="inline mr-1 -mt-0.5" />
            Unblocks — runs after this ({children.length})
          </p>
          <button onClick={() => setDialogMode('unblocks')} disabled={busy}
            className="text-[10px] font-medium text-[var(--theme-accent)] hover:opacity-80 transition-opacity disabled:opacity-40">
            + Create new
          </button>
        </div>
        {children.length === 0 && (
          <p className="text-xs text-[var(--theme-muted)]">This task does not block any others.</p>
        )}
        {children.map(c => (
          <TaskRef key={c.id} task={c} onRemove={busy ? undefined : () => handleRemove(task.id, c.id)} />
        ))}
        <TaskCombobox placeholder="Search tasks that should wait for this one…"
          candidates={childCandidates} disabled={busy}
          onSelect={t => handleAdd(task.id, t.id)} />
      </section>

      {/* TaskDialog for creating + auto-linking */}
      <TaskDialog
        open={dialogMode !== null}
        onOpenChange={(open) => { if (!open) setDialogMode(null) }}
        assignees={assignees}
        isSubmitting={dialogSubmitting}
        onSubmit={handleDialogSubmit}
      />
    </div>
  )
}

function NotificationsSection({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const queryClient = useQueryClient()
  const channelsQuery = useQuery({
    queryKey: ['hermes-kanban', 'home-channels', taskId],
    queryFn: () => fetchHomeChannels(taskId),
    staleTime: 30_000,
  })
  const [pending, setPending] = useState<string | null>(null)

  const channels: Array<HomeChannel> = channelsQuery.data?.channels ?? []
  if (channelsQuery.isLoading || channels.length === 0) return null

  async function toggle(platform: string, currentlySubscribed: boolean) {
    if (pending) return
    setPending(platform)
    try {
      if (currentlySubscribed) await unsubscribeHomeChannel(taskId, platform)
      else await subscribeHomeChannel(taskId, platform)
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'home-channels', taskId] })
      await queryClient.invalidateQueries({ queryKey: ['hermes-kanban', 'task', taskId] })
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <p className={labelClass}>Notify on done</p>
      <div className={compact ? 'flex flex-wrap gap-1.5' : 'space-y-1'}>
        {channels.map((ch) => {
          const subscribed = !!ch.subscribed
          const platformLabel = ch.platform.charAt(0).toUpperCase() + ch.platform.slice(1)
          return (
            <button
              key={ch.platform}
              onClick={() => toggle(ch.platform, subscribed)}
              disabled={pending === ch.platform}
              title={ch.name ? `${platformLabel} · ${ch.name}` : platformLabel}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border transition-colors disabled:opacity-50',
                compact
                  ? 'px-2 py-1.5 text-xs hover:bg-[var(--theme-hover)]'
                  : 'w-full px-3 py-2 text-left hover:bg-[var(--theme-hover)]',
                subscribed
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/10'
                  : 'border-[var(--theme-border)]',
              )}
            >
              <span className={cn(
                'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                subscribed
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]'
                  : 'border-[var(--theme-border)] bg-transparent',
              )}>
                {subscribed && <span className="text-white text-[9px] leading-none">✓</span>}
              </span>
              {compact ? (
                <span className="capitalize">{platformLabel}</span>
              ) : (
                <span className="text-xs flex-1">
                  Notify on completion via <span className="capitalize">{platformLabel}</span>
                  {ch.name ? <span className="text-[var(--theme-muted)]"> · {ch.name}</span> : null}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TaskRef({ task, onRemove }: { task: HermesKanbanTask; onRemove?: () => void }) {
  const displayId = task.id ?? '???'
  const displayTitle = task.title ?? displayId
  const displayStatus = HERMES_KANBAN_STATUS_LABELS[task.status] ?? task.status ?? '—'
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] px-3 py-2 mb-1.5 group">
      <span className="text-[10px] text-[var(--theme-muted)] font-mono shrink-0">{displayId.slice(0, 10)}</span>
      <span className="text-xs text-[var(--theme-text)] truncate flex-1">{displayTitle}</span>
      <span className="text-[10px] text-[var(--theme-muted)] shrink-0">{displayStatus}</span>
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

function outcomeColor(outcome: string): string {
  if (outcome === 'completed') return '#22c55e'
  if (outcome === 'crashed') return '#ef4444'
  return '#f59e0b'
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
              {run.outcome && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium capitalize"
                  style={{ background: outcomeColor(run.outcome) + '22', color: outcomeColor(run.outcome) }}
                >
                  {run.outcome}
                </span>
              )}
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
          {run.summary && (
            <div className="mt-1.5">
              <span className="text-[var(--theme-muted)] uppercase tracking-wide text-[9px] font-semibold">Summary</span>
              <p className="text-xs text-[var(--theme-text)] opacity-90 leading-relaxed mt-0.5">{run.summary}</p>
            </div>
          )}
          {run.metadata && Object.keys(run.metadata).length > 0 && (
            <div className="mt-1.5 rounded border border-[var(--theme-border)] p-1.5 bg-[var(--theme-surface)]">
              {Object.entries(run.metadata).map(([k, v]) => {
                const display =
                  typeof v === 'object' && v !== null
                    ? JSON.stringify(v).slice(0, 80)
                    : String(v).slice(0, 80)
                return (
                  <div key={k} className="flex gap-1.5 font-mono text-[10px] leading-relaxed">
                    <span className="text-[var(--theme-muted)] shrink-0">{k}</span>
                    <span className="text-[var(--theme-text)] opacity-80 truncate">{display}</span>
                  </div>
                )
              })}
            </div>
          )}
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

