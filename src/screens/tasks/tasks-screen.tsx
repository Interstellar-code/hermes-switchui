'use client'

import '@/styles/matrix-tasks.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearch } from '@tanstack/react-router'
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
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { TaskCard } from './task-card'
import { TaskDialog } from './task-dialog'
import { TaskDetailDrawer } from './task-detail-drawer'
import { SwimView } from './swim-view'
import { TimelineView } from './timeline-view'
import type { TaskDialogSubmit } from './task-dialog'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { HermesKanbanStatus } from '@/lib/hermes-kanban-types'
import type { ClaudeTask, TaskAssignee, TaskColumn } from '@/lib/tasks-api'
import { HERMES_KANBAN_VISIBLE_STATUS_ORDER } from '@/lib/hermes-kanban-types'
import {
  COLUMN_COLORS,
  COLUMN_LABELS,
  createTask,
  fetchAssignees,
  fetchKanbanConfig,
  fetchStats,
  fetchTasks,
  moveTask,
  updateTask,
} from '@/lib/tasks-api'
import { unionAssigneesWithProfiles } from '@/lib/assignee-profile-union'
import { useKanbanEvents } from '@/hooks/use-kanban-events'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

const KANBAN_BASE = '/api/hermes-kanban'

const QUERY_KEY = ['claude', 'tasks'] as const
const ASSIGNEES_KEY = ['claude', 'tasks', 'assignees'] as const

export const TASKS_BOARD_HELP_TEXT =
  'Drag cards to change status. Open a card to set assignee and due date.'

