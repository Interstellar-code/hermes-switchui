'use client'

import '@/styles/matrix-tasks.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearch } from '@tanstack/react-router'
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
import type { BulkResponse, HermesKanbanStatus } from '@/lib/hermes-kanban-types'
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

export const TASKS_COLUMN_VISIBILITY_DEFAULTS = {
  triage: true,
  ready: true,
  running: true,
  blocked: true,
  done: false,
  archived: false,
} as const

function taskMatchesSearch(task: ClaudeTask, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    task.id,
    task.title,
    task.body,
    task.assignee,
    task.tenant,
    task.status,
    task.block_reason,
    task.summary,
    task.latest_summary,
    ...(task.skills ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
    .toLowerCase()
  return haystack.includes(q)
}

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
  const [showCreate, setShowCreate] = useState(false)
  const [createColumn, setCreateColumn] = useState<TaskColumn>('triage')
  const [editingTask, setEditingTask] = useState<ClaudeTask | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [, setDragOverColumn] = useState<HermesKanbanStatus | null>(null)
  // ── Column visibility — persisted to localStorage ──────────────────────
  const COLS_KEY = 'switchui-column-visibility'
  // BC-01: v3 migration — ensure triage/ready/running/blocked default to true
  // for all visitors (older storage may predate some column keys entirely).
  const [showDone, setShowDone] = useState<boolean>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, unknown>
      if (!raw.migrated_v3) {
        const migrated = {
          ...raw,
          triage: TASKS_COLUMN_VISIBILITY_DEFAULTS.triage,
          ready: TASKS_COLUMN_VISIBILITY_DEFAULTS.ready,
          running: TASKS_COLUMN_VISIBILITY_DEFAULTS.running,
          blocked: TASKS_COLUMN_VISIBILITY_DEFAULTS.blocked,
          migrated_v3: true,
        }
        localStorage.setItem(COLS_KEY, JSON.stringify(migrated))
        return typeof raw.done === 'boolean'
          ? raw.done
          : TASKS_COLUMN_VISIBILITY_DEFAULTS.done
      }
      return typeof raw.done === 'boolean'
        ? raw.done
        : TASKS_COLUMN_VISIBILITY_DEFAULTS.done
    } catch { return TASKS_COLUMN_VISIBILITY_DEFAULTS.done }
  })
  const [showArchived, setShowArchived] = useState<boolean>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, unknown>
      return typeof raw.archived === 'boolean'
        ? raw.archived
        : TASKS_COLUMN_VISIBILITY_DEFAULTS.archived
    } catch { return TASKS_COLUMN_VISIBILITY_DEFAULTS.archived }
  })
  const [showTriage, setShowTriage] = useState<boolean>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, unknown>
      return typeof raw.triage === 'boolean'
        ? raw.triage
        : TASKS_COLUMN_VISIBILITY_DEFAULTS.triage
    } catch { return TASKS_COLUMN_VISIBILITY_DEFAULTS.triage }
  })
  const [showReady, setShowReady] = useState<boolean>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, unknown>
      return typeof raw.ready === 'boolean'
        ? raw.ready
        : TASKS_COLUMN_VISIBILITY_DEFAULTS.ready
    } catch { return TASKS_COLUMN_VISIBILITY_DEFAULTS.ready }
  })
  const [showRunning, setShowRunning] = useState<boolean>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, unknown>
      return typeof raw.running === 'boolean'
        ? raw.running
        : TASKS_COLUMN_VISIBILITY_DEFAULTS.running
    } catch { return TASKS_COLUMN_VISIBILITY_DEFAULTS.running }
  })
  const [showBlocked, setShowBlocked] = useState<boolean>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, unknown>
      return typeof raw.blocked === 'boolean'
        ? raw.blocked
        : TASKS_COLUMN_VISIBILITY_DEFAULTS.blocked
    } catch { return TASKS_COLUMN_VISIBILITY_DEFAULTS.blocked }
  })
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [taskSearch, setTaskSearch] = useState('')
  // ── Date range filter — persisted to localStorage ─────────────────────
  const DATE_FILTER_KEY = 'switchui-tasks-date-filter'
  const [dateRange, setDateRange] = useState<'all' | 'today' | '7d' | '30d' | 'custom'>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(DATE_FILTER_KEY) ?? '{}') as Record<string, unknown>
      const v = raw.dateRange
      if (v === 'today' || v === '7d' || v === '30d' || v === 'custom') return v
      return 'all'
    } catch { return 'all' }
  })
  const [dateStart, setDateStart] = useState<string>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(DATE_FILTER_KEY) ?? '{}') as Record<string, unknown>
      return typeof raw.dateStart === 'string' ? raw.dateStart : ''
    } catch { return '' }
  })
  const [dateEnd, setDateEnd] = useState<string>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(DATE_FILTER_KEY) ?? '{}') as Record<string, unknown>
      return typeof raw.dateEnd === 'string' ? raw.dateEnd : ''
    } catch { return '' }
  })

  // ── Archive Done / Purge Archived popovers ────────────────────────────────
  const archiveDoneBtnRef = useRef<HTMLButtonElement>(null)
  const purgeArchivedBtnRef = useRef<HTMLButtonElement>(null)
  const [showArchiveDonePopover, setShowArchiveDonePopover] = useState(false)
  const [archiveDonePanelPos, setArchiveDonePanelPos] = useState<{ top: number; right: number } | null>(null)
  const [archiveDoneRange, setArchiveDoneRange] = useState<'today' | '7d' | '30d' | 'all'>('7d')
  const [showPurgePopover, setShowPurgePopover] = useState(false)
  const [purgePanelPos, setPurgePanelPos] = useState<{ top: number; right: number } | null>(null)
  const [purgeRange, setPurgeRange] = useState<'today' | '7d' | '30d' | 'all'>('7d')
  const [purgeConfirmStep, setPurgeConfirmStep] = useState(false)

  function openArchiveDonePopover() {
    if (archiveDoneBtnRef.current) {
      const r = archiveDoneBtnRef.current.getBoundingClientRect()
      setArchiveDonePanelPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setPurgeConfirmStep(false)
    setShowArchiveDonePopover(v => !v)
    setShowPurgePopover(false)
  }

  function openPurgePopover() {
    if (purgeArchivedBtnRef.current) {
      const r = purgeArchivedBtnRef.current.getBoundingClientRect()
      setPurgePanelPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setPurgeConfirmStep(false)
    setShowPurgePopover(v => !v)
    setShowArchiveDonePopover(false)
  }

  /** ms cutoff for a date range label */
  function rangeCutoffMs(range: 'today' | '7d' | '30d' | 'all'): number | null {
    const now = Date.now()
    if (range === 'today') return now - 24 * 60 * 60 * 1000
    if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
    if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000
    return null // all
  }

  const [blockedPending, setBlockedPending] = useState<BlockedDropPending>(null)
  const [blockedReason, setBlockedReason] = useState('')
  const [runningMovePending, setRunningMovePending] = useState<RunningMovePending>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Two-step arm for the destructive bulk-delete action
  const [bulkDeleteArm, setBulkDeleteArm] = useState(false)
  // Toggle every task in a column in/out of the selection
  const toggleColumnSelect = useCallback((ids: Array<string>) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id))
      if (allSelected) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }, [])
  // View toggle: board is the only implemented view for P1; swim/time are placeholders
  const [activeView, setActiveView] = useState<'board' | 'swim' | 'time'>('board')
  // Done-stat click: open drawer in list mode
  const [showDoneList, setShowDoneList] = useState(false)
  // Collapsible sidebar accordions — all open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    profile: true, tenant: true, date: true, columns: true,
  })
  const toggleSection = (k: string) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }))

  // Persist column visibility to localStorage whenever any toggle changes
  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify({
        done: showDone, archived: showArchived,
        triage: showTriage, ready: showReady, running: showRunning, blocked: showBlocked,
        migrated_v3: true,
      }))
    } catch { /* storage quota / private-mode — silently ignore */ }
  }, [showDone, showArchived, showTriage, showReady, showRunning, showBlocked])

  // Persist date filter to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(DATE_FILTER_KEY, JSON.stringify({ dateRange, dateStart, dateEnd }))
    } catch { /* ignore */ }
  }, [dateRange, dateStart, dateEnd])

  const search = useSearch({ from: '/tasks' })
  const initialAssignee =
    typeof search.assignee === 'string' ? search.assignee : null
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(
    initialAssignee,
  )
  const [tenantFilter, setTenantFilter] = useState<string | null>(null)
  const [dispatchResult, setDispatchResult] = useState<string | null>(null)
  const dispatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current) }, [])

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

  // Gateway /stats omits archived from by_status. Derive it by fetching
  // include_archived=true and counting the archived bucket. Slower path —
  // long stale to avoid hammering the gateway.
  const archivedCountQuery = useQuery({
    queryKey: ['claude', 'tasks', 'archived-count'],
    queryFn: async () => {
      const all = await fetchTasks({ include_archived: true })
      return all.filter((t) => t.status === 'archived').length
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
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
  const assigneeLabels = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of assignees) map[a.id] = a.label
    return map
  }, [assignees])

  const tasks = tasksQuery.data ?? []

  // Group tasks by Agent status
  const tasksByStatus = useMemo(() => {
    // Compute date cutoff for board visibility filter
    let dateCutoffMs: number | null = null
    let dateEndMs: number | null = null
    if (dateRange === 'today') dateCutoffMs = Date.now() - 24 * 60 * 60 * 1000
    else if (dateRange === '7d') dateCutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000
    else if (dateRange === '30d') dateCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000
    else if (dateRange === 'custom') {
      if (dateStart) dateCutoffMs = new Date(dateStart).setHours(0, 0, 0, 0)
      if (dateEnd) dateEndMs = new Date(dateEnd).setHours(23, 59, 59, 999)
    }

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
      if (dateCutoffMs !== null && t.created_at * 1000 < dateCutoffMs) continue
      if (dateEndMs !== null && t.created_at * 1000 > dateEndMs) continue
      if (!taskMatchesSearch(t, taskSearch)) continue
      map[status].push(t)
    }
    return map
  }, [tasks, assigneeFilter, dateRange, dateStart, dateEnd, taskSearch])

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
      delete: hardDelete,
      ids: explicitIds,
    }: {
      status?: HermesKanbanStatus
      archive?: boolean
      delete?: boolean
      /** When provided, operates on these ids instead of selectedIds. */
      ids?: Array<string>
    }) => {
      const ids = explicitIds ?? Array.from(selectedIds)
      const res = await fetch(`${KANBAN_BASE}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          ...(status ? { status } : {}),
          ...(archive ? { archive: true } : {}),
          ...(hardDelete ? { delete: true } : {}),
        }),
      })
      if (!res.ok) throw new Error(`Bulk update failed: ${res.status}`)
      return res.json() as Promise<BulkResponse>
    },
    onSuccess: (data, vars) => {
      const failed = data.results.filter((r) => !r.ok)
      if (failed.length > 0)
        toast(`${failed.length} tasks failed to ${vars.delete ? 'delete' : 'update'}`, { type: 'error' })
      else toast(vars.delete ? `${data.results.length} tasks deleted` : `${data.results.length} tasks updated`)
      setSelectedIds(new Set())
      setBulkDeleteArm(false)
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['claude', 'tasks', 'stats'] })
      void queryClient.invalidateQueries({ queryKey: ['claude', 'tasks', 'archived-count'] })
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
      if (dispatchTimerRef.current) clearTimeout(dispatchTimerRef.current)
      dispatchTimerRef.current = setTimeout(() => { setDispatchResult(null); dispatchTimerRef.current = null }, 4000)
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
    [...HERMES_KANBAN_VISIBLE_STATUS_ORDER, 'archived'] as Array<HermesKanbanStatus>
  ).filter((s) => {
    if (s === 'done' && !showDone) return false
    if (s === 'triage' && !showTriage) return false
    if (s === 'ready' && !showReady) return false
    if (s === 'running' && !showRunning) return false
    if (s === 'blocked' && !showBlocked) return false
    if (s === 'archived' && !showArchived) return false
    return true
  })

  return (
    <div className="h-screen bg-surface text-ink tk-shell" data-screen="tasks">

      {/* ── Filter sidebar ── */}
      <aside className={cn('tk-filter', filtersCollapsed && 'collapsed')} aria-label="Task filters">
        <div className="tk-filter-hdr">
          <h2>Tasks</h2>
          <div className="hdr-right">
            <span className="ct">{stats.total}</span>
            <button
              type="button"
              className="collapse-btn"
              onClick={() => setFiltersCollapsed((v) => !v)}
              title={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
              aria-label={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                {filtersCollapsed ? (
                  <path d="M9 18l6-6-6-6" />
                ) : (
                  <path d="M15 18l-6-6 6-6" />
                )}
              </svg>
            </button>
          </div>
        </div>

        <div className="tk-filter-search">
          <input
            type="text"
            placeholder="Search tasks…"
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            aria-label="Search tasks"
          />
        </div>

        <div className="tk-filter-body">
          <div className={cn('tk-filter-section', !openSections.profile && 'collapsed')}>
            <button
              type="button"
              className="sec-label tk-sec-head"
              aria-expanded={openSections.profile}
              onClick={() => toggleSection('profile')}
            >
              <span>Agent profile</span>
              <svg className="tk-sec-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {openSections.profile && (
            <div className="tk-filter-list">
              <button
                type="button"
                className={cn('tk-filter-item', !assigneeFilter && 'active')}
                onClick={() => setAssigneeFilter(null)}
              >
                <span className="item-label">All profiles</span>
                <span className="item-ct">{tasks.length}</span>
              </button>
              {assigneeOptions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={cn('tk-filter-item', assigneeFilter === a.id && 'active')}
                  onClick={() => setAssigneeFilter(assigneeFilter === a.id ? null : a.id)}
                >
                  <span className="item-label">{a.onDisk ? a.label : `${a.label} ⚠`}</span>
                  <span className="item-ct">
                    {tasks.filter((t) => t.assignee === a.id).length}
                  </span>
                </button>
              ))}
            </div>
            )}
          </div>

          {uniqueTenants.length > 0 && (
            <div className={cn('tk-filter-section', !openSections.tenant && 'collapsed')}>
              <button
                type="button"
                className="sec-label tk-sec-head"
                aria-expanded={openSections.tenant}
                onClick={() => toggleSection('tenant')}
              >
                <span>Tenant</span>
                <svg className="tk-sec-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {openSections.tenant && (
              <div className="tk-filter-list">
                <button
                  type="button"
                  className={cn('tk-filter-item', !tenantFilter && 'active')}
                  onClick={() => setTenantFilter(null)}
                >
                  <span className="item-label">All tenants</span>
                  <span className="item-ct">{tasks.length}</span>
                </button>
                {uniqueTenants.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={cn('tk-filter-item', tenantFilter === t && 'active')}
                    onClick={() => setTenantFilter(tenantFilter === t ? null : t)}
                  >
                    <span className="item-label">{t}</span>
                    <span className="item-ct">
                      {tasks.filter((task) => task.tenant === t).length}
                    </span>
                  </button>
                ))}
              </div>
              )}
            </div>
          )}

          <div className={cn('tk-filter-section', !openSections.date && 'collapsed')}>
            <button
              type="button"
              className="sec-label tk-sec-head"
              aria-expanded={openSections.date}
              onClick={() => toggleSection('date')}
            >
              <span>Date range</span>
              <svg className="tk-sec-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {openSections.date && (<>
            <div className="tk-filter-list">
              {(['all', 'today', '7d', '30d', 'custom'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={cn('tk-filter-item', dateRange === r && 'active')}
                  onClick={() => setDateRange(r)}
                >
                  <span className="item-label">
                    {r === 'all' ? 'All time' : r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Custom range'}
                  </span>
                </button>
              ))}
            </div>
            {dateRange === 'custom' && (
              <div className="tk-date-custom">
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  style={{ colorScheme: 'dark' }}
                  aria-label="Start date"
                />
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  style={{ colorScheme: 'dark' }}
                  aria-label="End date"
                />
              </div>
            )}
            </>)}
          </div>

          <div className={cn('tk-filter-section', !openSections.columns && 'collapsed')}>
            <button
              type="button"
              className="sec-label tk-sec-head"
              aria-expanded={openSections.columns}
              onClick={() => toggleSection('columns')}
            >
              <span>Visible columns</span>
              <svg className="tk-sec-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {openSections.columns && (
            <div className="tk-filter-list">
              {([
                { key: 'triage', label: 'Triage / Backlog', on: showTriage, toggle: () => setShowTriage((v) => !v) },
                { key: 'ready', label: 'Ready', on: showReady, toggle: () => setShowReady((v) => !v) },
                { key: 'running', label: 'Running', on: showRunning, toggle: () => setShowRunning((v) => !v) },
                { key: 'blocked', label: 'Blocked', on: showBlocked, toggle: () => setShowBlocked((v) => !v) },
                { key: 'done', label: 'Done', on: showDone, toggle: () => setShowDone((v) => !v) },
                { key: 'archived', label: 'Archived', on: showArchived, toggle: () => setShowArchived((v) => !v) },
              ] as const).map(({ key, label, on, toggle }) => (
                <button
                  key={key}
                  type="button"
                  className={cn('tk-check-item', on && 'on')}
                  onClick={toggle}
                >
                  <span className="ck">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            )}
          </div>
        </div>

        <div className="tk-filter-footer">
          <span className="count-line">
            Showing {Object.values(tasksByStatus).reduce((sum, arr) => sum + arr.length, 0)} of {tasks.length} tasks
          </span>
          <button
            type="button"
            className="reset-btn"
            onClick={() => {
              setTaskSearch('')
              setAssigneeFilter(null)
              setTenantFilter(null)
              setDateRange('all')
              setDateStart('')
              setDateEnd('')
              setShowTriage(TASKS_COLUMN_VISIBILITY_DEFAULTS.triage)
              setShowReady(TASKS_COLUMN_VISIBILITY_DEFAULTS.ready)
              setShowRunning(TASKS_COLUMN_VISIBILITY_DEFAULTS.running)
              setShowBlocked(TASKS_COLUMN_VISIBILITY_DEFAULTS.blocked)
              setShowDone(TASKS_COLUMN_VISIBILITY_DEFAULTS.done)
              setShowArchived(TASKS_COLUMN_VISIBILITY_DEFAULTS.archived)
            }}
          >
            Reset filters
          </button>
        </div>

        <div className="tk-rail">
          <span className="rail-label">Tasks</span>
          <span className="rail-badge">{stats.total}</span>
        </div>
      </aside>

      {/* ── Main area wrapper ── */}
      <div className="tk-main-wrap">

      {/* ── Breadcrumb strip (TS-01 / TS-02 / TS-03) ── */}
      <header className="tk-top">
        <div className="crumbs" aria-label="Breadcrumb">
          <span>Switch UI</span><span className="sep" aria-hidden="true">/</span>
          <span className="cur">Tasks</span><span className="sep" aria-hidden="true">/</span>
          <span>Kanban</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {/* TS-02: stat cells */}
          <div className="meta">
            <button
              type="button"
              className="stat clickable"
              style={{ '--col-color': COLUMN_COLORS.done } as React.CSSProperties}
              aria-label={`Show ${stats.done} done tasks`}
              title="Click to view done tasks"
              onClick={() => setShowDoneList(true)}
            >
              <span className="pip" />
              <span className="l">Done</span>
              <span className="ct">{stats.done}</span>
            </button>
            <div className="stat" style={{ '--col-color': COLUMN_COLORS.running } as React.CSSProperties}>
              <span className="pip" />
              <span className="l">Running</span>
              <span className="ct">{stats.running}</span>
            </div>
            <div className="stat" style={{ '--col-color': COLUMN_COLORS.todo } as React.CSSProperties}>
              <span className="pip" />
              <span className="l">Todo</span>
              <span className="ct">{tasksByStatus.todo.length}</span>
            </div>
            <div className="stat" style={{ '--col-color': COLUMN_COLORS.triage } as React.CSSProperties}>
              <span className="pip" />
              <span className="l">Backlog</span>
              <span className="ct">{tasksByStatus.triage.length}</span>
            </div>
            <div className="stat" style={{ '--col-color': 'var(--m-green-500, #00ff41)' } as React.CSSProperties}>
              <span className="pip" />
              <span className="l">Total</span>
              <span className="ct">{stats.total}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Action bar (TS-04 / AB-01..04) ── */}
      <div className="actbar">
        {/* AB-02/03: header — title + tools row */}
        <div className="actbar-header">
          <h1>Tasks</h1>

          {/* AB-03: right — tools row */}
          <div className="tools">
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

          {/* Archive Done — bulk-archive all done tasks in date range */}
          {(() => {
            // Use completed_at (unix seconds) for done tasks; fall back to created_at.
            const cutoffMs = rangeCutoffMs(archiveDoneRange)
            const doneTasks = tasks.filter((t) => {
              if (t.status !== 'done') return false
              if (assigneeFilter && t.assignee !== assigneeFilter) return false
              if (!cutoffMs) return true
              const ts = t.completed_at != null ? t.completed_at * 1000 : t.created_at * 1000
              return ts >= cutoffMs
            })
            const RANGE_LABELS = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' } as const
            return (
              <>
                <button
                  ref={archiveDoneBtnRef}
                  type="button"
                  className="btn-sec"
                  onClick={openArchiveDonePopover}
                  title="Archive all done tasks in a date range"
                  aria-label="Archive done tasks"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 4h18v4H3z"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>
                </button>
                {showArchiveDonePopover && archiveDonePanelPos && createPortal(
                  <>
                    <div className="fixed inset-0 z-[9998]" onClick={() => setShowArchiveDonePopover(false)} />
                    <div
                      className="fixed z-[9999] w-60 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-2xl p-1.5"
                      style={{ top: archiveDonePanelPos.top, right: archiveDonePanelPos.right }}
                    >
                      <p className="px-3 pt-1.5 pb-1 text-[9px] uppercase tracking-widest text-[var(--theme-muted)] font-medium">
                        Archive done tasks from…
                      </p>
                      {(['today', '7d', '30d', 'all'] as const).map((r) => {
                        const count = (() => {
                          const c = rangeCutoffMs(r)
                          return tasks.filter((t) => {
                            if (t.status !== 'done') return false
                            if (!c) return true
                            const ts = t.completed_at != null ? t.completed_at * 1000 : t.created_at * 1000
                            return ts >= c
                          }).length
                        })()
                        return (
                          <button
                            key={r}
                            onClick={() => setArchiveDoneRange(r)}
                            className={cn(
                              'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors',
                              archiveDoneRange === r
                                ? 'bg-[var(--theme-accent)] text-white'
                                : 'hover:bg-[var(--theme-hover)] text-[var(--theme-text)]',
                            )}
                          >
                            <span>{RANGE_LABELS[r]}</span>
                            <span className="opacity-70">{count} tasks</span>
                          </button>
                        )
                      })}
                      <div className="border-t border-[var(--theme-border)] mt-1 pt-1 px-1.5 pb-1">
                        <p className="px-2 py-1 text-[10px] text-[var(--theme-muted)]">
                          Archive {doneTasks.length} done task{doneTasks.length !== 1 ? 's' : ''} from {RANGE_LABELS[archiveDoneRange].toLowerCase()}
                        </p>
                        <button
                          onClick={() => {
                            if (doneTasks.length === 0) { toast('No done tasks in that range', { type: 'error' }); return }
                            setShowArchiveDonePopover(false)
                            void bulkMutation.mutate({ archive: true, ids: doneTasks.map((t) => t.id) })
                          }}
                          disabled={bulkMutation.isPending || doneTasks.length === 0}
                          className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--theme-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                          Confirm Archive
                        </button>
                      </div>
                    </div>
                  </>,
                  document.body,
                )}
              </>
            )
          })()}

          {/* Purge Archived — hard-delete archived tasks in date range */}
          {(() => {
            const RANGE_LABELS = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' } as const
            return (
              <>
                <button
                  ref={purgeArchivedBtnRef}
                  type="button"
                  className="btn-danger"
                  onClick={openPurgePopover}
                  title="Permanently delete all archived tasks in a date range"
                  aria-label="Purge archived tasks"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
                {showPurgePopover && purgePanelPos && createPortal(
                  <>
                    <div className="fixed inset-0 z-[9998]" onClick={() => { setShowPurgePopover(false); setPurgeConfirmStep(false) }} />
                    <div
                      className="fixed z-[9999] w-64 rounded-xl border border-red-500/40 bg-[var(--theme-card)] shadow-2xl p-1.5"
                      style={{ top: purgePanelPos.top, right: purgePanelPos.right }}
                    >
                      {!purgeConfirmStep ? (
                        <>
                          <p className="px-3 pt-1.5 pb-1 text-[9px] uppercase tracking-widest text-red-400 font-medium">
                            Purge archived tasks from…
                          </p>
                          {(['today', '7d', '30d', 'all'] as const).map((r) => (
                            <button
                              key={r}
                              onClick={() => setPurgeRange(r)}
                              className={cn(
                                'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors',
                                purgeRange === r
                                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                  : 'hover:bg-[var(--theme-hover)] text-[var(--theme-text)]',
                              )}
                            >
                              <span>{RANGE_LABELS[r]}</span>
                            </button>
                          ))}
                          <div className="border-t border-red-500/20 mt-1 pt-1 px-1.5 pb-1">
                            <button
                              onClick={async () => {
                                // One-shot fetch archived tasks, then show confirm step
                                const cutoffMs = rangeCutoffMs(purgeRange)
                                // archived tasks may not be in current `tasks` (only when showArchived=true)
                                // do a targeted fetch
                                const allWithArchived = await fetchTasks({ include_done: true, include_archived: true })
                                const matching = allWithArchived.filter((t) => {
                                  if (t.status !== 'archived') return false
                                  if (assigneeFilter && t.assignee !== assigneeFilter) return false
                                  if (!cutoffMs) return true
                                  const ts = t.completed_at != null ? t.completed_at * 1000 : t.created_at * 1000
                                  return ts >= cutoffMs
                                })
                                if (matching.length === 0) { toast('No archived tasks in that range', { type: 'error' }); return }
                                // stash ids for confirm step via a closure ref
                                ;(purgeArchivedBtnRef.current as HTMLButtonElement & { _purgeIds?: Array<string> })._purgeIds = matching.map((t) => t.id)
                                setPurgeConfirmStep(true)
                              }}
                              className="w-full px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              Next →
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-red-400 font-medium">
                            Confirm permanent delete
                          </p>
                          <p className="px-3 py-2 text-xs text-[var(--theme-muted)]">
                            This permanently deletes{' '}
                            <span className="text-red-400 font-semibold">
                              {((purgeArchivedBtnRef.current as HTMLButtonElement & { _purgeIds?: Array<string> })._purgeIds ?? []).length}
                            </span>{' '}
                            archived tasks. This cannot be undone.
                          </p>
                          <div className="flex gap-1.5 px-1.5 pb-1.5">
                            <button
                              onClick={() => setPurgeConfirmStep(false)}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-hover)] transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                const ids = ((purgeArchivedBtnRef.current as HTMLButtonElement & { _purgeIds?: Array<string> })._purgeIds ?? [])
                                setShowPurgePopover(false)
                                setPurgeConfirmStep(false)
                                void bulkMutation.mutate({ delete: true, ids })
                              }}
                              disabled={bulkMutation.isPending}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-40 transition-colors"
                            >
                              Delete Forever
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </>,
                  document.body,
                )}
              </>
            )
          })()}

          {/* Save as template */}
          <SaveAsTemplateButton />

          {/* Settings */}
          <KanbanSettingsButton />

        </div>
        </div>

        {/* Global stripe — 5-pip legend + progress bar */}
        {statsQuery.isLoading ? (
          <div className="actbar-stripe-skeleton" />
        ) : statsQuery.data ? (() => {
          const counts = statsQuery.data.by_status ?? {}
          const globalTotal = Object.values(counts).reduce<number>((acc, n) => acc + (typeof n === 'number' ? n : 0), 0)
          const globalDone = typeof counts.done === 'number' ? counts.done : 0
          const globalRun = typeof counts.running === 'number' ? counts.running : 0
          const globalTodo = typeof counts.todo === 'number' ? counts.todo : 0
          const globalBacklog = (typeof counts.triage === 'number' ? counts.triage : 0) + (typeof counts.ready === 'number' ? counts.ready : 0)
          const globalBlocked = typeof counts.blocked === 'number' ? counts.blocked : 0
          const globalArchived = archivedCountQuery.data ?? (typeof counts.archived === 'number' ? counts.archived : 0)
          const globalPct = globalTotal > 0 ? Math.round((globalDone / globalTotal) * 1000) / 10 : 0
          return (
            <div className="actbar-stripe">
              <span className="gs-lbl">Global · {globalTotal} Total</span>
              <div className="gs-pips">
                <span className="gs-pip-item"><span className="pip done" /><span className="pip-ct">{globalDone}</span>&nbsp;Done</span>
                <span className="gs-pip-item"><span className="pip run" /><span className="pip-ct">{globalRun}</span>&nbsp;Run</span>
                <span className="gs-pip-item"><span className="pip todo" /><span className="pip-ct">{globalTodo}</span>&nbsp;Todo</span>
                <span className="gs-pip-item"><span className="pip bk" /><span className="pip-ct">{globalBacklog}</span>&nbsp;Backlog</span>
                <span className="gs-pip-item"><span className="pip bl" /><span className="pip-ct">{globalBlocked}</span>&nbsp;Blocked</span>
                <span className="gs-pip-item"><span className="pip ar" /><span className="pip-ct">{globalArchived}</span>&nbsp;Archived</span>
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

        {/* Hint + active filter chip */}
        <div className="actbar-subhint sub">
          <span>Drag cards to change status — open a card to set assignee &amp; due date</span>
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
        </div>
      </div>

      {/* ── Page content ── */}
      <div className="tk-content pb-[calc(var(--tabbar-h,80px)+30px+1.5rem)]">
        <div className="tk-main">

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
                  {colTasks.length > 0 && (() => {
                    const colIds = colTasks.map((t) => t.id)
                    const allSelected = colIds.every((id) => selectedIds.has(id))
                    return (
                      <button
                        className={cn('sel-all', allSelected && 'on')}
                        onClick={() => toggleColumnSelect(colIds)}
                        title={allSelected ? `Deselect all in ${colLabel}` : `Select all in ${colLabel}`}
                        aria-pressed={allSelected}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <rect x="3" y="3" width="18" height="18" rx="3" />
                          <polyline points="8 12 11 15 16 9" />
                        </svg>
                      </button>
                    )
                  })()}
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
                    <><span><b>{colTasks.length}</b> Ready</span><span><b>{colTasks.filter(t => (t.link_counts?.parents ?? 0) > 0).length}</b> Blockers</span><span>Lead —</span></>
                  )}
                  {status === 'ready' && (
                    <span>Queued · will auto-dispatch</span>
                  )}
                  {status === 'running' && (
                    <><span><b>{runningLive}</b> Live</span><span>Tok/min —</span><span>WIP <b>{runningLive}/6</b></span></>
                  )}
                  {status === 'blocked' && (
                    <span>Drop tasks waiting on dependencies or input</span>
                  )}
                  {status === 'done' && (
                    <><span><b>{colTasks.length}</b> Completed</span><span>Auto-archive 7d</span></>
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
        </div>

      </div>
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
            onClick={() => {
              if (bulkDeleteArm) void bulkMutation.mutate({ delete: true })
              else setBulkDeleteArm(true)
            }}
            className={cn(
              'text-xs px-2 py-1 rounded',
              bulkDeleteArm
                ? 'bg-red-500/20 text-red-300 border border-red-500/40 font-semibold'
                : 'hover:bg-[var(--theme-hover)] text-red-400',
            )}
            disabled={bulkMutation.isPending}
            title="Permanently delete selected tasks — cannot be undone"
          >
            {bulkDeleteArm ? `Confirm delete ${selectedIds.size}?` : 'Delete'}
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setBulkDeleteArm(false) }}
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function SaveAsTemplateButton() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  // Fetch current board slug from boards list
  const boardsQuery = useQuery({
    queryKey: ['hermes-kanban', 'boards', 'list-for-template'],
    queryFn: async (): Promise<{ boards: Array<{ slug: string; name: string; is_current: boolean }>; current: string }> => {
      const res = await fetch('/api/hermes-kanban/boards')
      if (!res.ok) throw new Error(`Failed to fetch boards: ${res.status}`)
      return res.json() as Promise<{ boards: Array<{ slug: string; name: string; is_current: boolean }>; current: string }>
    },
    staleTime: 30_000,
  })

  const currentSlug = boardsQuery.data?.current ?? ''
  const currentBoard = boardsQuery.data?.boards.find((b) => b.slug === currentSlug)
  const currentBoardName = currentBoard?.name ?? currentSlug

  const [templateSlug, setTemplateSlug] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [resetStatus, setResetStatus] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open_modal() {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    // Pre-populate slug from current board name when opening
    const slug = slugify(currentBoardName || currentSlug || 'board')
    setTemplateSlug(slug)
    setTemplateName('')
    setResetStatus(true)
    setError(null)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setError(null)
    setSubmitting(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!templateSlug.trim()) { setError('Template slug is required'); return }
    if (!currentSlug) { setError('No active board found'); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/hermes-kanban/boards/${encodeURIComponent(currentSlug)}/save-as-template`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_slug: templateSlug.trim(),
            ...(templateName.trim() ? { name: templateName.trim() } : {}),
            reset_status: resetStatus,
          }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
        setError(body.detail ?? body.error ?? `Request failed: ${res.status}`)
        setSubmitting(false)
        return
      }
      const slug = templateSlug.trim()
      close()
      toast(`Saved as template '${slug}' — view at /board-templates`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={open_modal}
        disabled={boardsQuery.isLoading}
        title="Save board as template"
        className={cn(
          'flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors',
          'border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)]',
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="12" height="12">
          <path d="M4 3h6l2 2v6H4V3zM6 6h4M6 8h3M2 5v8h7"/>
        </svg>
        Template
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={close} />
          <form
            onSubmit={(e) => { void handleSubmit(e) }}
            className="fixed z-[9999] w-80 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-2xl p-4"
            style={{ top: pos.top, right: pos.right, backgroundColor: 'var(--theme-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--theme-muted)] font-medium mb-3">
              Save board as template
            </p>

            <div className="space-y-3">
              {/* template_slug */}
              <div>
                <label className="text-[10px] text-[var(--theme-muted)] uppercase tracking-wider block mb-1">
                  Template slug <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={templateSlug}
                  onChange={(e) => setTemplateSlug(e.target.value)}
                  placeholder="my-template"
                  required
                  className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-xs px-2 py-1.5 font-mono focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </div>

              {/* name (optional) */}
              <div>
                <label className="text-[10px] text-[var(--theme-muted)] uppercase tracking-wider block mb-1">
                  Display name <span className="opacity-50">(optional)</span>
                </label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={currentBoardName || ''}
                  className="w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-xs px-2 py-1.5 focus:outline-none focus:border-[var(--theme-accent)]"
                />
              </div>

              {/* reset_status toggle */}
              <button
                type="button"
                onClick={() => setResetStatus((v) => !v)}
                className="w-full flex items-center justify-between gap-3 text-xs"
              >
                <span className="text-[var(--theme-muted)]">Reset all task statuses to todo</span>
                <span
                  className={cn(
                    'w-8 h-4 rounded-full transition-colors relative shrink-0',
                    resetStatus ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-border)]',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                      resetStatus ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </span>
              </button>
              <p className="mt-1 text-[10px] leading-snug text-[var(--theme-muted)]">
                Off preserves only the <code>ready</code> state; all other statuses reset to{' '}
                <code>todo</code> (templates allow only <code>todo</code>/<code>ready</code>).
              </p>
            </div>

            {error && (
              <p className="mt-3 text-xs text-red-400">{error}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={close}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-[var(--theme-border)] text-[var(--theme-muted)] hover:text-[var(--theme-text)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !templateSlug.trim()}
                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-[var(--theme-accent)] text-black hover:opacity-90 disabled:opacity-40 transition-colors"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </>,
        document.body,
      )}
    </>
  )
}
