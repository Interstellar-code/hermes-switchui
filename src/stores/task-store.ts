/**
 * Task System Lite — Swarm2 mission-scoped local task planning.
 *
 * This store is intentionally LOCAL-ONLY and does NOT sync to any backend API.
 * The dead /api/tasks fetch calls that were previously here have been removed
 * because that route never existed. This store is used only by Swarm2 mission
 * orchestration (upsertMissionTasks, getTasksByMission) as an ephemeral
 * in-process planning surface.
 *
 * For the canonical task board, see /tasks (Hermes Agent Kanban via :9119 API).
 * Do not add backend sync here without first deciding on the tenant model.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3'

export type Task = {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  project?: string
  missionId?: string
  assignedAgent?: string
  tags: string[]
  dueDate?: string
  reminder?: string
  createdAt: string
  updatedAt: string
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

export const STATUS_ORDER: TaskStatus[] = [
  'backlog',
  'in_progress',
  'review',
  'done',
]

export const PRIORITY_ORDER: TaskPriority[] = ['P0', 'P1', 'P2', 'P3']

/** Seed data from real Swarm tasks */
const SEED_TASKS: Task[] = []

function normalizeTaskList(payload: unknown): Task[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as { tasks?: unknown }).tasks)
  ) {
    return []
  }

  const tasks = (payload as { tasks: unknown[] }).tasks
  return tasks.filter((task): task is Task => {
    if (!task || typeof task !== 'object') return false
    const maybeTask = task as Partial<Task>
    return (
      typeof maybeTask.id === 'string' &&
      typeof maybeTask.title === 'string' &&
      typeof maybeTask.description === 'string' &&
      typeof maybeTask.status === 'string' &&
      typeof maybeTask.priority === 'string' &&
      Array.isArray(maybeTask.tags) &&
      typeof maybeTask.createdAt === 'string' &&
      typeof maybeTask.updatedAt === 'string'
    )
  })
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const maybeTask = value as Partial<Task>
  return (
    typeof maybeTask.id === 'string' &&
    typeof maybeTask.title === 'string' &&
    typeof maybeTask.description === 'string' &&
    typeof maybeTask.status === 'string' &&
    typeof maybeTask.priority === 'string' &&
    Array.isArray(maybeTask.tags) &&
    typeof maybeTask.createdAt === 'string' &&
    typeof maybeTask.updatedAt === 'string'
  )
}

function createClientTaskId(): string {
  return `TASK-${Date.now().toString(36).toUpperCase()}`
}


type TaskStore = {
  tasks: Task[]
  afterSync: boolean
  syncFromApi: () => Promise<void>
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  updateTask: (
    id: string,
    updates: Partial<Omit<Task, 'id' | 'createdAt'>>,
  ) => Promise<void>
  moveTask: (id: string, status: TaskStatus) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  // Mission-scoped selectors + actions (CS-020)
  getTasksByMission: (missionId: string) => Task[]
  upsertMissionTasks: (tasks: Array<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>) => void
  updateTaskStatus: (taskId: string, status: TaskStatus) => void
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: SEED_TASKS,
      afterSync: false,
      // syncFromApi is now a no-op: this store is local-only.
      // The /api/tasks route never existed. Sync is not supported.
      syncFromApi: async function syncFromApi() {
        set({ afterSync: true })
      },
      addTask: async (taskData) => {
        const now = new Date().toISOString()
        const task: Task = {
          ...taskData,
          id: createClientTaskId(),
          createdAt: now,
          updatedAt: now,
        }
        set((state) => ({ tasks: [task, ...state.tasks] }))
      },
      updateTask: async (id, updates) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t,
          ),
        }))
      },
      moveTask: async (id, status) => {
        await get().updateTask(id, { status })
      },
      deleteTask: async (id) => {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }))
      },
      // CS-020: Mission-scoped selectors
      getTasksByMission: (missionId: string) => {
        return get().tasks.filter((t) => t.missionId === missionId)
      },
      upsertMissionTasks: (tasks) => {
        const now = new Date().toISOString()
        const newTasks: Task[] = tasks.map((t) => ({
          ...t,
          id: `mission-${t.missionId ?? 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: now,
          updatedAt: now,
        }))
        set((state) => ({
          tasks: [...state.tasks.filter((existing) => !newTasks.some((n) => n.title === existing.title && n.missionId === existing.missionId)), ...newTasks],
        }))
      },
      updateTaskStatus: (taskId, status) => {
        set((state) => ({
          tasks: state.tasks.map((t) => t.id === taskId ? { ...t, status, updatedAt: new Date().toISOString() } : t),
        }))
      },
    }),
    {
      name: 'clawsuite-tasks-v1',
    },
  ),
)