// ── @dnd-kit droppable column ──────────────────────────────────────────────
function DroppableColumn({
  status,
  colColor,
  taskCount,
  children,
}: {
  status: string
  colColor: string
  taskCount: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const label = COLUMN_LABELS[status as keyof typeof COLUMN_LABELS]
  return (
    <div
      ref={setNodeRef}
      className={cn('col', isOver && 'drag-over')}
      style={{ '--col-color': colColor } as React.CSSProperties}
      aria-label={`${label} column, ${taskCount} task${taskCount !== 1 ? 's' : ''}`}
    >
      {children}
    </div>
  )
}

// ── @dnd-kit draggable card wrapper ───────────────────────────────────────
function DraggableCard({
  taskId,
  isDragging,
  children,
}: {
  taskId: string
  isDragging: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: taskId })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={isDragging ? { opacity: 0.4 } : undefined}
    >
      {children}
    </div>
  )
}

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
  const [, setDragOverColumn] = useState<HermesKanbanStatus | null>(null)
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
  // View toggle: board is the only implemented view for P1; swim/time are placeholders
  const [activeView, setActiveView] = useState<'board' | 'swim' | 'time'>('board')
  // Done-stat click: open drawer in list mode
  const [showDoneList, setShowDoneList] = useState(false)
  // Footer relative-time tick — re-renders every 10s (SSR-safe)
  const [footerTick, setFooterTick] = useState(0)

  // Persist column visibility to localStorage whenever any toggle changes
  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify({
        done: showDone, archived: showArchived,
        triage: showTriage, blocked: showBlocked,
      }))
    } catch { /* storage quota / private-mode — silently ignore */ }
  }, [showDone, showArchived, showTriage, showBlocked])

  // Footer relative-time: tick every 10s so "Updated N ago" stays fresh
  useEffect(() => {
    const id = setInterval(() => setFooterTick(t => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])

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

  const doneTasksQuery = useQuery({
    queryKey: [...QUERY_KEY, 'done-only', tenantFilter],
    queryFn: () =>
      fetchTasks({
        include_done: true,
        ...(tenantFilter ? { tenant: tenantFilter } : {}),
      }),
    enabled: showDoneList,
    staleTime: 30_000,
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
      const status = t.status
      if (assigneeFilter && t.assignee !== assigneeFilter) continue
      map[status].push(t)
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

  const moveMutation = useMutation({
    mutationFn: ({ id, status, blockReason }: { id: string; status: HermesKanbanStatus; blockReason?: string }) =>
      moveTask(id, status, blockReason),
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

  // ── @dnd-kit sensors ──────────────────────────────────────────────────────
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDndDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id))
  }

  function handleDndDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id)
    const targetStatus = event.over?.id as HermesKanbanStatus | undefined
    setDraggingId(null)
    setDragOverColumn(null)

    if (!targetStatus) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === targetStatus) return

    if (targetStatus === 'blocked') {
      setBlockedPending({ taskId, targetStatus })
      setBlockedReason('')
      return
    }
    if (task.status === 'running' && targetStatus !== 'running') {
      setRunningMovePending({ taskId, targetStatus })
      return
    }
    moveMutation.mutate({ id: taskId, status: targetStatus })
  }

  // Legacy HTML5 drag kept as no-op stub (TaskCard still passes onDragStart)
  function handleDragStart(_e: React.DragEvent, _taskId: string) {}

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
    })
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

  // SPEC-05: fixed 5-col board — triage, todo, ready, running, blocked.
  // `done` is intentionally excluded from board columns regardless of showDone.
  // showDone only controls the `include_done` query param for stats math and
  // the Done stat cell click-to-list drawer; it must NOT add a board column.
  const visibleStatuses: Array<HermesKanbanStatus> = (
    [...HERMES_KANBAN_VISIBLE_STATUS_ORDER, 'archived' as HermesKanbanStatus] as Array<HermesKanbanStatus>
  ).filter((s) => {
    if (s === 'done' && !showDone) return false
    if (s === 'triage' && !showTriage) return false
    if (s === 'blocked' && !showBlocked) return false
    if (s === 'archived' && !showArchived) return false
    return true
  })

  return (
    <div className="min-h-full bg-surface text-ink tk-shell" data-screen="tasks">

      {/* ── Breadcrumb strip (TS-01 / TS-02 / TS-03) ── */}
      <header className="tk-top">
        <div className="crumbs" aria-label="Breadcrumb">
          <span>Workspace</span><span className="sep" aria-hidden="true">/</span>
          <span className="cur">Tasks</span><span className="sep" aria-hidden="true">/</span>
          <span>Kanban</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {/* TS-02: stat cells */}
          <div className="meta">
            <button
              type="button"
              className="stat clickable"
              aria-label={`Show ${stats.done} done tasks`}
              title="Click to view done tasks"
              onClick={() => setShowDoneList(true)}
            >
              <span className="v ok">{stats.done}</span>
              <span className="l">Done</span>
            </button>
            <div className="stat">
              <span className="v warn">{stats.running}</span>
              <span className="l">Running</span>
            </div>
            <div className="stat">
              <span className="v">{tasksByStatus.todo.length}</span>
              <span className="l">Todo</span>
            </div>
            <div className="stat">
              <span className="v">{tasksByStatus.triage.length}</span>
              <span className="l">Backlog</span>
            </div>
            <div className="stat">
              <span className="v">{stats.total}</span>
              <span className="l">Total</span>
            </div>
          </div>
          {/* TS-03: refresh + filter icobtns */}
          <div className="right-actions">
            <button
              type="button"
              className="icobtn"
              aria-label="Refresh board"
              title="Refresh"
              onClick={invalidate}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5"/></svg>
            </button>
            <button
              type="button"
              className="icobtn"
              aria-label="Filters"
              title="Filters"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 5h18M6 12h12M10 19h4"/></svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Action bar (TS-04 / AB-01..04) ── */}
      <div className="actbar">
        {/* AB-02: left — title + sub line */}
        <div>
          <h1>Tasks</h1>
          <div className="sub">
            <span><span className="v">{stats.total}</span> total</span>
            <span className="dot" aria-hidden="true" />
            <span><span className="v run">{stats.running}</span> running</span>
            <span className="dot" aria-hidden="true" />
            <span><span className="v ok">{stats.completion}%</span> done</span>
            {(assigneeFilter || tenantFilter) && (
              <>
                <span className="dot" aria-hidden="true" />
                {assigneeFilter && (() => {
                  const a = assigneeOptions.find(x => x.id === assigneeFilter)
                  return <span style={{ color: a && !a.onDisk ? 'var(--m-amber,#ffb454)' : undefined }}>profile:{assigneeFilter}{a && !a.onDisk ? ' ⚠' : ''}</span>
                })()}
                {tenantFilter && <span>tenant:{tenantFilter}</span>}
                <button
                  type="button"
                  onClick={() => { setAssigneeFilter(null); setTenantFilter(null) }}
                  style={{ color: 'var(--m-text-faint)', cursor: 'pointer', background: 'none', border: 'none', font: 'inherit', letterSpacing: 'inherit' }}
                >
                  ✕ Clear
                </button>
              </>
            )}
            <span className="dot" aria-hidden="true" />
            <span>Drag cards to change status — open a card to set assignee &amp; due date</span>
          </div>
        </div>

        {/* AB-03: right — tools row */}
        <div className="tools">
          {/* Segmented view toggle */}
          <div className="seg" role="tablist" aria-label="Task view">
            {(['board', 'swim', 'time'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={activeView === v}
                className={activeView === v ? 'on' : ''}
                onClick={() => setActiveView(v)}
                title={v === 'board' ? 'Kanban view' : v === 'swim' ? 'Swimlanes by assignee' : 'Timeline'}
              >
                {v === 'board' ? (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="11"/><rect x="17" y="4" width="4" height="7"/></svg>Board</>
                ) : v === 'swim' ? (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M3 12h18M3 18h18"/></svg>Swim</>
                ) : (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 5h18M3 12h12M3 19h7"/></svg>Time</>
                )}
              </button>
            ))}
          </div>

          {/* Columns pill */}
          {(() => {
            const anyHidden = !showTriage || !showBlocked || !showDone || !showArchived
            const cols = [
              { key: 'triage', label: 'Triage / Backlog', checked: showTriage, toggle: () => setShowTriage(v => !v) },
              { key: 'blocked', label: 'Blocked', checked: showBlocked, toggle: () => setShowBlocked(v => !v) },
              { key: 'done', label: 'Done', checked: showDone, toggle: () => setShowDone(v => !v) },
              { key: 'archived', label: 'Archived', checked: showArchived, toggle: () => setShowArchived(v => !v) },
            ]
            const hiddenCount = cols.filter(c => !c.checked).length
            return (
              <>
                <button
                  ref={colsButtonRef}
                  onClick={openColsDropdown}
                  className={cn('pill', (showViewDropdown || anyHidden) ? 'pill-active' : '')}
                  title="Configure columns"
                  aria-label="Configure visible columns"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="16"/><rect x="17" y="4" width="4" height="16"/></svg>
                  Columns
                  <span className="ct">{anyHidden ? `${5 - hiddenCount}/5` : '5'}</span>
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

          {/* Settings */}
          <KanbanSettingsButton />

          {/* Agent profile select (AB-03 selbox) */}
          {assigneeOptions.length > 0 && (
            <select
              className="selbox"
              style={{ colorScheme: 'dark' }}
              value={assigneeFilter ?? ''}
              onChange={(e) => setAssigneeFilter(e.target.value || null)}
              aria-label="Filter by agent profile"
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

          {/* Tenant filter (kept when tenants present) */}
          {uniqueTenants.length > 0 && (
            <select
              className="selbox"
              style={{ colorScheme: 'dark' }}
              value={tenantFilter ?? ''}
              onChange={(e) => setTenantFilter(e.target.value || null)}
              aria-label="Filter by tenant"
            >
              <option value="">All tenants</option>
              {uniqueTenants.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}

          {/* Dispatch (AB-03 btn-sec) */}
          <button
            type="button"
            className="btn-sec"
            onClick={() => void dispatchMutation.mutate()}
            disabled={dispatchMutation.isPending}
            title="Dispatch ready tasks to workers (max 8)"
            aria-label="Dispatch ready tasks"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m13 2-9 12h7l-1 8 9-12h-7z"/></svg>
            {dispatchMutation.isPending ? 'Dispatching…' : (dispatchResult ?? 'Dispatch')}
          </button>

          {/* Refresh icobtn (AB-03) */}
          <button
            type="button"
            className="icobtn"
            aria-label="Refresh board"
            title="Refresh"
            onClick={invalidate}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5"/></svg>
          </button>

          {/* New Task (AB-04 btn-prim) */}
          <button
            type="button"
            className="btn-prim"
            onClick={() => { setCreateColumn('triage'); setShowCreate(true) }}
            aria-label="Create new task"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
            New Task
          </button>
        </div>
      </div>

      {/* ── Page content ── */}
      <div className="tk-content pb-[calc(var(--tabbar-h,80px)+30px+1.5rem)]">

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

        {/* Global stripe — 5-pip legend + progress bar */}
        {statsQuery.isLoading ? (
          <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-2.5 h-9 animate-pulse" />
        ) : statsQuery.data ? (() => {
          const counts = statsQuery.data.by_status ?? {}
          const globalTotal = Object.values(counts).reduce<number>((acc, n) => acc + (typeof n === 'number' ? n : 0), 0)
          const globalDone = typeof counts.done === 'number' ? counts.done : 0
          const globalRun = typeof counts.running === 'number' ? counts.running : 0
          const globalTodo = typeof counts.todo === 'number' ? counts.todo : 0
          const globalBacklog = (typeof counts.triage === 'number' ? counts.triage : 0) + (typeof counts.ready === 'number' ? counts.ready : 0)
          const globalBlocked = typeof counts.blocked === 'number' ? counts.blocked : 0
          const globalPct = globalTotal > 0 ? Math.round((globalDone / globalTotal) * 1000) / 10 : 0
          return (
            <div className="tk-global-stripe">
              <span className="gs-lbl">Global · {globalTotal} Total</span>
              <div className="gs-pips">
                <span className="pip-item"><span className="pip done" /><span className="pip-ct">{globalDone}</span>&nbsp;Done</span>
                <span className="pip-item"><span className="pip run" /><span className="pip-ct">{globalRun}</span>&nbsp;Run</span>
                <span className="pip-item"><span className="pip todo" /><span className="pip-ct">{globalTodo}</span>&nbsp;Todo</span>
                <span className="pip-item"><span className="pip bk" /><span className="pip-ct">{globalBacklog}</span>&nbsp;Backlog</span>
                <span className="pip-item"><span className="pip bl" /><span className="pip-ct">{globalBlocked}</span>&nbsp;Blocked</span>
              </div>
              <div className="gs-right">
                <span className="gs-pct">{globalPct}%</span>
                <div className="gs-bar">
                  <i style={{ width: `${globalPct}%` }} />
                </div>
              </div>
            </div>
          )
        })() : null}

        {/* Swim view */}
        {activeView === 'swim' && (
          <SwimView
            tasks={tasks}
            assigneeLabels={assigneeLabels}
            onCardClick={(t) => setEditingTask(t)}
          />
        )}
        {activeView === 'time' && (
          <TimelineView
            tasks={tasks}
            onCardClick={(t) => setEditingTask(t)}
          />
        )}

        {/* Board */}
        {activeView === 'board' && (
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCorners}
          onDragStart={handleDndDragStart}
          onDragEnd={handleDndDragEnd}
        >
        <div className="board">
          <div className="board-grid">
          {visibleStatuses.map((status) => {
            const colTasks = tasksByStatus[status]
            const colColor = COLUMN_COLORS[status]
            const colLabel = COLUMN_LABELS[status]
            const unassigned = colTasks.filter((t) => !t.assignee).length
            const runningLive = colTasks.filter((t) => t.status === 'running').length

            return (
              <DroppableColumn
                key={status}
                status={status}
                colColor={colColor}
                taskCount={colTasks.length}
              >
                {/* Column header */}
                <div className="col-h">
                  <span className="pip" />
                  <h3>{colLabel}</h3>
                  <span className="ct">
                    {tasksQuery.isFetching && tasksQuery.data === undefined ? '…' : colTasks.length}
                  </span>
                  <button
                    className="add"
                    onClick={() => { setCreateColumn(status); setShowCreate(true) }}
                    title={`Add to ${colLabel}`}
                  >
                    <HugeiconsIcon icon={Add01Icon} size={12} />
                  </button>
                </div>

                {/* Column meta row */}
                <div className="col-meta">
                  {(status === 'triage') && (
                    <><span><b>{colTasks.length}</b> Awaiting</span><span><b>{unassigned}</b> Unassigned</span><span>— WIP</span></>
                  )}
                  {status === 'todo' && (
                    <><span><b>{colTasks.length}</b> Ready</span><span><b>{colTasks.filter(t => (t.link_counts?.parents ?? 0) > 0).length}</b> Blockers</span></>
                  )}
                  {status === 'ready' && (
                    <span>Queued · will auto-dispatch</span>
                  )}
                  {status === 'running' && (
                    <><span><b>{runningLive}</b> Live</span><span>Tok/min —</span><span>WIP <b>{runningLive}/6</b></span></>
                  )}
                  {status === 'blocked' && (
                    <span>Needs attention · set block reason</span>
                  )}
                  {status === 'done' && (
                    <span><b>{colTasks.length}</b> Completed</span>
                  )}
                  {status === 'archived' && (
                    <span><b>{colTasks.length}</b> Archived</span>
                  )}
                </div>

                {/* Cards */}
                <div className="col-body">
                  {tasksQuery.isError ? (
                    <div className="col-empty">
                      <p>Failed to load</p>
                      <button onClick={() => tasksQuery.refetch()} className="text-xs text-[var(--theme-accent)] hover:underline mt-1">Retry</button>
                    </div>
                  ) : tasksQuery.isLoading ? (
                    <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
                  ) : colTasks.length === 0 ? (
                    <div className="col-empty">
                      <HugeiconsIcon icon={CheckListIcon} size={18} />
                      <div>No tasks</div>
                      <div className="sub">Drop here or click + to add</div>
                    </div>
                  ) : (
                    <AnimatePresence initial={false}>
                      {colTasks.map((task) => (
                        <motion.div
                          key={task.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="relative group"
                        >
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
                              <span className="text-white text-[9px] leading-none flex items-center justify-center w-full h-full">✓</span>
                            )}
                          </button>
                          <DraggableCard
                            taskId={task.id}
                            isDragging={draggingId === task.id}
                          >
                            <TaskCard
                              task={task}
                              colColor={colColor}
                              assigneeLabels={assigneeLabels}
                              isDragging={draggingId === task.id}
                              onDragStart={(e) => handleDragStart(e, task.id)}
                              onClick={() => setEditingTask(task)}
                            />
                          </DraggableCard>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </DroppableColumn>
            )
          })}
          </div>
        </div>
        </DndContext>
        )}

        {/* Create dialog */}
        <TaskDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          defaultColumn={createColumn}
          assignees={assigneeOptions as Array<TaskAssignee>}
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

        {/* Done-list drawer — opened by clicking Done stat cell */}
        {showDoneList && (
          <TaskDetailDrawer
            mode="list"
            listTasks={(doneTasksQuery.data ?? []).filter((t) => t.status === 'done')}
            onClose={() => setShowDoneList(false)}
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

      {/* Status footer */}
      <footer className="tk-status">
        {/* CPU — no client metric API; placeholder */}
        <span className="grp"><span className="pulse" aria-hidden="true" /> CPU <b>—</b></span>
        <span className="sep" aria-hidden="true" />
        {/* SF-01: RAM — static, backend metric not exposed */}
        <span className="grp">RAM <b>16 GB</b> / 16 GB</span>
        <span className="sep" aria-hidden="true" />
        {/* SF-02: Disk — static, backend metric not exposed */}
        <span className="grp">Disk <span className="v warn">75%</span></span>
        <span className="sep" aria-hidden="true" />
        <span className="grp">Hermes <span className="v ok">enhanced</span></span>
        <span className="sep" aria-hidden="true" />
        {/* SF-03: relative time from TanStack Query dataUpdatedAt */}
        <span className="grp">Updated <b>{(() => {
          void footerTick // consumed to trigger re-render every 10s
          const ms = tasksQuery.dataUpdatedAt
          if (!ms) return '—'
          const s = Math.floor((Date.now() - ms) / 1000)
          if (s < 60) return `${s}s`
          const m = Math.floor(s / 60)
          if (m < 60) return `${m}m`
          const h = Math.floor(m / 60)
          if (h < 24) return `${h}h`
          return `${Math.floor(h / 24)}d`
        })()} ago</b></span>
        <span style={{ marginLeft: 'auto' }} className="grp">View <b>{activeView === 'board' ? 'Board' : activeView === 'swim' ? 'Swim' : 'Time'}</b></span>
        <span className="sep" aria-hidden="true" />
        <span className="grp">Sort <b>Recent</b></span>
      </footer>
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
