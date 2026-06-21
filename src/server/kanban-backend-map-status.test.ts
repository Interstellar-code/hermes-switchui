import { describe, expect, it } from 'vitest'
import { mapBoardStatus } from './kanban-backend'

describe('kanban-backend mapBoardStatus', () => {
  it('maps every LocalKanbanCard status to a valid HermesKanbanStatus', () => {
    expect(mapBoardStatus('backlog')).toBe('triage')
    expect(mapBoardStatus('ready')).toBe('ready')
    expect(mapBoardStatus('running')).toBe('running')
    expect(mapBoardStatus('review')).toBe('triage')
    expect(mapBoardStatus('blocked')).toBe('blocked')
    expect(mapBoardStatus('done')).toBe('done')
    expect(mapBoardStatus('archived')).toBe('triage')
  })

  it('falls back to triage for null, undefined, or unexpected statuses (#174)', () => {
    expect(mapBoardStatus(null)).toBe('triage')
    expect(mapBoardStatus(undefined)).toBe('triage')
    // @ts-expect-error — defensive: runtime callers may pass an unknown string
    expect(mapBoardStatus('unknown')).toBe('triage')
  })
})
