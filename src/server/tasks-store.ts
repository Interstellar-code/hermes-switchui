/**
 * Legacy SwitchUI tasks.json store — type definitions only.
 * The active task board is backed by Hermes Agent Kanban (kanban.db via :9119 API).
 * CRUD exports (listTasks, createTask, updateTask, moveTask, deleteTask) were
 * removed in #151 — no route callers since the Kanban cutover.
 */

export type TaskColumn = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'high' | 'medium' | 'low'

export type TaskRecord = {
  id: string
  title: string
  description: string
  column: TaskColumn
  priority: TaskPriority
  assignee: string | null
  tags: Array<string>
  due_date: string | null
  position: number
  created_by: string
  created_at: string
  updated_at: string
}
