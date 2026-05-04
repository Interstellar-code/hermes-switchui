import { describe, expect, it } from 'vitest'

import { formatTaskAssigneeLabel } from './task-card'
import { TASKS_BOARD_HELP_TEXT } from './tasks-screen'
import {
  HERMES_KANBAN_VISIBLE_STATUS_ORDER,
  HERMES_KANBAN_ALL_STATUSES,
} from '../../lib/hermes-kanban-types'

describe('tasks UX copy', () => {
  it('exposes helper copy that explains drag and assignment behavior', () => {
    expect(TASKS_BOARD_HELP_TEXT).toBe(
      'Drag cards to change status. Open a card to set assignee and due date.',
    )
  })

  it('formats assignee labels explicitly for assigned and unassigned tasks', () => {
    expect(formatTaskAssigneeLabel('jarvis', { jarvis: 'Jarvis' })).toBe(
      'Assignee: Jarvis',
    )
    expect(formatTaskAssigneeLabel(null, {})).toBe('Assignee: Unassigned')
  })
})

describe('Agent Kanban board column order', () => {
  it('board columns follow Agent lifecycle order', () => {
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).toEqual([
      'triage', 'todo', 'ready', 'running', 'blocked', 'done',
    ])
  })

  it('visible columns exclude archived', () => {
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).not.toContain('archived')
  })

  it('full status set includes archived at end', () => {
    expect(HERMES_KANBAN_ALL_STATUSES[HERMES_KANBAN_ALL_STATUSES.length - 1]).toBe('archived')
  })

  it('review column is gone — not a persisted Agent status', () => {
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).not.toContain('review')
    expect(HERMES_KANBAN_ALL_STATUSES).not.toContain('review')
  })

  it('new Agent statuses ready and blocked are present', () => {
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).toContain('ready')
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).toContain('blocked')
  })
})
