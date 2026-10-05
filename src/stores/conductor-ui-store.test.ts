import { beforeEach, describe, expect, it } from 'vitest'
import { useConductorUIStore } from './conductor-ui-store'

const st = () => useConductorUIStore.getState()

describe('conductor-ui-store inspector', () => {
  beforeEach(() =>
    useConductorUIStore.setState({
      drawerRunId: null,
      inspectTab: 'events',
      expandedNodeId: 'x',
    }),
  )
  it('setDrawerRunId: opening from closed resets tab and expanded row', () => {
    st().setDrawerRunId('r1')
    expect(st()).toMatchObject({
      drawerRunId: 'r1',
      inspectTab: 'overview',
      expandedNodeId: null,
    })
  })
  it('openInspector sets run, tab and expanded row atomically', () => {
    st().openInspector('r1', { tab: 'nodes', expandedNodeId: 'build' })
    expect(st()).toMatchObject({
      drawerRunId: 'r1',
      inspectTab: 'nodes',
      expandedNodeId: 'build',
    })
    st().openInspector('r2')
    expect(st()).toMatchObject({
      drawerRunId: 'r2',
      inspectTab: 'nodes',
      expandedNodeId: null,
    })
  })
})

describe('node panel selection', () => {
  it('selects a node with a tab, resets the tab on a new node, and clears on run change', () => {
    const s = useConductorUIStore
    s.setState({
      selectedRunId: 'r1',
      selectedNodeId: null,
      nodePanelTab: 'overview',
    })
    s.getState().selectNode('a', 'output')
    expect([s.getState().selectedNodeId, s.getState().nodePanelTab]).toEqual([
      'a',
      'output',
    ])
    s.getState().selectNode('a')
    expect(s.getState().nodePanelTab).toBe('output')
    s.getState().selectNode('b')
    expect(s.getState().nodePanelTab).toBe('overview')
    s.getState().setSelectedRunId('r1')
    expect(s.getState().selectedNodeId).toBe('b')
    s.getState().setSelectedRunId('r2')
    expect(s.getState().selectedNodeId).toBeNull()
  })
})
