import { describe, expect, it } from 'vitest'
import { graphReducer, initHistory } from './graph-history'
import type { GraphHistoryAction, GraphHistoryState } from './graph-history'

function run(actions: Array<GraphHistoryAction>, start = 'A') {
  return actions.reduce<GraphHistoryState>(graphReducer, initHistory(start))
}

describe('graphReducer coalescing', () => {
  it('typing after add-node is a separate undo step', () => {
    let s = run([
      { type: 'edit', yaml: 'B' }, // add node
      { type: 'edit', yaml: 'B1', coalesceKey: 'n:body' },
      { type: 'edit', yaml: 'B12', coalesceKey: 'n:body' },
    ])
    expect(s.past).toEqual(['A', 'B'])
    s = graphReducer(s, { type: 'undo' })
    expect(s.present).toBe('B')
    s = graphReducer(s, { type: 'undo' })
    expect(s.present).toBe('A')
  })

  it('undo after save lands on the saved state', () => {
    let s = run([
      { type: 'edit', yaml: 'A1', coalesceKey: 'n:body' },
      { type: 'markSaved' },
      { type: 'edit', yaml: 'A12', coalesceKey: 'n:body' },
    ])
    s = graphReducer(s, { type: 'undo' })
    expect(s.present).toBe('A1')
    expect(s.present).toBe(s.saved)
  })

  it('edits to different nodes / fields do not merge', () => {
    const s = run([
      { type: 'edit', yaml: 'A1', coalesceKey: 'x:body' },
      { type: 'edit', yaml: 'A2', coalesceKey: 'y:body' },
    ])
    expect(s.past).toEqual(['A', 'A1'])
  })
})
