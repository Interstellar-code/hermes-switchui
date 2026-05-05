'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearch, useNavigate } from '@tanstack/react-router'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Alert02Icon,
  CheckListIcon,
  RefreshIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { TaskCard } from './task-card'
import { TaskDialog } from './task-dialog'
import type { TaskDialogSubmit } from './task-dialog'
import { TaskDetailDrawer } from './task-detail-drawer'
import type { ClaudeTask, TaskAssignee, TaskColumn } from '@/lib/tasks-api'
import type { HermesKanbanStatus } from '@/lib/hermes-kanban-types'
import { useKanbanEvents } from '@/hooks/use-kanban-events'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  COLUMN_COLORS,
  COLUMN_LABELS,
  COLUMN_ORDER,
  createTask,
  deleteTask,
  fetchAssignees,
  fetchKanbanConfig,
  fetchStats,
  fetchTasks,
  moveTask,
  updateTask,
} from '@/lib/tasks-api'
import { HERMES_KANBAN_VISIBLE_STATUS_ORDER } from '@/lib/hermes-kanban-types'
import { unionAssigneesWithProfiles } from '@/lib/assignee-profile-union'

const KANBAN_BASE = '/api/hermes-kanban'

const QUERY_KEY = ['claude', 'tasks'] as const
const ASSIGNEES_KEY = ['claude', 'tasks', 'assignees'] as const

export const TASKS_BOARD_HELP_TEXT =
  'Drag cards to change status. Open a card to set assignee and due date.'

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 animate-pulse">
      <div className="h-3.5 bg-[var(--theme-hover)] rounded w-3/4 mb-2" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-full mb-1" />
      <div className="h-2.5 bg-[var(--theme-hover)] rounded w-2/3 mb-3" />
      <div className="flex gap-1.5">
        <div className="h-4 w-12 bg-[var(--theme-hover)] rounded" />
        <div className="h-4 w-10 bg-[var(--theme-hover)] rounded" />
      </div>
    </div>
  )
}

// Blocked confirmation dialog state
type BlockedDropPending = {
  taskId: string
  targetStatus: HermesKanbanStatus
} | null

type RunningMovePending = {
  taskId: string
  targetStatus: HermesKanbanStatus
} | null

