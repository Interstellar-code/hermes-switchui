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
