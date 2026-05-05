import { describe, expect, it } from 'vitest'
import {
  HERMES_KANBAN_ALL_STATUSES,
  HERMES_KANBAN_VISIBLE_STATUS_ORDER,
  kanbanPriorityColor,
  kanbanPriorityLabel,
  mapLegacyColumnToKanbanStatus,
  mapLegacyPriorityToNumeric,
  normalizeKanbanAssignee,
} from './hermes-kanban-types'

describe('hermes-kanban-types', () => {
  it('separates visible board order from the full status set', () => {
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).toEqual([
      'triage',
      'todo',
      'ready',
      'running',
      'blocked',
      'done',
    ])
    expect(HERMES_KANBAN_ALL_STATUSES).toEqual([
      'triage',
      'todo',
      'ready',
      'running',
      'blocked',
      'done',
      'archived',
    ])
  })

  it('maps legacy workspace columns to agent statuses', () => {
    expect(mapLegacyColumnToKanbanStatus('backlog')).toBe('triage')
    expect(mapLegacyColumnToKanbanStatus('todo')).toBe('todo')
    expect(mapLegacyColumnToKanbanStatus('in_progress')).toBe('running')
    expect(mapLegacyColumnToKanbanStatus('review')).toBe('triage')
    expect(mapLegacyColumnToKanbanStatus('done')).toBe('done')
    expect(mapLegacyColumnToKanbanStatus('unknown')).toBe('triage')
  })

  it('maps legacy priorities to numeric values', () => {
    expect(mapLegacyPriorityToNumeric('high')).toBe(3)
    expect(mapLegacyPriorityToNumeric('medium')).toBe(1)
    expect(mapLegacyPriorityToNumeric('low')).toBe(-1)
    expect(mapLegacyPriorityToNumeric('unknown')).toBe(0)
  })

  it('returns labels and colors for priority ranges', () => {
    expect(kanbanPriorityLabel(3)).toBe('High')
    expect(kanbanPriorityLabel(1)).toBe('Medium')
    expect(kanbanPriorityLabel(0)).toBe('Normal')
    expect(kanbanPriorityLabel(-1)).toBe('Low')
    expect(kanbanPriorityColor(3)).not.toBe(kanbanPriorityColor(-1))
  })

  it('normalizes assignees', () => {
    const result = normalizeKanbanAssignee({
      name: 'agent-worker-1',
      on_disk: false,
      counts: { todo: 1 },
    })
    expect(result.id).toBe('agent-worker-1')
    expect(result.label).toBe('Agent Worker 1')
    expect(result.onDisk).toBe(false)
    expect(result.counts).toEqual({ todo: 1 })
  })
})
