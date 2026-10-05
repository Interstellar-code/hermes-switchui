import { describe, expect, it } from 'vitest'
import { NODE_COLOR, SUBGRAPH_COLOR, nodeColor } from './node-colors'

describe('node-colors', () => {
  it('maps known types, including subagent', () => {
    expect(nodeColor('bash')).toBe('#5ad3ff')
    expect(nodeColor('subagent')).toBe('#bf97ff')
    expect(SUBGRAPH_COLOR).toBe(NODE_COLOR.subgraph)
  })
  it('falls back to prompt green for unknown types', () => {
    expect(nodeColor('mystery')).toBe('#00ff41')
  })
})
