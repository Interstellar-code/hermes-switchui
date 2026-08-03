import { describe, expect, it } from 'vitest'

import {
  UNASSIGNED_FILTER,
  assigneeMatches,
  buildAssigneeFilterOptions,
} from './task-filter-model'
import type { HermesKanbanAssignee, HermesKanbanTask } from '@/lib/hermes-kanban-types'

const task = (id: string, status: HermesKanbanTask['status'], assignee: string | null, tenant = 'acme') => ({
  id, title: id, body: null, assignee, status, priority: 0, created_by: null,
  created_at: 1, started_at: null, completed_at: null, workspace_kind: null,
  workspace_path: null, claim_lock: null, claim_expires: null, tenant, result: null,
  spawn_failures: 0, worker_pid: null, last_spawn_error: null, max_runtime_seconds: null,
  last_heartbeat_at: null, current_run_id: null, workflow_template_id: null,
  current_step_key: null, skills: null,
}) satisfies HermesKanbanTask

describe('task assignee filter model', () => {
  it('separates configured, historical, and unassigned counts in one scope', () => {
    const scoped = [
      task('profile-open', 'ready', 'neo'),
      task('historical-done', 'done', 'code-loop-producer'),
      task('unassigned-open', 'todo', null),
      task('unassigned-done', 'done', null),
    ]
    const visible = scoped.filter((item) => item.status !== 'done')
    const assignees = [{ id: 'code-loop-producer', name: 'code-loop-producer', label: 'code-loop-producer', isHuman: false, onDisk: false, counts: {} }] satisfies Array<HermesKanbanAssignee>
    const options = buildAssigneeFilterOptions({ profiles: [{ name: 'neo' }], activeProfile: 'neo', assignees, visibleTasks: visible, scopedTasks: scoped })

    expect(options.find((item) => item.id === 'neo')).toMatchObject({ kind: 'profile', visibleCount: 1, totalCount: 1 })
    expect(options.find((item) => item.id === 'code-loop-producer')).toMatchObject({ kind: 'historical', visibleCount: 0, totalCount: 1, counts: { done: 1 } })
    expect(scoped.filter((item) => assigneeMatches(item, UNASSIGNED_FILTER))).toHaveLength(2)
    expect(visible.filter((item) => assigneeMatches(item, UNASSIGNED_FILTER))).toHaveLength(1)
  })
})
