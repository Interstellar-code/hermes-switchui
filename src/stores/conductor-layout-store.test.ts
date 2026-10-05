import { beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_CAP, useConductorLayoutStore } from './conductor-layout-store'

const store = () => useConductorLayoutStore.getState()

describe('conductor-layout-store', () => {
  beforeEach(() => useConductorLayoutStore.setState({ layouts: {} }))

  it('saves positions and lock per workflow; reset keeps the lock', () => {
    store().savePositions('wf', { a: { x: 1, y: 2 } })
    store().setLocked('wf', true)
    expect(store().layouts.wf).toMatchObject({
      positions: { a: { x: 1, y: 2 } },
      locked: true,
    })
    store().resetLayout('wf')
    expect(store().layouts.wf).toMatchObject({ positions: {}, locked: true })
  })

  it('reset on an unknown workflow is a no-op', () => {
    store().resetLayout('nope')
    expect(store().layouts).toEqual({})
  })

  it(`caps entries to the newest ${LAYOUT_CAP}`, () => {
    for (let i = 0; i < LAYOUT_CAP + 5; i++)
      useConductorLayoutStore.setState((s) => ({
        layouts: {
          ...s.layouts,
          [`old${i}`]: { positions: {}, locked: false, at: i },
        },
      }))
    store().savePositions('fresh', {})
    const keys = Object.keys(store().layouts)
    expect(keys).toHaveLength(LAYOUT_CAP)
    expect(keys).toContain('fresh')
    expect(keys).not.toContain('old0')
  })
})
