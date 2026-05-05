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
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).not.toContain('archived')
    expect(HERMES_KANBAN_ALL_STATUSES).toContain('archived')
  })

  it('maps legacy SwitchUI columns to Agent statuses', () => {
    expect(mapLegacyColumnToKanbanStatus('backlog')).toBe('triage')
    expect(mapLegacyColumnToKanbanStatus('todo')).toBe('todo')
    expect(mapLegacyColumnToKanbanStatus('in_progress')).toBe('running')
    expect(mapLegacyColumnToKanbanStatus('review')).toBe('triage')
    expect(mapLegacyColumnToKanbanStatus('done')).toBe('done')
    expect(mapLegacyColumnToKanbanStatus('unknown_col')).toBe('triage')
  })

  it('maps numeric priority to labels', () => {
    expect(kanbanPriorityLabel(5)).toBe('High')
    expect(kanbanPriorityLabel(3)).toBe('High')
    expect(kanbanPriorityLabel(2)).toBe('Medium')
    expect(kanbanPriorityLabel(1)).toBe('Medium')
    expect(kanbanPriorityLabel(0)).toBe('Normal')
    expect(kanbanPriorityLabel(-1)).toBe('Low')
    expect(kanbanPriorityLabel(-5)).toBe('Low')
  })

  it('maps string legacy priority to numeric value', () => {
    expect(mapLegacyPriorityToNumeric('high')).toBe(3)
    expect(mapLegacyPriorityToNumeric('medium')).toBe(1)
    expect(mapLegacyPriorityToNumeric('low')).toBe(-1)
    expect(mapLegacyPriorityToNumeric('unknown')).toBe(0)
  })

  it('returns a color string for each priority range', () => {
    expect(kanbanPriorityColor(3)).toBeTypeOf('string')
    expect(kanbanPriorityColor(1)).toBeTypeOf('string')
    expect(kanbanPriorityColor(0)).toBeTypeOf('string')
    expect(kanbanPriorityColor(-1)).toBeTypeOf('string')
    expect(kanbanPriorityColor(3)).not.toBe(kanbanPriorityColor(-1))
  })

  describe('normalizeKanbanAssignee', () => {
    it('normalizes a standard agent assignee', () => {
      const result = normalizeKanbanAssignee({
        name: 'agent-worker-1',
        on_disk: false,
        counts: {
          triage: 0,
          todo: 1,
          ready: 2,
          running: 1,
          blocked: 0,
          done: 5,
          archived: 0,
        },
      })
      expect(result.id).toBe('agent-worker-1')
      expect(result.name).toBe('agent-worker-1')
      expect(result.isHuman).toBe(false)
      expect(result.onDisk).toBe(false)
      expect(result.counts).toBeDefined()
    })

    it('preserves counts when present', () => {
      const counts = {
        triage: 1,
        todo: 2,
        ready: 3,
        running: 4,
        blocked: 5,
        done: 6,
        archived: 7,
      }
      const result = normalizeKanbanAssignee({
        name: 'x',
        on_disk: true,
        counts,
      })
      expect(result.counts).toEqual(counts)
      expect(result.onDisk).toBe(true)
    })

    it('handles empty assignee list gracefully', () => {
      const results = [].map(normalizeKanbanAssignee)
      expect(results).toEqual([])
    })

    it('treats unknown names as non-human by default', () => {
      const result = normalizeKanbanAssignee({
        name: 'some-ai-agent',
        on_disk: false,
        counts: {},
      })
      expect(result.isHuman).toBe(false)
    })
  })
})
