import { useEffect, useState } from 'react'
import {
  DialogContent,
  DialogRoot,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { HermesKanbanStatus } from '@/lib/hermes-kanban-types'
import { HERMES_KANBAN_STATUS_LABELS, HERMES_KANBAN_VISIBLE_STATUS_ORDER, mapLegacyPriorityToNumeric } from '@/lib/hermes-kanban-types'
import type {
  ClaudeTask,
  CreateTaskInput,
  TaskAssignee,
} from '@/lib/tasks-api'

// Priority labels in the form (friendly) → map to Agent numeric on submit
const PRIORITY_OPTIONS = [
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Normal', value: 'normal' },
  { label: 'Low', value: 'low' },
] as const
type FormPriority = (typeof PRIORITY_OPTIONS)[number]['value']

function formPriorityToNumeric(p: FormPriority): number {
  if (p === 'high') return 3
  if (p === 'medium') return 1
  if (p === 'normal') return 0
  return -1
}

const WORKSPACE_KIND_OPTIONS = ['', 'scratch', 'git', 'local', 'remote'] as const

/**
 * Extended submit payload. The dialog resolves the two-step create-then-patch
 * logic and communicates it to the screen via `desiredStatus` + `blockReason`.
 * The screen calls createTask(createInput) and, if desiredStatus requires it,
 * follows up with updateTask(id, { status: desiredStatus, block_reason }).
 */
export type TaskDialogSubmit = {
  createInput: CreateTaskInput
  /** Status to PATCH after creation, when the Agent API cannot set it directly. */
  desiredStatus?: HermesKanbanStatus
  blockReason?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: ClaudeTask | null
  defaultColumn?: HermesKanbanStatus
  assignees: Array<TaskAssignee>
  onSubmit: (payload: TaskDialogSubmit) => Promise<void>
  isSubmitting: boolean
}

export function TaskDialog({
  open,
  onOpenChange,
  task,
  defaultColumn,
  assignees,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(task)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<HermesKanbanStatus>(defaultColumn ?? 'triage')
  const [priority, setPriority] = useState<FormPriority>('normal')
  const [assignee, setAssignee] = useState('')
  const [tenant, setTenant] = useState('')
  const [skills, setSkills] = useState('')
  const [workspaceKind, setWorkspaceKind] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const [maxRuntimeSeconds, setMaxRuntimeSeconds] = useState('')
  const [parents, setParents] = useState('')
  const [blockReason, setBlockReason] = useState('')

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setBody(task.body ?? '')
      setStatus((task.status as HermesKanbanStatus) ?? 'triage')
      const numPri = typeof task.priority === 'number'
        ? task.priority
        : mapLegacyPriorityToNumeric(String(task.priority))
      setPriority(numPri >= 3 ? 'high' : numPri >= 1 ? 'medium' : numPri === 0 ? 'normal' : 'low')
      setAssignee(task.assignee ?? '')
      setTenant(task.tenant ?? '')
      setSkills(Array.isArray(task.skills) ? task.skills.join(', ') : (task.skills ?? ''))
      setWorkspaceKind(task.workspace_kind ?? '')
      setWorkspacePath(task.workspace_path ?? '')
      setMaxRuntimeSeconds(task.max_runtime_seconds != null ? String(task.max_runtime_seconds) : '')
      setParents('')
      setBlockReason('')
    } else {
      setTitle('')
      setBody('')
      setStatus(defaultColumn ?? 'triage')
      setPriority('normal')
      setAssignee('')
      setTenant('')
      setSkills('')
      setWorkspaceKind('')
      setWorkspacePath('')
      setMaxRuntimeSeconds('')
      setParents('')
      setBlockReason('')
    }
  }, [task, open, defaultColumn])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    const skillsArr = skills.split(',').map(s => s.trim()).filter(Boolean)
    const parentsArr = parents.split(',').map(s => s.trim()).filter(Boolean)
    const maxRt = maxRuntimeSeconds.trim() ? Number(maxRuntimeSeconds.trim()) : null

    // Determine what triage flag to send and what status to patch after creation.
    // Agent API only accepts triage: true/false + parents on create.
    // todo/blocked/done/running require a PATCH after creation.
    let triage = false
    let desiredStatus: HermesKanbanStatus | undefined
    if (status === 'triage') {
      triage = true
    } else if (status === 'ready') {
      triage = false
    } else if (status === 'todo' && parentsArr.length > 0) {
      triage = false // Agent derives todo from parents
    } else if (status === 'todo' || status === 'blocked' || status === 'done' || status === 'running') {
      triage = false
      desiredStatus = status
    }

    const createInput: CreateTaskInput = {
      title: title.trim(),
      body: body.trim() || null,
      priority: formPriorityToNumeric(priority),
      assignee: assignee || null,
      tenant: tenant.trim() || null,
      skills: skillsArr.length > 0 ? skillsArr : null,
      workspace_kind: workspaceKind || null,
      workspace_path: workspacePath.trim() || null,
      max_runtime_seconds: maxRt,
      parents: parentsArr.length > 0 ? parentsArr : undefined,
      triage,
    }

    await onSubmit({ createInput, desiredStatus, blockReason: blockReason.trim() || undefined })
  }

  const inputClass = cn(
    'w-full rounded-lg border px-3 py-2 text-sm',
    'bg-[var(--theme-input)] border-[var(--theme-border)] text-[var(--theme-text)]',
    'focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]',
    'placeholder:text-[var(--theme-muted)]',
  )

  const labelClass = 'block text-xs font-medium text-[var(--theme-muted)] mb-1'

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,95vw)] border-[var(--theme-border)] bg-[var(--theme-bg)] overflow-hidden">
        {/* Accent top border */}
        <div
          className="h-[3px] w-full"
          style={{ background: 'var(--theme-accent)' }}
        />

        <div className="p-5">
          <DialogTitle className="text-base font-semibold text-[var(--theme-text)] mb-1">
            {isEdit ? 'Edit Task' : 'New Task'}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--theme-muted)] mb-4">
            {isEdit
              ? 'Update the task details below.'
              : 'Fill in the details for your new task.'}
          </DialogDescription>

          <form onSubmit={handleSubmit} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {/* Title */}
            <div>
              <label className={labelClass}>Title *</label>
              <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)}
                placeholder="What needs to be done?" required autoFocus />
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
                <label className={labelClass}>Initial status</label>
                <select className={inputClass} style={{ colorScheme: 'dark' }}
                  value={status} onChange={e => setStatus(e.target.value as HermesKanbanStatus)}>
                  {HERMES_KANBAN_VISIBLE_STATUS_ORDER.map(s => (
                    <option key={s} value={s}>{HERMES_KANBAN_STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                  {status === 'triage' && 'Backlog — agent will not pick up automatically.'}
                  {status === 'ready' && 'Dispatchable — agent can claim immediately.'}
                  {status === 'todo' && 'Held — set if adding parent deps; patched after create.'}
                  {status === 'blocked' && 'Blocked — enter a reason below; patched after create.'}
                  {status === 'running' && 'Running — manual; prefer dispatching from Ready.'}
                  {status === 'done' && 'Done — for import/testing purposes; patched after create.'}
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

            {/* Block reason — only when status=blocked */}
            {status === 'blocked' && (
              <div>
                <label className={labelClass}>Block reason (optional)</label>
                <input className={inputClass} value={blockReason} onChange={e => setBlockReason(e.target.value)}
                  placeholder="Why is this task blocked?" />
              </div>
            )}

            {/* Agent profile + Tenant */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Agent profile</label>
                <select className={inputClass} style={{ colorScheme: 'dark' }}
                  value={assignee} onChange={e => setAssignee(e.target.value)}>
                  <option value="">Unassigned</option>
                  {assignees.map(({ id, label, onDisk }) => (
                    <option key={id} value={id}>
                      {onDisk ? label : `${label} ⚠ (not installed)`}
                    </option>
                  ))}
                </select>
                {assignee && !assignees.find(a => a.id === assignee)?.onDisk && (
                  <p className="mt-1 text-[10px] text-amber-400">
                    ⚠ Profile not installed — dispatching will fail
                  </p>
                )}
              </div>
              <div>
                <label className={labelClass}>Tenant</label>
                <input className={inputClass} value={tenant} onChange={e => setTenant(e.target.value)}
                  placeholder="e.g. mission-42" />
              </div>
            </div>

            {/* Parent dependencies */}
            <div>
              <label className={labelClass}>Parent dependencies (comma-sep task IDs)</label>
              <input className={inputClass} value={parents} onChange={e => setParents(e.target.value)}
                placeholder="t_abc123, t_def456 — this task becomes a child" />
              <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                Leave blank for independent tasks. Adding parents sets status to Todo until they complete.
              </p>
            </div>

            {/* Skills */}
            <div>
              <label className={labelClass}>Skills (comma-separated)</label>
              <input className={inputClass} value={skills} onChange={e => setSkills(e.target.value)}
                placeholder="python, code-review, research" />
            </div>

            {/* Workspace kind + path */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Workspace kind</label>
                <select className={inputClass} style={{ colorScheme: 'dark' }}
                  value={workspaceKind} onChange={e => setWorkspaceKind(e.target.value)}>
                  {WORKSPACE_KIND_OPTIONS.map(k => (
                    <option key={k} value={k}>{k === '' ? 'None' : k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Workspace path</label>
                <input className={inputClass} value={workspacePath} onChange={e => setWorkspacePath(e.target.value)}
                  placeholder="/path/to/repo (optional)" />
              </div>
            </div>

            {/* Max runtime */}
            <div>
              <label className={labelClass}>Max runtime (seconds)</label>
              <input type="number" min={1} className={inputClass} value={maxRuntimeSeconds}
                onChange={e => setMaxRuntimeSeconds(e.target.value)}
                placeholder="e.g. 3600 for 1 hour (optional)" />
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-[10px] text-[var(--theme-muted)]">Press Esc to cancel</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSubmitting || !title.trim()}
                  style={{ background: 'var(--theme-accent)', color: 'white' }}>
                  {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Task'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