export function TasksScreen() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [createColumn, setCreateColumn] = useState<TaskColumn>('triage')
  const [editingTask, setEditingTask] = useState<ClaudeTask | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] =
    useState<HermesKanbanStatus | null>(null)
  // ── Column visibility — persisted to localStorage ──────────────────────
  const COLS_KEY = 'switchui-column-visibility'
  const [showDone, setShowDone] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}').done ?? false } catch { return false }
  })
  const [showArchived, setShowArchived] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}').archived ?? false } catch { return false }
  })
  const [showTriage, setShowTriage] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}').triage ?? true } catch { return true }
  })
  const [showBlocked, setShowBlocked] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}').blocked ?? true } catch { return true }
  })
  const [showViewDropdown, setShowViewDropdown] = useState(false)
  // Ref to the trigger button so we can measure its position for fixed-panel placement
  const colsButtonRef = useRef<HTMLButtonElement>(null)
  const [colsPanelPos, setColsPanelPos] = useState<{ top: number; right: number } | null>(null)

  function openColsDropdown() {
    if (colsButtonRef.current) {
      const r = colsButtonRef.current.getBoundingClientRect()
      setColsPanelPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setShowViewDropdown(v => !v)
  }
  const [blockedPending, setBlockedPending] = useState<BlockedDropPending>(null)
  const [blockedReason, setBlockedReason] = useState('')
  const [runningMovePending, setRunningMovePending] = useState<RunningMovePending>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Persist column visibility to localStorage whenever any toggle changes
  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify({
        done: showDone, archived: showArchived,
        triage: showTriage, blocked: showBlocked,
      }))
    } catch { /* storage quota / private-mode — silently ignore */ }
  }, [showDone, showArchived, showTriage, showBlocked])

  const search = useSearch({ from: '/tasks' })
  const initialAssignee =
    typeof search.assignee === 'string' ? search.assignee : null
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(
    initialAssignee,
  )
  const [tenantFilter, setTenantFilter] = useState<string | null>(null)
  const [dispatchResult, setDispatchResult] = useState<string | null>(null)

  const tasksQuery = useQuery({
    queryKey: [...QUERY_KEY, showDone, showArchived, tenantFilter],
    queryFn: () =>
      fetchTasks({
        include_done: showDone,
        include_archived: showArchived,
        ...(tenantFilter ? { tenant: tenantFilter } : {}),
      }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  })

  const assigneesQuery = useQuery({
    queryKey: ASSIGNEES_KEY,
    queryFn: fetchAssignees,
    staleTime: 5 * 60_000,
  })

  const statsQuery = useQuery({
    queryKey: ['claude', 'tasks', 'stats'],
    queryFn: fetchStats,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const assignees: Array<TaskAssignee> = assigneesQuery.data?.assignees ?? []
  const profilesQuery = useQuery({
    queryKey: ['profiles', 'list'],
    queryFn: () => fetch('/api/profiles/list').then(r => r.json()) as Promise<{ profiles: Array<{ name: string }>; activeProfile: string }>,
    staleTime: 60_000,
  })
  const assigneeOptions = unionAssigneesWithProfiles(
    assignees,
    profilesQuery.data?.profiles ?? [],
    profilesQuery.data?.activeProfile,
  )
  const profileNameSet = new Set((profilesQuery.data?.profiles ?? []).map((p) => p.name))
  const orphanAssignees = assignees.filter((a) => !profileNameSet.has(a.id))
  const [orphanBannerDismissed, setOrphanBannerDismissed] = useState(false)

  const assigneeLabels = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of assignees) map[a.id] = a.label
    return map
  }, [assignees])

  const tasks = tasksQuery.data ?? []

  // Group tasks by Agent status
  const tasksByStatus = useMemo(() => {
    const map: Record<HermesKanbanStatus, Array<ClaudeTask>> = {
      triage: [],
      todo: [],
      ready: [],
      running: [],
      blocked: [],
      done: [],
      archived: [],
    }
    for (const t of tasks) {
      const status = (t.status) ?? 'triage'
      if (assigneeFilter && t.assignee !== assigneeFilter) continue
      if (map[status]) map[status].push(t)
    }
    return map
  }, [tasks, assigneeFilter])

  const stats = useMemo(() => {
    const total = tasks.length
    const running = tasks.filter((t) => t.status === 'running').length
    const blocked = tasks.filter((t) => t.status === 'blocked').length
    const done = tasks.filter((t) => t.status === 'done').length
    const completion = total > 0 ? Math.round((done / total) * 100) : 0
    return { total, running, blocked, done, completion }
  }, [tasks])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  // Live event stream — invalidate board and open detail drawer on task events
  useKanbanEvents({
    enabled: true,
    onEvent: (event) => {
      // Invalidate the board on any task event
      invalidate()
      // If a detail drawer is open for this task, also invalidate its query
      if (editingTask && event.task_id === editingTask.id) {
        void queryClient.invalidateQueries({
          queryKey: ['hermes-kanban', 'task', editingTask.id],
        })
      }
    },
  })

  const createMutation = useMutation({
    mutationFn: async ({ createInput, desiredStatus, blockReason }: TaskDialogSubmit) => {
      const task = await createTask(createInput)
      // Two-step: patch status for statuses Agent cannot set at create time
      if (desiredStatus && desiredStatus !== 'triage' && desiredStatus !== 'ready') {
        await updateTask(task.id, {
          status: desiredStatus,
          ...(blockReason ? { block_reason: blockReason } : {}),
        })
      }
      return task
    },
    onSuccess: () => {
      invalidate()
      toast('Task created')
      setShowCreate(false)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Failed to create task', {
        type: 'error',
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      invalidate()
      toast('Task archived')
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Failed to archive task', {
        type: 'error',
      }),
  })

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: HermesKanbanStatus }) =>
      moveTask(id, status),
    onSuccess: () => invalidate(),
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Failed to move task', {
        type: 'error',
      }),
  })

  const bulkMutation = useMutation({
    mutationFn: async ({
      status,
      archive,
    }: {
      status?: HermesKanbanStatus
      archive?: boolean
    }) => {
      const ids = Array.from(selectedIds)
      const res = await fetch(`${KANBAN_BASE}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          ...(status ? { status } : {}),
          ...(archive ? { archive: true } : {}),
        }),
      })
      if (!res.ok) throw new Error(`Bulk update failed: ${res.status}`)
      return res.json() as Promise<{
        results: Array<{ id: string; ok: boolean; error?: string }>
      }>
    },
    onSuccess: (data) => {
      const failed = data.results.filter((r) => !r.ok)
      if (failed.length > 0)
        toast(`${failed.length} tasks failed to update`, { type: 'error' })
      else toast(`${data.results.length} tasks updated`)
      setSelectedIds(new Set())
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['claude', 'tasks', 'stats'] })
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Bulk update failed', {
        type: 'error',
      }),
  })

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData('text/plain', taskId)
    setDraggingId(taskId)
  }

  function handleDragOver(e: React.DragEvent, col: HermesKanbanStatus) {
    e.preventDefault()
    setDragOverColumn(col)
  }

  function handleDrop(e: React.DragEvent, targetStatus: HermesKanbanStatus) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === targetStatus) {
      setDraggingId(null)
      setDragOverColumn(null)
      return
    }
    // Confirm before blocking a task — v1 requirement (plan Task 6)
    if (targetStatus === 'blocked') {
      setBlockedPending({ taskId, targetStatus })
      setBlockedReason('')
      setDraggingId(null)
      setDragOverColumn(null)
      return
    }
    // Warn when manually pulling a running task off-execution
    if (task.status === 'running' && targetStatus !== 'running') {
      setRunningMovePending({ taskId, targetStatus })
      setDraggingId(null)
      setDragOverColumn(null)
      return
    }
    moveMutation.mutate({ id: taskId, status: targetStatus })
    setDraggingId(null)
    setDragOverColumn(null)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverColumn(null)
  }

  function confirmRunningMove() {
    if (!runningMovePending) return
    moveMutation.mutate({ id: runningMovePending.taskId, status: runningMovePending.targetStatus })
    setRunningMovePending(null)
  }

  function confirmBlocked() {
    if (!blockedPending) return
    moveMutation.mutate({
      id: blockedPending.taskId,
      status: 'blocked',
      ...(blockedReason.trim() ? { blockReason: blockedReason.trim() } : {}),
    } as Parameters<typeof moveMutation.mutate>[0])
    setBlockedPending(null)
    setBlockedReason('')
  }

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${KANBAN_BASE}/dispatch?max=8`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`Dispatch failed: ${res.status}`)
      return res.json() as Promise<unknown>
    },
    onSuccess: (data) => {
      const msg =
        typeof data === 'object' && data !== null && 'dispatched' in data
          ? `Dispatched ${(data as { dispatched: number }).dispatched} task(s)`
          : 'Dispatch complete'
      setDispatchResult(msg)
      invalidate()
      setTimeout(() => setDispatchResult(null), 4000)
    },
    onError: (e) =>
      toast(e instanceof Error ? e.message : 'Dispatch failed', {
        type: 'error',
      }),
  })

  // Derive unique tenants from current tasks for filter dropdown
  const uniqueTenants = useMemo(() => {
    const set = new Set<string>()
    for (const t of tasks) if (t.tenant) set.add(t.tenant)
    return Array.from(set).sort()
  }, [tasks])

  function toggleSelect(taskId: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  // Agent lifecycle columns — filtered by the four view toggles
  const visibleStatuses: Array<HermesKanbanStatus> = [
    ...HERMES_KANBAN_VISIBLE_STATUS_ORDER,
    'archived' as HermesKanbanStatus,
  ].filter((s) => {
    if (s === 'triage' && !showTriage) return false
    if (s === 'blocked' && !showBlocked) return false
    if (s === 'done' && !showDone) return false
    if (s === 'archived' && !showArchived) return false
    return true
  })
  const colMaxWidth = Math.floor(1200 / visibleStatuses.length)

  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 pb-[calc(var(--tabbar-h,80px)+1.5rem)] sm:px-6 lg:px-8">
        {/* Header */}
        <header className="rounded-2xl border border-primary-200 bg-primary-50/85 p-4 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-2xl font-medium text-ink">Tasks</h1>
              {(assigneeFilter || tenantFilter) && (
                <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
                  {assigneeFilter && (() => {
                    const a = assigneeOptions.find(x => x.id === assigneeFilter)
                    return (
                      <span className={a && !a.onDisk ? 'text-amber-400' : ''}>
                        profile:{assigneeFilter}{a && !a.onDisk ? ' ⚠' : ''}
                      </span>
                    )
                  })()}
                  {tenantFilter && <span>tenant:{tenantFilter}</span>}
                  <button
                    type="button"
                    onClick={() => {
                      setAssigneeFilter(null)
                      setTenantFilter(null)
                    }}
                    className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] transition-colors"
                  >
                    ✕ Clear
                  </button>
                </div>
              )}
              {/* Stats — filtered view tally */}
              <div
                className="flex items-center gap-2 text-xs text-[var(--theme-muted)] flex-wrap opacity-60"
                title="filtered view"
              >
                <span>{stats.total} total</span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">
                  {stats.running} running
                </span>
                {stats.blocked > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-red-400/60">
                      {stats.blocked} blocked
                    </span>
                  </>
                )}
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">
                  {stats.completion}% done
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {/* Bulk-action toolbar moved to floating footer (rendered via portal further below). */}
              {/* Consolidated columns visibility dropdown */}
              {(() => {
                const anyHidden = !showTriage || !showBlocked || !showDone || !showArchived
                const cols = [
                  { key: 'triage', label: 'Triage / Backlog', checked: showTriage, toggle: () => setShowTriage(v => !v) },
                  { key: 'blocked', label: 'Blocked', checked: showBlocked, toggle: () => setShowBlocked(v => !v) },
                  { key: 'done', label: 'Done', checked: showDone, toggle: () => setShowDone(v => !v) },
                  { key: 'archived', label: 'Archived', checked: showArchived, toggle: () => setShowArchived(v => !v) },
                ]
                return (
                  <>
                    <button
                      ref={colsButtonRef}
                      onClick={openColsDropdown}
                      className={cn(
                        'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors',
                        showViewDropdown || anyHidden
                          ? 'border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-hover)]'
                          : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)]',
                      )}
                    >
                      <HugeiconsIcon icon={CheckListIcon} size={12} />
                      Columns
                      {anyHidden && (
                        <span className="ml-0.5 text-[9px] font-bold opacity-70">
                          {cols.filter(c => !c.checked).length}
                        </span>
                      )}
                      <span className="opacity-50 text-[10px]">▾</span>
                    </button>
                    {showViewDropdown && colsPanelPos && createPortal(
                      <>
                        <div className="fixed inset-0 z-[9998]" onClick={() => setShowViewDropdown(false)} />
                        <div
                          className="fixed z-[9999] w-52 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-2xl p-1.5"
                          style={{ top: colsPanelPos.top, right: colsPanelPos.right, backgroundColor: 'var(--theme-card)' }}
                        >
                          <p className="px-3 pt-1.5 pb-1 text-[9px] uppercase tracking-widest text-[var(--theme-muted)] font-medium">
                            Visible columns
                          </p>
                          {cols.map(({ key, label, checked, toggle }) => (
                            <button
                              key={key}
                              onClick={toggle}
                              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs hover:bg-[var(--theme-hover)] transition-colors"
                            >
                              <span className={cn(
                                'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                checked
                                  ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]'
                                  : 'border-[var(--theme-border)] bg-transparent',
                              )}>
                                {checked && <span className="text-white text-[9px] leading-none">✓</span>}
                              </span>
                              <span className={checked ? 'text-[var(--theme-text)]' : 'text-[var(--theme-muted)]'}>
                                {label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </>,
                      document.body,
                    )}
                  </>
                )
              })()}
              <KanbanSettingsButton />
              {/* Tenant filter */}
              {uniqueTenants.length > 0 && (
                <select
                  className="text-xs px-2 py-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  style={{ colorScheme: 'dark' }}
                  value={tenantFilter ?? ''}
                  onChange={(e) => setTenantFilter(e.target.value || null)}
                >
                  <option value="">All tenants</option>
                  {uniqueTenants.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
              {/* Agent profile filter */}
              {assigneeOptions.length > 0 && (
                <select
                  className="text-xs px-2 py-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-accent)]"
                  style={{ colorScheme: 'dark' }}
                  value={assigneeFilter ?? ''}
                  onChange={(e) => setAssigneeFilter(e.target.value || null)}
                  title="Filter by agent profile"
                >
                  <option value="">All profiles</option>
                  {assigneeOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.onDisk ? a.label : `${a.label} ⚠`}
                    </option>
                  ))}
                </select>
              )}
              {/* Dispatch */}
              <button
                onClick={() => void dispatchMutation.mutate()}
                disabled={dispatchMutation.isPending}
                className="text-xs px-2.5 py-1 rounded-lg border border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)] transition-colors disabled:opacity-40"
                title="Dispatch ready tasks to workers (max 8)"
              >
                {dispatchMutation.isPending
                  ? 'Dispatching…'
                  : (dispatchResult ?? '⚡ Dispatch')}
              </button>
              <button
                onClick={invalidate}
                className="rounded-lg p-1.5 transition-colors hover:bg-[var(--theme-hover)]"
                title="Refresh"
              >
                <HugeiconsIcon
                  icon={RefreshIcon}
                  size={16}
                  className="text-[var(--theme-muted)]"
                />
              </button>
              <button
                onClick={() => {
                  setCreateColumn('triage')
                  setShowCreate(true)
                }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--theme-accent)' }}
              >
                <HugeiconsIcon icon={Add01Icon} size={14} />
                New Task
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--theme-muted)]">
            {TASKS_BOARD_HELP_TEXT}
          </p>
        </header>

        {/* Orphan-assignee resilience banner */}
        {orphanAssignees.length > 0 && !orphanBannerDismissed && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <HugeiconsIcon icon={Alert02Icon} size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-300">
                  {orphanAssignees.length} orphan assignee{orphanAssignees.length !== 1 ? 's' : ''} with no profile on disk
                </p>
                <p className="text-xs text-amber-400/80 mt-0.5">
                  {orphanAssignees.slice(0, 5).map((a) => a.label).join(', ')}
                  {orphanAssignees.length > 5 ? ` +${orphanAssignees.length - 5} more` : ''}
                </p>
                <p className="text-xs text-amber-400/70 mt-1">
                  Tasks assigned to these fall back to the default profile when dispatched. Reassign tasks or add a profile yaml under{' '}
                  <code className="font-mono text-amber-300/90">~/.hermes/profiles/</code>.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void navigate({ to: '/profiles' })}
                  className="text-xs px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  Open Profiles
                </button>
                <button
                  type="button"
                  onClick={() => setOrphanBannerDismissed(true)}
                  className="text-amber-400/60 hover:text-amber-300 transition-colors text-xs leading-none"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Gateway stats bar */}
        {!statsQuery.isLoading || statsQuery.data ? (
          statsQuery.data ? (() => {
            const counts = statsQuery.data.by_status ?? {}
            const total = Object.values(counts).reduce<number>((acc, n) => acc + (typeof n === 'number' ? n : 0), 0)
            const oldestSecs = statsQuery.data.oldest_ready_age_seconds
            const oldestRunningSecs = statsQuery.data.oldest_running_age_seconds

            const statusEntries = (Object.entries(counts) as Array<[string, number]>)
              .filter(([, n]) => n > 0)

            function fmtAge(secs: number): string {
              const d = Math.floor(secs / 86400)
              if (d > 0) return `${d}d`
              const h = Math.floor(secs / 3600)
              if (h > 0) return `${h}h`
              return `${Math.floor(secs / 60)}m`
            }

            return (
              <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-widest text-[var(--theme-muted)] font-medium mr-1">
                    Global
                  </span>
                  <span className="text-xs text-[var(--theme-muted)]">{total} total</span>
                  {statusEntries.map(([status, count]) => {
                    const color = COLUMN_COLORS[status as keyof typeof COLUMN_COLORS] ?? '#6b7280'
                    const label = COLUMN_LABELS[status as keyof typeof COLUMN_LABELS] ?? status
                    return (
                      <span key={status} className="flex items-center gap-1 text-xs">
                        <span className="text-[var(--theme-border)]">·</span>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                        <span style={{ color }}>{count}</span>
                        <span className="text-[var(--theme-muted)]">{label}</span>
                      </span>
                    )
                  })}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--theme-muted)]">
                  {oldestSecs != null && oldestSecs > 0 && (
                    <span>oldest ready: {fmtAge(oldestSecs)} ago</span>
                  )}
                  {oldestRunningSecs != null && oldestRunningSecs > 0 && (
                    <span>oldest running: {fmtAge(oldestRunningSecs)} ago</span>
                  )}
                </div>
              </div>
            )
          })() : null
        ) : (
          <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-2.5 h-9 animate-pulse" />
        )}

        {/* Board */}
        <div
          className="mx-auto flex w-full max-w-[1200px] flex-1 gap-3 overflow-x-auto overflow-y-hidden min-h-0"
          style={{ boxShadow: 'inset 0 8px 24px rgba(0,0,0,0.2)' }}
        >
          {visibleStatuses.map((status) => {
            const colTasks = tasksByStatus[status] ?? []
            const colColor = COLUMN_COLORS[status]
            const isDragOver = dragOverColumn === status
            const colLabel = COLUMN_LABELS[status]

            return (
              <div
                key={status}
                className={cn(
                  'flex flex-col rounded-xl border min-w-[180px] w-full shrink-0 flex-1',
                  'bg-[var(--theme-card)] border-[var(--theme-border)]',
                  'transition-colors shadow-[0_2px_12px_rgba(0,0,0,0.25)]',
                  isDragOver &&
                  'border-[var(--theme-accent)] bg-[var(--theme-hover)]',
                )}
                style={{ maxWidth: colMaxWidth }}
                onDragOver={(e) => handleDragOver(e, status)}
                onDrop={(e) => handleDrop(e, status)}
                onDragLeave={() => setDragOverColumn(null)}
              >
                {/* Column header */}
                <div
                  className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--theme-border)] rounded-t-xl"
                  style={{
                    borderTopWidth: 2,
                    borderTopColor: colColor,
                    borderTopStyle: 'solid',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: colColor }}
                    />
                    <span className="text-xs font-semibold text-[var(--theme-text)]">
                      {colLabel}
                    </span>
                    <span className="text-xs text-[var(--theme-muted)]">
                      (
                      {tasksQuery.isFetching && tasksQuery.data === undefined
                        ? '…'
                        : colTasks.length}
                      )
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setCreateColumn(status)
                      setShowCreate(true)
                    }}
                    className="rounded p-0.5 hover:bg-[var(--theme-hover)] transition-colors"
                    title={`Add to ${colLabel}`}
                  >
                    <HugeiconsIcon
                      icon={Add01Icon}
                      size={14}
                      className="text-[var(--theme-muted)]"
                    />
                  </button>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto">
                  {tasksQuery.isError ? (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center py-8 gap-2 text-red-400"
                    >
                      <p className="text-xs font-medium">
                        Failed to load tasks
                      </p>
                      <button
                        onClick={() => tasksQuery.refetch()}
                        className="text-xs text-[var(--theme-accent)] hover:underline"
                      >
                        Retry
                      </button>
                    </motion.div>
                  ) : tasksQuery.isLoading ? (
                    <>
                      <SkeletonCard />
                      <SkeletonCard />
                      <SkeletonCard />
                    </>
                  ) : (
                    <AnimatePresence initial={false}>
                      {colTasks.length === 0 ? (
                        <motion.div
                          key="empty"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex flex-col items-center justify-center py-8 gap-2 text-[var(--theme-muted)] opacity-60"
                        >
                          <HugeiconsIcon icon={CheckListIcon} size={22} />
                          <p className="text-xs font-medium">No tasks</p>
                          <p className="text-[10px]">
                            Drop here or click + to add
                          </p>
                        </motion.div>
                      ) : (
                        colTasks.map((task) => (
                          <motion.div
                            key={task.id}
                            layout
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            onDragEnd={handleDragEnd}
                            className="relative group"
                          >
                            {/* Multi-select checkbox — visible on hover, always visible when selected or any selected */}
                            <button
                              type="button"
                              onClick={(e) => toggleSelect(task.id, e)}
                              className={cn(
                                'absolute top-2 left-2 z-10 w-4 h-4 rounded border transition-all',
                                selectedIds.has(task.id)
                                  ? 'bg-[var(--theme-accent)] border-[var(--theme-accent)] opacity-100'
                                  : selectedIds.size > 0
                                    ? 'bg-transparent border-[var(--theme-border)] opacity-60 hover:opacity-100'
                                    : 'bg-transparent border-[var(--theme-border)] opacity-0 group-hover:opacity-60 hover:opacity-100',
                              )}
                              title="Select task"
                            >
                              {selectedIds.has(task.id) && (
                                <span className="text-white text-[9px] leading-none flex items-center justify-center w-full h-full">
                                  ✓
                                </span>
                              )}
                            </button>
                            <TaskCard
                              task={task}
                              assigneeLabels={assigneeLabels}
                              isDragging={draggingId === task.id}
                              onDragStart={(e) => handleDragStart(e, task.id)}
                              onClick={() => setEditingTask(task)}
                            />
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Create dialog */}
        <TaskDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          defaultColumn={createColumn}
          assignees={assigneeOptions as TaskAssignee[]}
          isSubmitting={createMutation.isPending}
          onSubmit={async (payload) => {
            await createMutation.mutateAsync(payload)
          }}
        />

        {/* Task detail drawer — replaces the old edit dialog for viewing */}
        {editingTask && (
          <TaskDetailDrawer
            task={editingTask}
            onClose={() => setEditingTask(null)}
          />
        )}

        {/* Running-task move confirmation */}
        {runningMovePending && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-6 shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0 animate-pulse" />
                <h3 className="text-sm font-semibold text-[var(--theme-text)]">
                  Move active task?
                </h3>
              </div>
              <p className="text-xs text-[var(--theme-muted)] mb-5 leading-relaxed">
                This task has an active worker run. Moving it away from{' '}
                <span className="font-medium text-orange-400">Running</span> may
                interrupt the worker mid-execution. Continue anyway?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRunningMovePending(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRunningMove}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  style={{ background: '#f97316' }}
                >
                  Move anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Blocked confirmation dialog (v1 requirement) */}
        {blockedPending && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-6 shadow-xl">
              <h3 className="text-sm font-semibold text-[var(--theme-text)] mb-1">
                Block task?
              </h3>
              <p className="text-xs text-[var(--theme-muted)] mb-4">
                Optionally describe why this task is blocked. Workers and
                reviewers will see this reason.
              </p>
              <textarea
                className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-muted)] resize-none focus:outline-none focus:border-[var(--theme-accent)] mb-4"
                rows={3}
                placeholder="Block reason (optional)"
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBlockedPending(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmBlocked}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  style={{ background: '#ef4444' }}
                >
                  Block task
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating bulk-action footer — portal'd to body, escapes layout.
          Wrapper spans content area only (sidebar 300px → right edge) so the
          pill centers within the page content, not the full viewport.
          bottom-20 keeps it clear of the system-metrics footer. */}
      {selectedIds.size > 0 && createPortal(
        <div className="fixed bottom-20 left-[300px] right-0 z-[9999] flex justify-center pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-[var(--theme-accent)] bg-[var(--theme-card)] shadow-2xl px-3 py-2">
          <span className="text-xs text-[var(--theme-accent)] font-semibold mr-2">
            {selectedIds.size}× selected
          </span>
          <button
            onClick={() => void bulkMutation.mutate({ status: 'triage' })}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--theme-hover)] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            disabled={bulkMutation.isPending}
          >
            Triage
          </button>
          <button
            onClick={() => void bulkMutation.mutate({ status: 'ready' })}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--theme-hover)] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            disabled={bulkMutation.isPending}
          >
            Ready
          </button>
          <button
            onClick={() => void bulkMutation.mutate({ status: 'blocked' })}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--theme-hover)] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            disabled={bulkMutation.isPending}
          >
            Blocked
          </button>
          <button
            onClick={() => void bulkMutation.mutate({ status: 'done' })}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--theme-hover)] text-[var(--theme-muted)] hover:text-[var(--theme-text)]"
            disabled={bulkMutation.isPending}
          >
            Done
          </button>
          <button
            onClick={() => void bulkMutation.mutate({ archive: true })}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--theme-hover)] text-red-400"
            disabled={bulkMutation.isPending}
          >
            Archive
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--theme-hover)] text-[var(--theme-muted)] ml-1 border-l border-[var(--theme-border)] pl-3"
            disabled={bulkMutation.isPending}
          >
            Clear
          </button>
        </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function KanbanSettingsButton() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const cfgQuery = useQuery({
    queryKey: ['hermes-kanban', 'config'],
    queryFn: fetchKanbanConfig,
    staleTime: 5 * 60_000,
    enabled: open,
  })

  function toggle() {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setOpen((v) => !v)
  }

  const cfg = cfgQuery.data ?? {}
  const rows: Array<[string, string]> = [
    ['Default tenant', String((cfg as Record<string, unknown>).default_tenant ?? '—') || '—'],
    ['Lane by profile', (cfg as Record<string, unknown>).lane_by_profile ? 'Yes' : 'No'],
    ['Include archived by default', (cfg as Record<string, unknown>).include_archived_by_default ? 'Yes' : 'No'],
    ['Render markdown', (cfg as Record<string, unknown>).render_markdown ? 'Yes' : 'No'],
  ]

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        title="Kanban settings"
        className={cn(
          'flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors',
          open
            ? 'border-[var(--theme-accent)] text-[var(--theme-accent)] bg-[var(--theme-hover)]'
            : 'border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)]',
        )}
      >
        <HugeiconsIcon icon={Settings01Icon} size={12} />
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[9999] w-72 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-2xl p-3"
            style={{ top: pos.top, right: pos.right, backgroundColor: 'var(--theme-card)' }}
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--theme-muted)] font-medium mb-2">
              Kanban settings
            </p>
            {cfgQuery.isLoading && (
              <p className="text-xs text-[var(--theme-muted)]">Loading…</p>
            )}
            {cfgQuery.isError && (
              <p className="text-xs text-red-400">Failed to load config.</p>
            )}
            {!cfgQuery.isLoading && !cfgQuery.isError && (
              <div className="space-y-1.5">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-[var(--theme-muted)]">{k}</span>
                    <span className="text-[var(--theme-text)] font-medium">{v}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 pt-2 border-t border-[var(--theme-border)] text-[10px] text-[var(--theme-muted)]">
              Read-only. Edit <span className="font-mono">~/.hermes/config.yaml</span> and restart the dashboard to change.
            </p>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
