import { describe, expect, it } from 'vitest'
import { formatKanbanBlockReason, parseKanbanBlockReason } from './kanban-block-state'

describe('kanban-block-state', () => {
  it('formats structured block reasons with a stable prefix', () => {
    expect(formatKanbanBlockReason('dependency', 'Waiting on parent task')).toBe('[dependency] Waiting on parent task')
    expect(formatKanbanBlockReason('agent', '')).toBe('[agent]')
  })

  it('keeps other reasons as plain text', () => {
    expect(formatKanbanBlockReason('other', 'Need clarification')).toBe('Need clarification')
    expect(formatKanbanBlockReason('other', '')).toBeNull()
  })

  it('parses structured prefixes and preserves legacy free text', () => {
    expect(parseKanbanBlockReason('[review] Waiting for signoff')).toEqual({
      code: 'review',
      detail: 'Waiting for signoff',
      legacy: false,
    })
    expect(parseKanbanBlockReason('plain legacy reason')).toEqual({
      code: 'other',
      detail: 'plain legacy reason',
      legacy: true,
    })
  })
})
