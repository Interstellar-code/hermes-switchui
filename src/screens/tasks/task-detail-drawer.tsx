'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, BubbleChatIcon, HierarchyIcon, CpuIcon, Alert02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { kanbanPriorityLabel, HERMES_KANBAN_STATUS_LABELS } from '@/lib/hermes-kanban-types'
import type { HermesKanbanTask, HermesKanbanTaskDetail } from '@/lib/hermes-kanban-types'

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
      return res.json() as Promise<{ log: unknown }>
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
              {activeTab === 'dependencies' && <DepsTab detail={detail} />}
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
  const taskData = detail.task ?? task
  return (
    <div className="space-y-4 text-xs">
      {taskData.body && (
        <div>
          <p className="text-[var(--theme-muted)] uppercase tracking-wide text-[9px] mb-1">Body</p>
          <p className="text-[var(--theme-text)] whitespace-pre-wrap">{taskData.body}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {taskData.tenant && <Field label="Tenant" value={taskData.tenant} />}
        {taskData.workspace_kind && <Field label="Workspace" value={`${taskData.workspace_kind}${taskData.workspace_path ? ` — ${taskData.workspace_path}` : ''}`} />}
        {taskData.max_runtime_seconds && <Field label="Max runtime" value={`${taskData.max_runtime_seconds}s`} />}
        {taskData.skills && <Field label="Skills" value={Array.isArray(taskData.skills) ? taskData.skills.join(', ') : String(taskData.skills)} />}
        {taskData.result && <Field label="Result" value={taskData.result} />}
        {taskData.block_reason && <Field label="Block reason" value={taskData.block_reason} />}
        {taskData.summary && <Field label="Summary" value={taskData.summary} />}
        {taskData.created_at && <Field label="Created" value={relativeTime(taskData.created_at)} />}
        {taskData.started_at && <Field label="Started" value={relativeTime(taskData.started_at)} />}
        {taskData.completed_at && <Field label="Completed" value={relativeTime(taskData.completed_at)} />}
      </div>
      {(taskData.spawn_failures ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 text-red-400 text-xs">
          <HugeiconsIcon icon={Alert02Icon} size={12} />
          <span>{taskData.spawn_failures} spawn failure(s){taskData.last_spawn_error ? `: ${taskData.last_spawn_error}` : ''}</span>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[var(--theme-muted)] uppercase tracking-wide text-[9px] mb-0.5">{label}</p>
      <p className="text-[var(--theme-text)] break-words">{value}</p>
    </div>
  )
}

function CommentsTab({ detail, taskId }: { detail: HermesKanbanTaskDetail; taskId: string }) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await fetch(`/api/hermes-kanban/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim(), author: 'SwitchUI' }),
      })
      setBody('')
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

function DepsTab({ detail }: { detail: HermesKanbanTaskDetail }) {
  const { parents, children } = detail.links ?? { parents: [], children: [] }
  return (
    <div className="space-y-4 text-xs">
      <section>
        <p className="text-[var(--theme-muted)] uppercase tracking-wide text-[9px] mb-2 flex items-center gap-1">
          <HugeiconsIcon icon={HierarchyIcon} size={10} /> Parents ({parents.length})
        </p>
        {parents.length === 0 ? (
          <p className="text-[var(--theme-muted)]">No parent dependencies.</p>
        ) : parents.map(p => <TaskRef key={p.id} task={p} />)}
      </section>
      <section>
        <p className="text-[var(--theme-muted)] uppercase tracking-wide text-[9px] mb-2 flex items-center gap-1">
          <HugeiconsIcon icon={HierarchyIcon} size={10} /> Children / subtasks ({children.length})
        </p>
        {children.length === 0 ? (
          <p className="text-[var(--theme-muted)]">No child tasks.</p>
        ) : children.map(c => <TaskRef key={c.id} task={c} />)}
      </section>
    </div>
  )
}

function TaskRef({ task }: { task: HermesKanbanTask }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] px-3 py-2 mb-1.5">
      <span className="text-[10px] text-[var(--theme-muted)] font-mono shrink-0">{task.id.slice(0, 10)}</span>
      <span className="text-xs text-[var(--theme-text)] truncate">{task.title}</span>
      <span className="ml-auto text-[10px] text-[var(--theme-muted)] shrink-0">{HERMES_KANBAN_STATUS_LABELS[task.status]}</span>
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

function EventsTab({ detail }: { detail: HermesKanbanTaskDetail }) {
  return (
    <div className="space-y-1.5">
      {detail.events.length === 0 && <p className="text-xs text-[var(--theme-muted)]">No events recorded.</p>}
      {detail.events.map(ev => (
        <div key={ev.id} className="flex items-start gap-2 text-xs">
          <span className="text-[var(--theme-muted)] tabular-nums shrink-0">{relativeTime(ev.created_at)}</span>
          <span className="text-[var(--theme-text)]">{ev.event_type}</span>
        </div>
      ))}
    </div>
  )
}

function LogTab({ query }: { query: ReturnType<typeof useQuery> }) {
  if (query.isLoading) return <p className="text-xs text-[var(--theme-muted)] animate-pulse">Loading log…</p>
  if (query.isError) return <p className="text-xs text-red-400">Worker log unavailable.</p>
  const log = (query.data as { log: unknown } | undefined)?.log
  if (!log) return <p className="text-xs text-[var(--theme-muted)]">No log data.</p>
  return (
    <pre className="text-[10px] font-mono text-[var(--theme-text)] whitespace-pre-wrap break-all leading-relaxed">
      {typeof log === 'string' ? log : JSON.stringify(log, null, 2)}
    </pre>
  )
}

